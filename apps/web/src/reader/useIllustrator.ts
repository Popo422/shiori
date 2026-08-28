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
import { isDiscontinuous } from '../lib/position';
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
/** How long to poll briskly before easing off. */
const POLL_TIMEOUT_MS = 120_000;
/** After the timeout, keep checking occasionally instead of abandoning the plate. */
const SLOW_POLL_MS = 15_000;

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

  /**
   * How the reader arrived where they are now.
   *
   * `entry` describes only how the book was *opened*, so on its own it can never
   * become 'jump' — a reader who skips into the middle of chapter 12 kept the
   * confidence of the linear open they started with and generated a deep buffer
   * into a chapter they may leave immediately. A discontinuous relocate is that
   * jump, so it is detected here and decays back to linear as reading resumes.
   */
  const [arrival, setArrival] = useState<'linear' | 'jump' | 'restore'>(entry);

  /**
   * Mirror of art for guard checks.
   *
   * Depending on art directly made this effect re-run on its own responses:
   * every reply called setArt, which re-triggered the request, which produced
   * hundreds of POSTs per chapter on a fast reader.
   */
  const artRef = useRef(art);
  artRef.current = art;

  /**
   * How many illustrations are rendering.
   *
   * The poll effect keys off this count rather than the art map itself: the map
   * gets a new identity on every response, which would restart the interval
   * continuously, while the count only changes when work actually starts or
   * finishes.
   */
  const pendingCount = useMemo(
    () => [...art.values()].filter((a) => a.status === 'pending').length,
    [art],
  );

  const telemetry = useMemo<ReaderTelemetry>(
    () => ({
      msPerParagraph: velocity.current.median(),
      beatsPerScreen,
      entry: arrival,
      direction: position ? velocity.current.direction() : 0,
    }),
    [beatsPerScreen, arrival, position],
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
    const previous = velocity.current.last();
    velocity.current.record(pos);

    // A move too large to be a page turn is a jump, not reading. Treat it as a
    // cold entry: generate what is on screen and wait to see which way the
    // reader goes, rather than spending a full buffer on a guess.
    if (previous && isDiscontinuous(previous, pos)) setArrival('jump');
    else setArrival((prev) => (prev === 'jump' ? 'linear' : prev));

    setPosition(pos);
  }, []);

  // Request the current beat plus the adaptive lookahead window.
  useEffect(() => {
    if (!bookId || !position || beats.length === 0) return;

    const wanted = selectBeats(beats, position, telemetry);
    const missing = wanted
      .map((b) => b.id)
      .filter((id) => artRef.current.get(id)?.status !== 'ready' && !inflight.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => inflight.current.add(id));
    let cancelled = false;

    requestArt({ bookId, beatIds: missing })
      .then(({ art: states }) => {
        // The request itself is not wasted even when this effect has been
        // superseded — the server has already claimed the work, and the reply
        // still tells us what is rendering. Record it rather than discarding it.
        setArt((prev) => merge(prev, states));
        states
          .filter((s) => s.status !== 'pending')
          .forEach((s) => inflight.current.delete(s.beatId));
      })
      .catch(() => missing.forEach((id) => inflight.current.delete(id)))
      .finally(() => {
        // Turning a page re-runs this effect and tears down the previous one.
        // Without releasing the claim here, a beat whose request was in flight
        // at that moment stayed marked inflight forever and was never asked for
        // again — a plate that simply never loaded.
        if (cancelled) missing.forEach((id) => inflight.current.delete(id));
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, position, beats, telemetry]);

  // Poll while anything is still rendering.
  useEffect(() => {
    if (!bookId || pendingCount === 0) return;

    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += POLL_MS;

      // Re-read what is pending on every tick rather than closing over the list
      // from when the interval started. Art that began rendering afterwards was
      // otherwise never polled for, and its plate stayed a skeleton for good.
      const pending = [...artRef.current.values()]
        .filter((a) => a.status === 'pending')
        .map((a) => a.beatId);

      if (pending.length === 0) {
        clearInterval(timer);
        return;
      }

      // Back off rather than give up. An endless 2.5s interval is a real
      // battery cost, but marking art failed locally left a skeleton that could
      // never recover even once the server finished — the server reclaims
      // abandoned renders on its own, so a slow poll will eventually see them.
      if (elapsed >= POLL_TIMEOUT_MS && elapsed % SLOW_POLL_MS !== 0) return;

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
  }, [bookId, pendingCount]);

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
    pending: pendingCount,
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
