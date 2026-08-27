import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { books, beats, characters, illustrations } from '@shiori/db';
import { STYLE, dimensionsFor, illustrationKey, type Beat } from '@shiori/core';
import { analyzeSection } from './analyze';
import { renderBeat, renderReferenceSheet } from './generate';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

/** Register a book by content hash. Identical files share one row and one cache. */
app.post('/api/books', async (c) => {
  const body = await c.req.json<{
    bookId: string;
    title: string;
    author: string | null;
    format: 'epub' | 'pdf';
    spineCount: number;
  }>();
  const db = drizzle(c.env.DB);

  const existing = await db.select().from(books).where(eq(books.id, body.bookId)).limit(1);
  if (existing.length === 0) {
    await db.insert(books).values({
      id: body.bookId,
      title: body.title,
      author: body.author,
      format: body.format,
      spineCount: body.spineCount,
      createdAt: Date.now(),
    });
  }

  const found = await db.select().from(beats).where(eq(beats.bookId, body.bookId));
  return c.json({ analyzed: found.length > 0, beatCount: found.length });
});

/** Segment a section into beats. Idempotent: a second call returns the cached set. */
app.post('/api/analyze', async (c) => {
  const { bookId, spineIndex, paragraphs } = await c.req.json<{
    bookId: string;
    spineIndex: number;
    paragraphs: string[];
  }>();
  const db = drizzle(c.env.DB);

  const cached = await db
    .select()
    .from(beats)
    .where(and(eq(beats.bookId, bookId), eq(beats.spineIndex, spineIndex)));
  if (cached.length > 0) return c.json({ beats: cached });

  const { beats: found, cast } = await analyzeSection(c.env, bookId, spineIndex, paragraphs);

  if (found.length > 0) {
    await db
      .insert(beats)
      .values(
        found.map((b) => ({
          id: b.id,
          bookId,
          spineIndex: b.spineIndex,
          paraIndex: b.paraIndex,
          kind: b.kind,
          prompt: b.prompt,
          characterIds: b.characterIds,
          salience: b.salience,
        })),
      )
      .onConflictDoNothing();
  }

  // Record the cast the first time each character is described. Later sections
  // that mention them again keep the original descriptor, so a character's
  // appearance is fixed by their introduction rather than drifting per chapter.
  if (cast.length > 0) {
    await db
      .insert(characters)
      .values(
        cast.map((entry) => ({
          id: `${bookId}:${entry.id}`,
          bookId,
          name: entry.name,
          descriptor: entry.descriptor,
          referenceKey: null,
        })),
      )
      .onConflictDoNothing();
  }

  return c.json({ beats: found });
});

app.get('/api/books/:bookId/beats', async (c) => {
  const bookId = c.req.param('bookId');
  const spine = c.req.query('spine');
  const db = drizzle(c.env.DB);

  const where =
    spine === undefined
      ? eq(beats.bookId, bookId)
      : and(eq(beats.bookId, bookId), eq(beats.spineIndex, Number(spine)));

  return c.json({ beats: await db.select().from(beats).where(where) });
});

/**
 * Request art for a window of beats. Returns immediately: anything not already
 * rendered is queued, and the client polls. This is what keeps the reader
 * responsive while generation runs behind it.
 */
