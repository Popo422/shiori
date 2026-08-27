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
  /** How many illustrations are still rendering, for status display. */
  pending: number;
  /** True when the beat under the reader failed to render. */
  currentFailed: boolean;
  /** Put a beat back into rendering, after asking for it to be redrawn. */
  markPending: (beatId: string) => void;
  onRelocate: (pos: ReadingPosition) => void;
}

const POLL_MS = 2_500;
/** A render that has not landed in two minutes is not going to. */
const POLL_TIMEOUT_MS = 120_000;

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

  const markPending = useCallback((beatId: string) => {
    setArt((prev) => {
      const row = prev.get(beatId);
      if (!row) return prev;
      const out = new Map(prev);
      out.set(beatId, { ...row, status: 'pending', url: null });
      return out;
    });
  }, []);

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

    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += POLL_MS;

      // Give up rather than polling a stuck render forever — an endless 2.5s
      // interval is a real battery cost on a phone left open on one page.
      if (elapsed >= POLL_TIMEOUT_MS) {
        clearInterval(timer);
        setArt((prev) => {
          const out = new Map(prev);
          for (const id of pending) {
            const row = out.get(id);
            if (row?.status === 'pending') out.set(id, { ...row, status: 'failed' });
            inflight.current.delete(id);
          }
          return out;
        });
        return;
      }

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

  /** The beat the reader is inside, whatever state its art is in. */
  const currentBeat = useMemo(() => {
    if (!position) return null;
    const passed = beats.filter((b) => compare(b, position) <= 0);
    return passed[passed.length - 1] ?? null;
  }, [position, beats]);

  const currentState = currentBeat ? art.get(currentBeat.id) : undefined;

  return {
    current:
      currentBeat && currentState?.status === 'ready'
        ? { ...currentState, beat: currentBeat }
        : null,
    ready: art,
    depth: lookaheadDepth(telemetry),
    pending: [...art.values()].filter((a) => a.status === 'pending').length,
    currentFailed: currentState?.status === 'failed',
    markPending,
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
