import { describe, it, expect } from 'vitest';
import { sheetsResolved, type BeatLike, type EraLike } from './resume';

const beat = (over: Partial<BeatLike> = {}): BeatLike => ({
  spineIndex: 4,
  characterIds: ['book:darrow'],
  ...over,
});

const era = (over: Partial<EraLike> = {}): EraLike => ({
  characterId: 'book:darrow',
  fromSpineIndex: 0,
  referenceKey: 'ref/book/book:darrow@0.jpg',
  ...over,
});

describe('sheetsResolved', () => {
  /**
   * The regression this guards.
   *
   * A render that stopped after drawing a sheet left its row pending, and a
   * pending row was excluded from the work the next request scheduled. Nothing
   * rescheduled it, so the beat only resumed once the row aged out as stale —
   * three minutes per sheet, and a scene introducing three characters sat as a
   * skeleton for nine.
   */
  it('reports a beat whose only sheet is drawn as ready to resume', () => {
    expect(sheetsResolved(beat(), [era()])).toBe(true);
  });

  it('waits while a sheet is still being drawn', () => {
    expect(sheetsResolved(beat(), [era({ referenceKey: null })])).toBe(false);
  });

  it('waits when one character of several is still missing a sheet', () => {
    const pair = beat({ characterIds: ['book:darrow', 'book:mustang'] });
    const eras = [
      era(),
      era({ characterId: 'book:mustang', referenceKey: null }),
    ];
    expect(sheetsResolved(pair, eras)).toBe(false);
  });

  it('resumes once the last outstanding sheet lands', () => {
    const pair = beat({ characterIds: ['book:darrow', 'book:mustang'] });
    const eras = [era(), era({ characterId: 'book:mustang' })];
    expect(sheetsResolved(pair, eras)).toBe(true);
  });

  it('treats a sheet the model refused as resolved, not as a reason to wait', () => {
    // A refused sheet costs consistency, not the illustration. Waiting on it
    // would mean the beat never draws at all.
    expect(sheetsResolved(beat(), [era({ referenceKey: 'unavailable' })])).toBe(true);
  });

  it('leaves a beat alone when no era is recorded yet', () => {
    // Analysis has not caught up; the row is not parked on a sheet.
    expect(sheetsResolved(beat(), [])).toBe(false);
  });

  it('resolves against the era in force at the beat, not the newest one', () => {
    // A character remade partway through has more than one era. A beat early in
    // the book waits on the early sheet, and must not be held up by a later
    // era whose sheet has not been drawn.
    const early = beat({ spineIndex: 2 });
    const eras = [
      era({ fromSpineIndex: 0 }),
      era({ fromSpineIndex: 10, referenceKey: null }),
    ];
    expect(sheetsResolved(early, eras)).toBe(true);
  });

  it('waits when the era in force at a later beat has no sheet yet', () => {
    const late = beat({ spineIndex: 12 });
    const eras = [
      era({ fromSpineIndex: 0 }),
      era({ fromSpineIndex: 10, referenceKey: null }),
    ];
    expect(sheetsResolved(late, eras)).toBe(false);
  });

  it('ignores eras belonging to other characters', () => {
    expect(sheetsResolved(beat(), [era({ characterId: 'book:someone-else' })])).toBe(false);
  });
});
