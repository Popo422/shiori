import { useCallback, useEffect, useRef, useState } from 'react';
import type { Beat, ReadingPosition } from '@shiori/core';
import { FoliateView, type FoliateHandle } from '../reader/FoliateView';
import { useIllustrator } from '../reader/useIllustrator';
import { syncPlates, visiblePlate, prefetch, type PlateSource } from '../reader/plates';
import { analyzeSection, getBeats, registerBook, regenerateArt, artUrl } from '../lib/api';
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
  const [onPlate, setOnPlate] = useState<string | null>(null);
  const [redrawing, setRedrawing] = useState(false);

  const handle = useRef<FoliateHandle | null>(null);
  const plateSources = useRef<PlateSource[]>([]);
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
   * Load every beat the book already has, before any section renders.
   *
   * A plate inserted into a section you are already reading reflows the page
   * under you. Knowing the beats up front means the page is reserved as the
   * section is laid out, so the illustration fills a space that was always
   * there rather than shoving the text along when it arrives.
   */
  useEffect(() => {
    getBeats(book.id)
      .then(({ beats: found }) => {
        found.forEach((b) => analyzed.current.add(b.spineIndex));
        setBeats((prev) => mergeBeats(prev, found));
      })
      .catch(() => {});
  }, [book.id]);

  const onSectionLoad = useCallback(
    (spineIndex: number, paragraphs: string[], doc: Document) => {
      setBeatsPerScreen(estimateBeatsPerScreen(doc, TARGET_SPACING));

      // Populate this section now. The sync effect only runs when React state
      // changes, so a section rendered after the last run would otherwise show
      // no plate at all until something unrelated happened to trigger it.
      syncPlates(doc, spineIndex, plateSources.current);
      if (analyzed.current.has(spineIndex)) return;
      analyzed.current.add(spineIndex);

      // Only reached for a section nobody has analyzed yet.
      analyzeSection({ bookId: book.id, spineIndex, paragraphs })
        .then(({ beats: found }) => setBeats((prev) => mergeBeats(prev, found)))
        .catch(() => analyzed.current.delete(spineIndex));
    },
    [book.id],
  );

  const onRelocate = useCallback(
    (pos: ReadingPosition, cfi: string | null) => {
      illustrator.onRelocate(pos);
      const docs = handle.current?.documents() ?? [];
      setOnPlate(docs.map(({ doc }) => visiblePlate(doc)).find(Boolean) ?? null);
      if (cfi) rememberLocation(book.id, cfi).catch(() => {});
    },
    [illustrator, book.id],
  );

  /**
   * Put illustrations into the book's own document, so foliate paginates them
   * as real pages.
   *
   * An overlay had to fake paging by hiding itself, which meant turning back
   * never returned to the art. As content, a plate gets its own page in the
   * sequence and behaves like every other page in both directions.
   *
   * Runs on every art change so a skeleton is replaced the moment its
   * illustration lands.
   */
  useEffect(() => {
    const docs = handle.current?.documents() ?? [];
    if (docs.length === 0) return;

    const sources: PlateSource[] = beats
      .map((beat) => {
        const state = illustrator.ready.get(beat.id);
        if (!state || state.status === 'failed') return null;
        return { beat, url: state.status === 'ready' ? artUrl(book.id, beat.id) : null };
      })
      .filter((p): p is PlateSource => p !== null);

    plateSources.current = sources;
    for (const { doc, index } of docs) syncPlates(doc, index, sources);

    // Download ahead of the reader. A plate rendered long ago still flashes
    // blank if its JPEG only starts downloading once the page is on screen.
    prefetch(sources.map((s) => s.url).filter((u): u is string => u !== null));
  }, [beats, illustrator.ready, book.id]);

  /** Recheck after a turn settles; relocate does not fire on every page. */
  const syncPlateControl = useCallback(() => {
    window.setTimeout(() => {
      const docs = handle.current?.documents() ?? [];
      setOnPlate(docs.map(({ doc }) => visiblePlate(doc)).find(Boolean) ?? null);
    }, 350);
  }, []);

  const turn = useCallback(
    (direction: 1 | -1) => {
      if (direction === 1) handle.current?.next();
      else handle.current?.prev();
      syncPlateControl();
    },
    [syncPlateControl],
  );

  // Keyboard paging, so it works on a laptop too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') turn(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

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
        <button className="zone zone--prev" onClick={() => turn(-1)} aria-label="Previous page" />
        <button className="zone zone--menu" onClick={() => setChromeVisible((v) => !v)} aria-label="Toggle menu" />
        <button className="zone zone--next" onClick={() => turn(1)} aria-label="Next page" />
      </div>

      {/* Only offered while a plate is the page being looked at. */}
      {onPlate && (
        <button
          className="redraw"
          disabled={redrawing}
          onClick={() => {
            setRedrawing(true);
            regenerateArt({ bookId: book.id, beatId: onPlate })
              .then(() => illustrator.markPending(onPlate))
              .catch(() => {})
              .finally(() => setRedrawing(false));
          }}
        >
          {redrawing ? 'Drawing…' : 'Draw again'}
        </button>
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
