import type { Beat, ReaderTelemetry, ReadingPosition } from './types.js';

/**
 * How far ahead to generate.
 *
 * Two clocks drive this app and they are deliberately kept apart:
 *
 *   - The *scene clock* (Beat[]) is stable. It depends only on the book, so the
 *     same beat produces the same image for every reader on every device, which
 *     is what makes the R2 cache shared and the whole thing nearly free.
 *
 *   - The *reader clock* (this file) is per-session. It decides how far ahead and
 *     how urgently to run. It must never influence *what* is generated, or a font
 *     size change would invalidate a book's entire art cache.
 */

export const MIN_LOOKAHEAD = 1;
export const MAX_LOOKAHEAD = 6;

/** Fast skimmers need a deeper buffer; slow readers need almost none. */
function velocityFactor(msPerParagraph: number): number {
  if (!Number.isFinite(msPerParagraph) || msPerParagraph <= 0) return 1;
  // ~12s/paragraph is an attentive pace; 2s/paragraph is skimming.
  const ATTENTIVE = 12_000;
  return clamp(ATTENTIVE / msPerParagraph, 0.5, 3);
}

/**
 * How much we trust that the reader will keep moving forward.
 * A cold jump into chapter 12 tells us nothing, so we generate only what's on screen.
 */
function confidence(t: ReaderTelemetry): number {
  if (t.direction === -1) return 0;          // re-reading backwards; stop prefetching
  const base = t.entry === 'linear' ? 1 : t.entry === 'restore' ? 0.6 : 0.3;
  return t.direction === 1 ? base : base * 0.6;
}

/** Number of beats to keep rendered ahead of the reader. */
export function lookaheadDepth(t: ReaderTelemetry): number {
  const raw = t.beatsPerScreen * velocityFactor(t.msPerParagraph) * confidence(t);
  if (raw <= 0) return 0;
  return Math.round(clamp(raw, MIN_LOOKAHEAD, MAX_LOOKAHEAD));
}

/**
 * The beats to request right now: the one the reader is in, plus the lookahead
 * window, sorted so the nearest is generated first.
 */
export function selectBeats(
  beats: readonly Beat[],
  pos: ReadingPosition,
  t: ReaderTelemetry,
): Beat[] {
  const depth = lookaheadDepth(t);
  const upcoming = beats
    .filter((b) => compare(b, pos) >= 0)
    .sort((a, b) => compare(a, b));
  // Always include the current beat even when confidence is zero.
  return upcoming.slice(0, Math.max(1, depth + 1));
}

/** Order two positions in reading order. */
export function compare(a: ReadingPosition, b: ReadingPosition): number {
  return a.spineIndex !== b.spineIndex
    ? a.spineIndex - b.spineIndex
    : a.paraIndex - b.paraIndex;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
