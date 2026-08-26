import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  selectBeats,
  lookaheadDepth,
  compare,
  type Beat,
  type ReaderTelemetry,
  type ReadingPosition,
} from '@shiori/core';
import { VelocityTracker } from '../lib/velocity';
import { requestArt, artUrl, type ArtState } from '../lib/api';

interface Options {
  bookId: string | null;
  beats: readonly Beat[];
  entry: 'linear' | 'jump' | 'restore';
  beatsPerScreen: number;
}

interface Illustrator {
  /** Art for the beat the reader is currently inside, if any. */
  current: (ArtState & { beat: Beat }) | null;
  /** Everything ready so far, addressable by beat id. */
  ready: ReadonlyMap<string, ArtState>;
  depth: number;
  onRelocate: (pos: ReadingPosition) => void;
}

const POLL_MS = 2_500;

/**
 * Drives illustration generation from the reader's position.
 *
 * The rule this enforces: telemetry decides *how far ahead* to generate, never
 * *what* to generate. Beats come from the book alone, so the art cache stays
 * shared across readers and devices.
 */
export function useIllustrator({ bookId, beats, entry, beatsPerScreen }: Options): Illustrator {
  const [art, setArt] = useState<Map<string, ArtState>>(new Map());
  const [position, setPosition] = useState<ReadingPosition | null>(null);
  const velocity = useRef(new VelocityTracker());
  const inflight = useRef<Set<string>>(new Set());

  const telemetry = useMemo<ReaderTelemetry>(
    () => ({
      msPerParagraph: velocity.current.median(),
      beatsPerScreen,
      entry,
      direction: position ? velocity.current.direction(position) : 0,
    }),
    [beatsPerScreen, entry, position],
  );

  const onRelocate = useCallback((pos: ReadingPosition) => {
    velocity.current.record(pos);
    setPosition(pos);
  }, []);

  // Request the current beat plus the adaptive lookahead window.
  useEffect(() => {
    if (!bookId || !position || beats.length === 0) return;

    const wanted = selectBeats(beats, position, telemetry);
    const missing = wanted
      .map((b) => b.id)
      .filter((id) => art.get(id)?.status !== 'ready' && !inflight.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => inflight.current.add(id));
    let cancelled = false;

    requestArt({ bookId, beatIds: missing })
      .then(({ art: states }) => {
        if (cancelled) return;
        setArt((prev) => merge(prev, states));
        states
          .filter((s) => s.status !== 'pending')
          .forEach((s) => inflight.current.delete(s.beatId));
      })
      .catch(() => missing.forEach((id) => inflight.current.delete(id)));

    return () => {
      cancelled = true;
    };
  }, [bookId, position, beats, telemetry, art]);

  // Poll while anything is still rendering.
  useEffect(() => {
    if (!bookId) return;
    const pending = [...art.values()].filter((a) => a.status === 'pending').map((a) => a.beatId);
    if (pending.length === 0) return;

    const timer = setInterval(() => {
      requestArt({ bookId, beatIds: pending })
        .then(({ art: states }) => {
          setArt((prev) => merge(prev, states));
          states
            .filter((s) => s.status !== 'pending')
            .forEach((s) => inflight.current.delete(s.beatId));
        })
        .catch(() => {});
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [bookId, art]);

  const current = useMemo(() => {
    if (!position) return null;
    // The most recent beat at or before the reader's position.
    const passed = beats.filter((b) => compare(b, position) <= 0);
    const beat = passed[passed.length - 1];
    if (!beat) return null;
    const state = art.get(beat.id);
    return state?.status === 'ready' ? { ...state, beat } : null;
  }, [position, beats, art]);

  return {
    current,
    ready: art,
    depth: lookaheadDepth(telemetry),
    onRelocate,
  };
}

function merge(prev: Map<string, ArtState>, next: readonly ArtState[]): Map<string, ArtState> {
  const out = new Map(prev);
  for (const state of next) {
    out.set(state.beatId, {
      ...state,
      url: state.status === 'ready' ? (state.url ?? null) : null,
    });
  }
  return out;
}

export { artUrl };
