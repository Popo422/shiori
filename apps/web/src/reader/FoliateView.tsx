import { useEffect, useRef } from 'react';
import { positionFromRelocate, blockElements } from '../lib/position';
import type { ReadingPosition } from '@shiori/core';

/**
 * Thin adapter around foliate-js's <foliate-view> custom element.
 *
 * foliate-js documents its own API as unstable, so every interaction with it is
 * confined to this file. The rest of the app talks in ReadingPosition and
 * paragraph text, never in foliate types.
 */

export interface FoliateHandle {
  next(): void;
  prev(): void;
  goTo(target: string | number): void;
  /** Live documents for the sections currently rendered. */
  documents(): { doc: Document; index: number }[];
}

interface Props {
  file: Blob;
  initialLocation?: string | null;
  theme: 'light' | 'dark' | 'sepia';
  fontScale: number;
  onRelocate(pos: ReadingPosition, cfi: string | null): void;
  onSectionLoad(spineIndex: number, paragraphs: string[], doc: Document): void;
  onReady(
    handle: FoliateHandle,
    meta: { title: string; author: string | null; spineCount: number; cover: Blob | null },
  ): void;
}

const THEMES = {
  light: { bg: '#faf8f4', fg: '#1a1714' },
  sepia: { bg: '#f3e9d6', fg: '#3b2f22' },
  dark: { bg: '#12100e', fg: '#e6e0d6' },
} as const;

export function FoliateView({
  file,
  initialLocation,
  theme,
  fontScale,
  onRelocate,
  onSectionLoad,
  onReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);

  // Mount the view once per file.
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      // Loaded lazily: pulls in the format parser only when a book opens.
      await import('../../vendor/foliate-js/view.js');
      if (disposed) return;

      const view = document.createElement('foliate-view') as any;
      viewRef.current = view;
      host.replaceChildren(view);

      view.addEventListener('relocate', (e: CustomEvent) => {
        const detail = e.detail ?? {};
        onRelocate(positionFromRelocate(detail), detail.cfi ?? null);
      });

      view.addEventListener('load', (e: CustomEvent) => {
        const { doc, index } = e.detail ?? {};
        if (!doc) return;
        applyTheme(doc, theme, fontScale);
        onSectionLoad(index, blockElements(doc).map((el) => el.textContent?.trim() ?? ''), doc);
      });

      await view.open(file);
      if (disposed) return;

      // Page layout, set on the renderer that open() created. foliate centers the
      // text block itself through these attributes; putting max-width on the
      // book's own body instead fights that grid and collapses the page into one
      // narrow column pinned to the left of a wide screen.
      applyLayout(view);

      const book = view.book;
      // The real title, author and cover live in the book's own metadata — much
      // better than the filename guess made when the file was added.
      const cover = await book?.getCover?.().catch(() => null);
      onReady(
        {
          next: () => view.next(),
          prev: () => view.prev(),
          goTo: (target) => view.goTo(target),
          documents: () =>
            (view.renderer?.getContents?.() ?? [])
              .filter((c: any) => c?.doc)
              .map((c: any) => ({ doc: c.doc as Document, index: c.index as number })),
        },
        {
          title: book?.metadata?.title ?? 'Untitled',
          author: formatAuthor(book?.metadata?.author),
          spineCount: book?.sections?.length ?? 0,
          cover: cover instanceof Blob ? cover : null,
        },
      );

      if (initialLocation) {
        await view.init({ lastLocation: initialLocation });
      } else {
        await view.init({ showTextStart: true });
        // Many EPUBs ship no bodymatter landmark — this one points "start" at a
        // map — so foliate lands on front matter and the reader has to tap past
        // the cover, title, copyright and contents to reach the story. Fall back
        // to the first chapter-like entry in the table of contents.
        const start = storyStart(view.book);
        if (start !== null) await view.goTo(start);
      }
    })();

    return () => {
      disposed = true;
      viewRef.current?.close?.();
      viewRef.current = null;
      host.replaceChildren();
    };
    // Re-mounting on theme/scale change would lose reading position; those are
    // pushed into the live document by the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Push theme and font changes into already-rendered sections.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const doc of renderedDocuments(view)) applyTheme(doc, theme, fontScale);
  }, [theme, fontScale]);

  return <div ref={hostRef} className="foliate-host" />;
}

function renderedDocuments(view: any): Document[] {
  const contents = view?.renderer?.getContents?.() ?? [];
  return contents.map((c: any) => c?.doc).filter(Boolean);
}

function applyTheme(doc: Document, theme: Props['theme'], fontScale: number) {
  const { bg, fg } = THEMES[theme];
  const id = 'shiori-theme';

  // Publisher stylesheets routinely paint a background on a wrapper div, which
  // beats html/body and leaves a white page in dark mode. Clear the background
  // on every element, then paint it once on the root.
  const css = `
    html, body {
      background: ${bg} !important;
      color: ${fg} !important;
    }
    body * {
      background-color: transparent !important;
      color: ${fg} !important;
      border-color: color-mix(in srgb, ${fg} 25%, transparent) !important;
    }
    body {
      font-size: ${fontScale}em !important;
      line-height: 1.65 !important;
    }
    p { text-align: justify; hyphens: auto; }
    a { color: inherit !important; text-decoration-color: ${fg}66; }
    img, svg, image {
      max-width: 100% !important;
      height: auto !important;
    }
    /* Cover and other full-page art must not be inverted or tinted. */
    img { background: transparent !important; }
  `;

  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    doc.head?.append(style);
  }
  style.textContent = css;
}

function formatAuthor(author: unknown): string | null {
  if (!author) return null;
  if (typeof author === 'string') return author;
  if (Array.isArray(author)) {
    return author.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ') || null;
  }
  return (author as { name?: string }).name ?? null;
}

/**
 * Where the story actually begins.
 *
 * Prefers an explicit bodymatter landmark; otherwise walks the table of contents
 * for the first entry that isn't front matter. Returns an href for foliate to
 * navigate to, or null when nothing better than the default is available.
 */
function storyStart(book: any): string | null {
  const bodymatter = book?.landmarks?.find((m: any) =>
    (m?.type ?? []).some((t: string) => t === 'bodymatter'),
  );
  if (bodymatter?.href) return bodymatter.href;

  const FRONT_MATTER =
    /^(cover|title|copyright|contents|table of contents|dedication|epigraph|map|acknowledg|about the author|also by|praise|imprint|colophon|half title|frontispiece)/i;

  const entries: any[] = book?.toc ?? [];
  const first = entries.find((t) => {
    const label = (t?.label ?? '').trim();
    return label.length > 0 && !FRONT_MATTER.test(label);
  });

  return first?.href ?? null;
}

/**
 * Page geometry.
 *
 * `max-inline-size` is the measure of a single column, and `max-column-count`
 * lets a wide screen show a two-page spread instead of one column stranded on
 * the left. foliate applies its own centering grid around these, so nothing here
 * should be duplicated as CSS on the book's body.
 */
function applyLayout(view: any): void {
  const renderer = view?.renderer;
  if (!renderer?.setAttribute) return;
  // Only the measure is ours; gap and margin keep foliate's defaults, which its
  // column snapping is calibrated against. Overriding gap misaligns the columns
  // and bleeds text off the edge of a wide screen.
  renderer.setAttribute('max-inline-size', '640px');
  renderer.setAttribute('max-block-size', '1400px');
  renderer.setAttribute('max-column-count', '2');
}
