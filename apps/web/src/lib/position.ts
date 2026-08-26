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
  index: number;
  range?: Range | null;
  fraction?: number;
}): ReadingPosition {
  const { index, range, fraction = 0 } = detail;
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
