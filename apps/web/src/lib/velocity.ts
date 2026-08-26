import { compare, type ReadingPosition } from '@shiori/core';

/**
 * Tracks reading pace as a rolling median of ms-per-paragraph.
 *
 * Median, not mean: putting the phone down mid-chapter produces a single huge
 * sample that would otherwise poison the average and collapse the buffer to
 * nothing right when the reader picks it back up.
 */
export class VelocityTracker {
  #samples: number[] = [];
  #last: { pos: ReadingPosition; at: number } | null = null;
  readonly #capacity: number;

  constructor(capacity = 20) {
    this.#capacity = capacity;
  }

  /** Feed each new position; returns the current median ms/paragraph. */
  record(pos: ReadingPosition, now = Date.now()): number {
    const prev = this.#last;
    this.#last = { pos, at: now };
    if (!prev) return this.median();

    const paragraphs = Math.abs(delta(prev.pos, pos));
    if (paragraphs === 0) return this.median();

    const elapsed = now - prev.at;
    // Discard idle gaps (phone put down) and impossible jumps (TOC navigation).
    if (elapsed > 120_000 || paragraphs > 30) return this.median();

    this.#samples.push(elapsed / paragraphs);
    if (this.#samples.length > this.#capacity) this.#samples.shift();
    return this.median();
  }

  median(): number {
    if (this.#samples.length === 0) return 8_000; // neutral default pace
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 8_000);
  }

  /** +1 forward, -1 backward, 0 unknown. */
  direction(pos: ReadingPosition): 1 | -1 | 0 {
    const prev = this.#last;
    if (!prev) return 0;
    const d = compare(pos, prev.pos);
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  reset(): void {
    this.#samples = [];
    this.#last = null;
  }
}

/** Approximate paragraph distance across spine boundaries. */
function delta(a: ReadingPosition, b: ReadingPosition): number {
  const SECTION_WEIGHT = 50;
  return (b.spineIndex - a.spineIndex) * SECTION_WEIGHT + (b.paraIndex - a.paraIndex);
}
