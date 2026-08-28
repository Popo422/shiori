import type { ReadingPosition } from '@shiori/core';

/**
 * Derive a *stable* reading position from a foliate-js relocate event.
 *
 * foliate gives us `index` (spine index) and a live DOM `range`. We convert the
 * range into a paragraph ordinal by counting block elements before it, which is
 * identical regardless of viewport, font size or column count — unlike a page
 * number, which changes on every device.
 */
export function positionFromRelocate(detail: {
  index?: number;
  section?: { current?: number };
  range?: Range | null;
  fraction?: number;
}): ReadingPosition {
  const { range, fraction = 0 } = detail;

  // foliate's relocate event reports the spine index as `section.current`; it
  // consumes its internal `index` and does not re-emit it. Reading `index` here
  // yielded undefined on every event, so no beat ever compared as upcoming and
  // no art was ever requested.
  const index = detail.section?.current ?? detail.index ?? 0;

  if (!range) return { spineIndex: index, paraIndex: 0 };

  const doc = range.startContainer.ownerDocument;
  if (!doc) return { spineIndex: index, paraIndex: 0 };

  const blocks = blockElements(doc);
  if (blocks.length === 0) {
    // Fixed-layout or image-only section (common in PDFs): fall back to fraction.
    return { spineIndex: index, paraIndex: Math.round(fraction * 100) };
  }

  const node = range.startContainer;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const el = blocks[i];
    if (el && (el === node || el.contains(node))) return { spineIndex: index, paraIndex: i };
  }
  return { spineIndex: index, paraIndex: 0 };
}

/** The blocks that count as "paragraphs" for anchoring purposes. */
export function blockElements(doc: Document): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, blockquote, li'),
  ).filter((el) => (el.textContent ?? '').trim().length > 0);
}

/** How many beats fit on one screen — feeds the adaptive buffer depth. */
export function estimateBeatsPerScreen(doc: Document | null, beatSpacing: number): number {
  if (!doc || beatSpacing <= 0) return 1;
  const blocks = blockElements(doc);
  if (blocks.length === 0) return 1;

  const viewportHeight = doc.defaultView?.innerHeight ?? 800;
  const sample = blocks.slice(0, 12);
  const avgHeight =
    sample.reduce((sum, el) => sum + (el.getBoundingClientRect().height || 0), 0) /
    (sample.length || 1);
  if (avgHeight <= 0) return 1;

  const parasPerScreen = viewportHeight / avgHeight;
  return Math.max(0.25, parasPerScreen / beatSpacing);
}

/**
 * A relocate too far to be a page turn — a table-of-contents jump, a search
 * result, a scrub of the progress bar.
 *
 * Used to drop confidence back to a cold entry, so a reader who skips into the
 * middle of the book gets only what is on screen until they show which way they
 * are going. Reading forward off the end of one section into the start of the
 * next is continuous, not a jump, so a section change only counts when it skips
 * a document or lands well past the new section's beginning.
 */
export function isDiscontinuous(from: ReadingPosition, to: ReadingPosition): boolean {
  const JUMP_PARAGRAPHS = 30;

  if (from.spineIndex === to.spineIndex) {
    return Math.abs(to.paraIndex - from.paraIndex) > JUMP_PARAGRAPHS;
  }
  // Turning the last page of a section lands at the top of the very next one.
  const isNextSection = to.spineIndex === from.spineIndex + 1;
  return !(isNextSection && to.paraIndex <= JUMP_PARAGRAPHS);
}
