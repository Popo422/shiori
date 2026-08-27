import { describe, it, expect } from 'vitest';
import { lookaheadDepth, selectBeats, compare, MAX_LOOKAHEAD } from './buffer.js';
import type { Beat, ReaderTelemetry } from './types.js';

const telemetry = (over: Partial<ReaderTelemetry> = {}): ReaderTelemetry => ({
  msPerParagraph: 8_000,
  beatsPerScreen: 1,
  entry: 'linear',
  direction: 1,
  ...over,
});

const beat = (spineIndex: number, paraIndex: number): Beat => ({
  id: `${spineIndex}-${paraIndex}`,
  bookId: 'book',
  spineIndex,
  paraIndex,
  kind: 'scene',
  prompt: 'a quiet room',
  characterIds: [],
  settingId: null,
  salience: 0.5,
});

describe('lookaheadDepth', () => {
  it('reads ahead further for a fast reader than a slow one', () => {
    const fast = lookaheadDepth(telemetry({ msPerParagraph: 2_000 }));
    const slow = lookaheadDepth(telemetry({ msPerParagraph: 30_000 }));
    expect(fast).toBeGreaterThan(slow);
  });

  it('stops prefetching when the reader turns back', () => {
    expect(lookaheadDepth(telemetry({ direction: -1 }))).toBe(0);
  });

  it('is more cautious after a table-of-contents jump than a linear open', () => {
    const jumped = lookaheadDepth(telemetry({ entry: 'jump', beatsPerScreen: 3 }));
    const linear = lookaheadDepth(telemetry({ entry: 'linear', beatsPerScreen: 3 }));
    expect(jumped).toBeLessThan(linear);
  });

  it('never exceeds the cap, however fast the reader', () => {
    const depth = lookaheadDepth(telemetry({ msPerParagraph: 1, beatsPerScreen: 100 }));
    expect(depth).toBeLessThanOrEqual(MAX_LOOKAHEAD);
  });

  it('survives a zero or nonsense pace without collapsing', () => {
    expect(lookaheadDepth(telemetry({ msPerParagraph: 0 }))).toBeGreaterThan(0);
    expect(lookaheadDepth(telemetry({ msPerParagraph: Number.NaN }))).toBeGreaterThan(0);
  });
});

describe('selectBeats', () => {
  const beats = [beat(0, 0), beat(0, 10), beat(0, 20), beat(1, 5), beat(1, 30)];

  it('never returns beats the reader has already passed', () => {
    const selected = selectBeats(beats, { spineIndex: 0, paraIndex: 15 }, telemetry());
    expect(selected.every((b) => compare(b, { spineIndex: 0, paraIndex: 15 }) >= 0)).toBe(true);
  });

  it('crosses section boundaries in reading order', () => {
    const selected = selectBeats(
      beats,
      { spineIndex: 0, paraIndex: 25 },
      telemetry({ beatsPerScreen: 2 }),
    );
    expect(selected[0]).toMatchObject({ spineIndex: 1, paraIndex: 5 });
  });

  it('still returns the current beat when confidence is zero', () => {
    const selected = selectBeats(
      beats,
      { spineIndex: 0, paraIndex: 0 },
      telemetry({ direction: -1 }),
    );
    expect(selected).toHaveLength(1);
  });

  it('returns more for a skimmer than for a careful reader', () => {
    const pos = { spineIndex: 0, paraIndex: 0 };
    const skimming = selectBeats(beats, pos, telemetry({ msPerParagraph: 1_500, beatsPerScreen: 2 }));
    const savouring = selectBeats(beats, pos, telemetry({ msPerParagraph: 40_000 }));
    expect(skimming.length).toBeGreaterThan(savouring.length);
  });
});
