import { useCallback, useEffect, useRef, useState } from 'react';
import type { Beat, ReadingPosition } from '@shiori/core';
import { FoliateView, type FoliateHandle } from '../reader/FoliateView';
import { useIllustrator } from '../reader/useIllustrator';
import { Illustration } from './Illustration';
import { analyzeSection, getBeats, registerBook, artUrl } from '../lib/api';
import { estimateBeatsPerScreen } from '../lib/position';
import { rememberLocation, updateMetadata, type StoredBook } from '../lib/db';
import { TARGET_SPACING } from '../lib/constants';

interface Props {
  book: StoredBook;
  onClose(): void;
}

type Theme = 'light' | 'dark' | 'sepia';

export function Reader({ book, onClose }: Props) {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [theme, setTheme] = useState<Theme>(() => stored('shiori:theme', 'dark'));
  const [fontScale, setFontScale] = useState(() => Number(stored('shiori:font', '1')));
  const [beatsPerScreen, setBeatsPerScreen] = useState(1);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handle = useRef<FoliateHandle | null>(null);
  const analyzed = useRef<Set<number>>(new Set());

  const entry = book.lastLocation ? 'restore' : 'linear';
  const illustrator = useIllustrator({ bookId: book.id, beats, entry, beatsPerScreen });

  useEffect(() => localStorage.setItem('shiori:theme', theme), [theme]);
  useEffect(() => localStorage.setItem('shiori:font', String(fontScale)), [fontScale]);

  const onReady = useCallback(
    (
      h: FoliateHandle,
      meta: { title: string; author: string | null; spineCount: number; cover: Blob | null },
    ) => {
      handle.current = h;
      const title = meta.title || book.title;
      const author = meta.author ?? book.author;

      // Replace the filename guess with the book's own metadata, so the shelf
      // shows a real title and cover instead of "red rising" and initials.
      updateMetadata(book.id, { title, author, cover: meta.cover }).catch(() => {});

      registerBook({
        bookId: book.id,
        title,
        author,
        format: book.format,
        spineCount: meta.spineCount,
      }).catch(() => {});
    },
    [book],
  );

  /**
   * Each time a section renders, make sure it has beats. Analysis is lazy and
   * cached server-side, so this is a no-op for any book someone has read before.
   */
  const onSectionLoad = useCallback(
    (spineIndex: number, paragraphs: string[], doc: Document) => {
      setBeatsPerScreen(estimateBeatsPerScreen(doc, TARGET_SPACING));
      if (analyzed.current.has(spineIndex)) return;
      analyzed.current.add(spineIndex);

      getBeats(book.id, spineIndex)
        .then(({ beats: found }) =>
          found.length > 0
            ? found
            : analyzeSection({ bookId: book.id, spineIndex, paragraphs }).then((r) => r.beats),
        )
        .then((found) => setBeats((prev) => mergeBeats(prev, found)))
        .catch(() => analyzed.current.delete(spineIndex));
    },
    [book.id],
  );

  const onRelocate = useCallback(
    (pos: ReadingPosition, cfi: string | null) => {
      illustrator.onRelocate(pos);
      if (cfi) rememberLocation(book.id, cfi).catch(() => {});
    },
    [illustrator, book.id],
  );

  // Keyboard paging, so it works on a laptop too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') handle.current?.next();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') handle.current?.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = illustrator.current;
  const showArt = current && !dismissed.has(current.beat.id);

  return (
    <div className={`reader reader--${theme}`}>
      <FoliateView
        file={book.file}
        initialLocation={book.lastLocation}
        theme={theme}
        fontScale={fontScale}
        onRelocate={onRelocate}
        onSectionLoad={onSectionLoad}
        onReady={onReady}
      />

      {/* Tap zones: left/right page, center toggles chrome. */}
      <div className="zones" onClick={(e) => e.stopPropagation()}>
        <button className="zone zone--prev" onClick={() => handle.current?.prev()} aria-label="Previous page" />
        <button className="zone zone--menu" onClick={() => setChromeVisible((v) => !v)} aria-label="Toggle menu" />
        <button className="zone zone--next" onClick={() => handle.current?.next()} aria-label="Next page" />
      </div>

      {showArt && current && (
        <Illustration
          url={current.url ?? artUrl(book.id, current.beat.id)}
          beat={current.beat}
          onDismiss={() => setDismissed((prev) => new Set(prev).add(current.beat.id))}
        />
      )}

      <div className={`chrome ${chromeVisible ? 'is-visible' : ''}`}>
        <div className="chrome__bar">
          <button className="chrome__button" onClick={onClose}>
            Library
          </button>
          <p className="chrome__title">{book.title}</p>
        </div>
        <div className="chrome__controls">
          <div className="control">
            <span className="control__label">Theme</span>
            <div className="segmented">
              {(['light', 'sepia', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  className={`segmented__option ${theme === t ? 'is-active' : ''}`}
                  onClick={() => setTheme(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="control">
            <span className="control__label">Text size</span>
            <div className="segmented">
              <button className="segmented__option" onClick={() => setFontScale((s) => Math.max(0.7, s - 0.1))}>
                A−
              </button>
              <button className="segmented__option" onClick={() => setFontScale((s) => Math.min(1.8, s + 0.1))}>
                A+
              </button>
            </div>
          </div>
          <p className="chrome__status">{status(beats.length, illustrator)}</p>
        </div>
      </div>
    </div>
  );
}

function mergeBeats(prev: Beat[], next: Beat[]): Beat[] {
  const byId = new Map(prev.map((b) => [b.id, b]));
  for (const beat of next) byId.set(beat.id, beat);
  return [...byId.values()].sort((a, b) =>
    a.spineIndex !== b.spineIndex ? a.spineIndex - b.spineIndex : a.paraIndex - b.paraIndex,
  );
}

function stored<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T | null) ?? fallback;
}

/** Plain-language state, so a stalled render never looks like a broken app. */
function status(
  beatCount: number,
  illustrator: { ready: ReadonlyMap<string, unknown>; pending: number; depth: number },
): string {
  if (beatCount === 0) return 'Looking ahead for scenes to illustrate…';

  const done = illustrator.ready.size - illustrator.pending;
  if (illustrator.pending > 0) {
    return `Drawing ${illustrator.pending} ${illustrator.pending === 1 ? 'scene' : 'scenes'}…`;
  }
  return `${done} of ${beatCount} illustrated · reading ${illustrator.depth} ahead`;
}
