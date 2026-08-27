import type { Beat } from '@shiori/core';
import { blockElements } from '../lib/position';

/**
 * Insert illustrations into the book's own document, so they paginate as real
 * pages rather than floating above the reader.
 *
 * An overlay has to fake paging — hide itself on the next tap — which means
 * turning back never returns to it. A block sized to the full column height is
 * paginated by foliate like any other content: it gets its own page, it sits in
 * the CFI sequence, and paging backward lands on it exactly as it would on text.
 */

const PLATE_ATTR = 'data-shiori-plate';

export interface PlateSource {
  beat: Beat;
  /** null while the illustration is still rendering. */
  url: string | null;
}

/**
 * Sync the plates present in a rendered section against the ones we have art
 * for. Safe to call repeatedly: existing plates are left alone, so a re-render
 * or a late-arriving illustration doesn't duplicate anything.
 */
export function syncPlates(doc: Document, spineIndex: number, plates: readonly PlateSource[]): void {
  const wanted = plates.filter((p) => p.beat.spineIndex === spineIndex);
  ensureStyles(doc);

  const blocks = blockElements(doc);
  for (const { beat, url } of wanted) {
    const existing = doc.querySelector(`[${PLATE_ATTR}="${cssEscape(beat.id)}"]`);
    if (existing) {
      upgrade(existing as HTMLElement, doc, beat, url);
      continue;
    }

    // Anchor to the paragraph the beat was found at, so the plate lands where
    // the moment happens rather than at an arbitrary page boundary.
    const anchor = blocks[beat.paraIndex] ?? blocks[blocks.length - 1];
    if (!anchor?.parentNode) continue;

    anchor.parentNode.insertBefore(buildPlate(doc, beat, url), anchor);
  }
}

function buildPlate(doc: Document, beat: Beat, url: string | null): HTMLElement {
  const figure = doc.createElement('figure');
  figure.setAttribute(PLATE_ATTR, beat.id);
  figure.className = 'shiori-plate';

  figure.append(url ? image(doc, beat, url) : skeleton(doc));
  return figure;
}

/**
 * A plate fills the column box, which is what makes the paginator give it a
 * page of its own. break-inside avoidance keeps it from being split in half
 * across two pages when the image is shorter than the column.
 */
function ensureStyles(doc: Document): void {
  const id = 'shiori-plate-styles';
  if (doc.getElementById(id)) return;

  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `
    .shiori-plate {
      margin: 0;
      padding: 0;
      /*
        Sized against the viewport, not the parent. A percentage height collapses
        to nothing here because the paginated ancestors have no resolved height,
        which left the plate present in the DOM but zero pixels tall — the page
        looked like ordinary text with an invisible element on it.
      */
      height: 96vh;
      display: flex;
      align-items: center;
      justify-content: center;
      break-inside: avoid;
      break-before: column;
      break-after: column;
      page-break-inside: avoid;
    }
    .shiori-plate__skeleton {
      width: min(100%, 30rem);
      height: 88vh;
      border-radius: 3px;
      background: linear-gradient(
        100deg,
        currentColor 8%,
        transparent 18%,
        currentColor 33%
      );
      background-size: 300% 100%;
      opacity: 0.08;
      animation: shiori-shimmer 1.6s linear infinite;
    }
    @keyframes shiori-shimmer {
      to { background-position: -300% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .shiori-plate__skeleton { animation: none; }
    }
    .shiori-plate img {
      max-width: 100%;
      max-height: 92vh;
      object-fit: contain;
      display: block;
    }
  `;
  doc.head?.append(style);
}

/** Swap a skeleton for the real image once the illustration finishes. */
function upgrade(figure: HTMLElement, doc: Document, beat: Beat, url: string | null): void {
  const hasImage = figure.querySelector('img') !== null;
  if (!url || hasImage) return;
  figure.replaceChildren(image(doc, beat, url));
}

function image(doc: Document, beat: Beat, url: string): HTMLElement {
  const img = doc.createElement('img');
  img.src = url;
  img.alt = beat.prompt;
  img.setAttribute('data-shiori-beat', beat.id);
  return img;
}

/**
 * A placeholder that occupies the same page while the illustration renders.
 *
 * Without it the plate would pop into existence and shove the text one page
 * along mid-read; reserving the page keeps pagination stable.
 */
function skeleton(doc: Document): HTMLElement {
  const div = doc.createElement('div');
  div.className = 'shiori-plate__skeleton';
  div.setAttribute('aria-label', 'Illustration rendering');
  return div;
}

/** Beat ids are our own slugs, but escape anyway rather than trust the shape. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Which plate, if any, is the page currently on screen.
 *
 * Used to show the regenerate control only while art is actually being looked
 * at, rather than parking a button over the text.
 */
export function visiblePlate(doc: Document): string | null {
  const view = doc.defaultView;
  if (!view) return null;

  for (const el of doc.querySelectorAll(`[${PLATE_ATTR}]`)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;

    // Paginated columns are laid out side by side and translated horizontally,
    // so an off-screen plate still reports a box — it just sits outside the
    // viewport. Require the plate to genuinely cover the middle of the screen,
    // or the control appears over pages that hold no art at all.
    const midpoint = view.innerWidth / 2;
    if (r.left <= midpoint && r.right >= midpoint) {
      return el.getAttribute(PLATE_ATTR);
    }
  }
  return null;
}
