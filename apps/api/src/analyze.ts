import type { Beat, BeatKind, CharacterSheet } from '@shiori/core';
import type { Env } from './env';

/**
 * Text model for scene segmentation. Analysis is lazy — we segment a section
 * shortly before the reader reaches it, so opening a book is instant instead of
 * blocking on a whole-book pass.
 */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;

/**
 * Paragraphs per analysis request. At ~400 chars each this lands near 15k
 * tokens, comfortably inside the model context with room for the response.
 */
const PARAGRAPHS_PER_WINDOW = 120;

/** Roughly one illustration per this many paragraphs. Tunes density. */
const TARGET_SPACING = 14;

const SYSTEM = `You identify moments in a novel that deserve an illustration, in the style of a Japanese light novel.

Return STRICT JSON:
{"beats":[{"paraIndex":N,"kind":"character|scene|action|item","prompt":"...","characters":["Name"],"salience":0.0-1.0}],
 "cast":[{"name":"Name","descriptor":"physical appearance only"}]}

Rules:
- "character": a person is introduced or described for the first time.
- "scene": the setting or mood changes noticeably.
- "action": a fight, chase, or set piece begins.
- "item": an object of clear plot significance appears.
- prompt: ONE vivid visual sentence. Describe only what is SEEN — no names, no plot, no dialogue.
- Never place a beat on a paragraph that reveals a later twist.
- paraIndex must be the index of a paragraph given to you.
- Prefer the START of a moment, so the art appears as it begins.
- cast: for every named person appearing here, give a purely PHYSICAL descriptor
  (hair, eyes, build, clothing). No personality, no plot. This is what keeps a
  character looking like themselves across the whole book.`;

export async function analyzeSection(
  env: Env,
  bookId: string,
  spineIndex: number,
  paragraphs: readonly string[],
): Promise<{ beats: Beat[]; cast: CastEntry[] }> {
  const meaningful = paragraphs
    .map((text, index) => ({ index, text }))
    .filter((p) => p.text.length > 40);
  if (meaningful.length === 0) return { beats: [], cast: [] };

  // A single chapter can easily exceed the model's context window, and many
  // EPUBs ship one long section per chapter. Split into windows that fit, or
  // analysis would silently fail on exactly the long chapters worth illustrating.
  const windows = chunk(meaningful, PARAGRAPHS_PER_WINDOW);

  const results = await Promise.all(
    windows.map((window) => analyzeWindow(env, bookId, spineIndex, window, paragraphs.length)),
  );

  const beats = results.flatMap((r) => r.beats).sort((a, b) => a.paraIndex - b.paraIndex);
  const cast = dedupeById(results.flatMap((r) => r.cast));
  return { beats, cast };
}

async function analyzeWindow(
  env: Env,
  bookId: string,
  spineIndex: number,
  window: readonly { index: number; text: string }[],
  paragraphCount: number,
): Promise<{ beats: Beat[]; cast: CastEntry[] }> {
  const budget = Math.max(1, Math.round(window.length / TARGET_SPACING));
  const numbered = window.map((p) => `[${p.index}] ${truncate(p.text, 400)}`).join('\n\n');

  try {
    const response = (await env.AI.run(MODEL as never, {
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Choose at most ${budget} beats from this passage.\n\n${numbered}`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.4,
    } as never)) as { response?: string };

    const raw = response?.response ?? '';
    return {
      beats: parseBeats(raw, bookId, spineIndex, paragraphCount),
      cast: parseCast(raw),
    };
  } catch {
    // One failed window shouldn't cost the whole chapter its illustrations.
    return { beats: [], cast: [] };
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function dedupeById(entries: readonly CastEntry[]): CastEntry[] {
  const byId = new Map<string, CastEntry>();
  // First description wins: a character's look is fixed by their introduction.
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()];
}

/** The model is not guaranteed to return clean JSON; recover what we can. */
function parseBeats(
  raw: string,
  bookId: string,
  spineIndex: number,
  paragraphCount: number,
): Beat[] {
  const json = extractJson(raw);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const list = (parsed as { beats?: unknown[] })?.beats;
  if (!Array.isArray(list)) return [];

  const seen = new Set<number>();
  return list
    .map((item) => toBeat(item, bookId, spineIndex, paragraphCount))
    .filter((b): b is Beat => b !== null)
    .filter((b) => {
      if (seen.has(b.paraIndex)) return false;
      seen.add(b.paraIndex);
      return true;
    })
    .sort((a, b) => a.paraIndex - b.paraIndex);
}

function toBeat(
  item: unknown,
  bookId: string,
  spineIndex: number,
  paragraphCount: number,
): Beat | null {
  const o = item as Record<string, unknown>;
  const paraIndex = Number(o?.paraIndex);
  const prompt = typeof o?.prompt === 'string' ? o.prompt.trim() : '';
  if (!Number.isInteger(paraIndex) || paraIndex < 0 || paraIndex >= paragraphCount) return null;
  if (prompt.length < 10) return null;

  const kind = normalizeKind(o?.kind);
  const characters = Array.isArray(o?.characters)
    ? (o.characters as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  return {
    id: `${bookId}-${spineIndex}-${paraIndex}`,
    bookId,
    spineIndex,
    paraIndex,
    kind,
    prompt,
    characterIds: characters.map((n) => `${bookId}:${slugify(n)}`),
    salience: clamp01(Number(o?.salience ?? 0.5)),
  };
}

function normalizeKind(value: unknown): BeatKind {
  const kinds: BeatKind[] = ['character', 'scene', 'action', 'item'];
  return kinds.includes(value as BeatKind) ? (value as BeatKind) : 'scene';
}

function extractJson(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : null;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export { TARGET_SPACING };

/** A character's physical description, harvested during section analysis. */
export interface CastEntry {
  id: string;
  name: string;
  descriptor: string;
}

/**
 * Pull character descriptors out of the same response that produced the beats.
 * These become reference sheets, which is what keeps a character on-model for
 * the rest of the book.
 */
function parseCast(raw: string): CastEntry[] {
  const json = extractJson(raw);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const list = (parsed as { cast?: unknown[] })?.cast;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  return list
    .map((item) => {
      const o = item as Record<string, unknown>;
      const name = typeof o?.name === 'string' ? o.name.trim() : '';
      const descriptor = typeof o?.descriptor === 'string' ? o.descriptor.trim() : '';
      if (name.length === 0 || descriptor.length < 8) return null;
      return { id: slugify(name), name, descriptor };
    })
    .filter((c): c is CastEntry => c !== null)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
}
