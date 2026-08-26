import type { Beat, BeatKind } from '@shiori/core';
import type { Env } from './env';

/**
 * Text model for scene segmentation. Analysis is lazy — we segment a section
 * shortly before the reader reaches it, so opening a book is instant instead of
 * blocking on a whole-book pass.
 */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;

/** Roughly one illustration per this many paragraphs. Tunes density. */
const TARGET_SPACING = 14;

const SYSTEM = `You identify moments in a novel that deserve an illustration, in the style of a Japanese light novel.

Return STRICT JSON: {"beats":[{"paraIndex":N,"kind":"character|scene|action|item","prompt":"...","characters":["Name"],"salience":0.0-1.0}]}

Rules:
- "character": a person is introduced or described for the first time.
- "scene": the setting or mood changes noticeably.
- "action": a fight, chase, or set piece begins.
- "item": an object of clear plot significance appears.
- prompt: ONE vivid visual sentence. Describe only what is SEEN — no names, no plot, no dialogue.
- Never place a beat on a paragraph that reveals a later twist.
- paraIndex must be the index of a paragraph given to you.
- Prefer the START of a moment, so the art appears as it begins.`;

export async function analyzeSection(
  env: Env,
  bookId: string,
  spineIndex: number,
  paragraphs: readonly string[],
): Promise<Beat[]> {
  const meaningful = paragraphs
    .map((text, index) => ({ index, text }))
    .filter((p) => p.text.length > 40);
  if (meaningful.length === 0) return [];

  const budget = Math.max(1, Math.round(meaningful.length / TARGET_SPACING));
  const numbered = meaningful.map((p) => `[${p.index}] ${truncate(p.text, 400)}`).join('\n\n');

  const response = (await env.AI.run(MODEL as never, {
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Choose at most ${budget} beats from this section.\n\n${numbered}`,
      },
    ],
    max_tokens: 2048,
    temperature: 0.4,
  } as never)) as { response?: string };

  return parseBeats(response?.response ?? '', bookId, spineIndex, paragraphs.length);
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
    characterIds: characters.map(slugify),
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