app.post('/api/art', async (c) => {
  const { bookId, beatIds } = await c.req.json<{ bookId: string; beatIds: string[] }>();
  if (beatIds.length === 0) return c.json({ art: [] });

  const db = drizzle(c.env.DB);
  const existing = await db
    .select()
    .from(illustrations)
    .where(and(eq(illustrations.styleId, STYLE.id), inArray(illustrations.beatId, beatIds)));

  const known = new Map(existing.map((row) => [row.beatId, row]));
  const missing = beatIds.filter((id) => !known.has(id));

  if (missing.length > 0) {
    const targets = await db.select().from(beats).where(inArray(beats.id, missing));

    // Claim each beat with a pending row so concurrent readers don't double-render.
    for (const beat of targets) {
      const { width, height } = dimensionsFor(beat.kind);
      await db
        .insert(illustrations)
        .values({
          beatId: beat.id,
          styleId: STYLE.id,
          bookId,
          status: 'pending',
          key: null,
          width,
          height,
          createdAt: Date.now(),
        })
        .onConflictDoNothing();
      known.set(beat.id, {
        beatId: beat.id,
        styleId: STYLE.id,
        bookId,
        status: 'pending',
        key: null,
        width,
        height,
        error: null,
        createdAt: Date.now(),
      });
    }

    // Render after the response is sent. waitUntil allows 30s of background work
    // per request, which comfortably covers one image (~5-15s), and each beat
    // arrives as its own request, so a lookahead window renders in parallel
    // rather than queueing behind itself.
    for (const beat of targets) {
      c.executionCtx.waitUntil(renderAndStore(c.env, { ...beat, bookId }));
    }
  }

  return c.json({
    art: beatIds.map((id) => {
      const row = known.get(id);
      // A beat we have no record of is not pending — it will never arrive, and
      // reporting it as pending would make the client poll forever.
      return {
        beatId: id,
        status: row?.status ?? 'failed',
        url: row?.status === 'ready' ? `/api/art/${bookId}/${id}` : null,
        width: row?.width ?? 0,
        height: row?.height ?? 0,
      };
    }),
  });
});

/** Serve an illustration straight from R2. Egress is free, so this costs nothing. */
app.get('/api/art/:bookId/:beatId', async (c) => {
  const { bookId, beatId } = c.req.param();
  const object = await c.env.ART.get(illustrationKey(bookId, beatId, STYLE.id));
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
});

app.get('/api/health', (c) => c.json({ ok: true }));

// TEMPORARY diagnostic: surface the raw model response.
app.get('/api/_diag', async (c) => {
  try {
    const r = await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as never, {
      messages: [
        { role: 'system', content: 'Reply with STRICT JSON only: {ok:true}' },
        { role: 'user', content: 'Give me the json.' },
      ],
      max_tokens: 128,
    } as never);
    return c.json({ ok: true, raw: r });
  } catch (e) {
    return c.json({ ok: false, error: String(e) });
  }
});

/**
 * Render one beat and record the result.
 *
 * Runs inside waitUntil rather than a queue consumer: the free plan allows 30s
 * of background work after the response, which covers a single image with room
 * to spare, and keeps the whole app inside free tiers. Duplicate work is
 * prevented by the pending row claimed in D1, not by the queue, so nothing is
 * lost by rendering here.
 */
async function renderAndStore(env: Env, beat: Beat & { bookId: string }): Promise<void> {
  const db = drizzle(env.DB);

  const markFailed = (reason: string) =>
    db
      .update(illustrations)
      .set({ status: 'failed', error: reason.slice(0, 500) })
      .where(and(eq(illustrations.beatId, beat.id), eq(illustrations.styleId, STYLE.id)));

  try {
    const cast = await db.select().from(characters).where(eq(characters.bookId, beat.bookId));

    // Everyone in this beat needs a reference sheet before they can be drawn
    // consistently. Generated once per character, then reused for the book.
    const appearing = cast.filter((ch) => beat.characterIds.includes(ch.id));
    const resolved = await Promise.all(
      appearing.map(async (ch) => {
        if (ch.referenceKey) return ch;
        try {
          const referenceKey = await renderReferenceSheet(env, ch);
          await db.update(characters).set({ referenceKey }).where(eq(characters.id, ch.id));
          return { ...ch, referenceKey };
        } catch {
          // A missing sheet costs consistency, not the illustration itself.
          return ch;
        }
      }),
    );

    const { key, width, height } = await renderBeat(env, beat, resolved);

    await db
      .update(illustrations)
      .set({ status: 'ready', key, width, height })
      .where(and(eq(illustrations.beatId, beat.id), eq(illustrations.styleId, STYLE.id)));
  } catch (error) {
    // The reader degrades gracefully — they simply get no art for this beat —
    // so record the failure and let the client stop waiting on it.
    await markFailed(error instanceof Error ? error.message : String(error)).catch(() => {});
  }
}

export default app;
