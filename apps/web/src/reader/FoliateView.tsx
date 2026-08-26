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
}

interface Props {
  file: Blob;
  initialLocation?: string | null;
  theme: 'light' | 'dark' | 'sepia';
  fontScale: number;
  onRelocate(pos: ReadingPosition, cfi: string | null): void;
  onSectionLoad(spineIndex: number, paragraphs: string[], doc: Document): void;
  onReady(handle: FoliateHandle, meta: { title: string; author: string | null; spineCount: number }): void;
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

      const book = view.book;
      onReady(
        {
          next: () => view.next(),
          prev: () => view.prev(),
          goTo: (target) => view.goTo(target),
        },
        {
          title: book?.metadata?.title ?? 'Untitled',
          author: formatAuthor(book?.metadata?.author),
          spineCount: book?.sections?.length ?? 0,
        },
      );

      await view.init({ lastLocation: initialLocation ?? undefined, showTextStart: !initialLocation });
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
  const css = `
    html, body { background: ${bg} !important; color: ${fg} !important; }
    body { font-size: ${fontScale}em !important; line-height: 1.65 !important; }
    p { text-align: justify; hyphens: auto; }
    a { color: inherit; }
    img { max-width: 100%; height: auto; }
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
