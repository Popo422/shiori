import { describe, it, expect } from 'vitest';
import { VelocityTracker } from './velocity';

const at = (spineIndex: number, paraIndex: number) => ({ spineIndex, paraIndex });

describe('VelocityTracker.direction', () => {
  /**
   * The regression this guards.
   *
   * The reader records the new position and then asks for the direction of that
   * same position. When direction compared its argument against the stored last
   * position, it was comparing a position with itself and returned 0 forever —
   * so confidence never took the forward path and a reader paging backwards was
   * never noticed.
   */
  it('reports forward travel after the move has been recorded', () => {
    const v = new VelocityTracker();
    v.record(at(0, 0), 1_000);
    v.record(at(0, 5), 6_000);
    expect(v.direction()).toBe(1);
  });

  it('reports backward travel when the reader flips back', () => {
    const v = new VelocityTracker();
    v.record(at(0, 20), 1_000);
    v.record(at(0, 12), 6_000);
    expect(v.direction()).toBe(-1);
  });

  it('is unknown before any movement has happened', () => {
    const v = new VelocityTracker();
    expect(v.direction()).toBe(0);
    v.record(at(0, 0), 1_000);
    expect(v.direction()).toBe(0);
  });

  it('holds the last known direction when a position repeats', () => {
    const v = new VelocityTracker();
    v.record(at(0, 0), 1_000);
    v.record(at(0, 4), 5_000);
    v.record(at(0, 4), 9_000); // a relocate that did not move
    expect(v.direction()).toBe(1);
  });

  it('still learns direction from a jump too large to be a pace sample', () => {
    const v = new VelocityTracker();
    v.record(at(0, 0), 1_000);
    // >30 paragraphs is discarded as a pace sample, but it is still a direction.
    v.record(at(0, 200), 3_000);
    expect(v.direction()).toBe(1);
  });

  it('forgets direction on reset', () => {
    const v = new VelocityTracker();
    v.record(at(0, 0), 1_000);
    v.record(at(0, 5), 6_000);
    v.reset();
    expect(v.direction()).toBe(0);
    expect(v.last()).toBeNull();
  });
});

describe('VelocityTracker.median', () => {
  it('is not poisoned by putting the phone down mid-chapter', () => {
    const v = new VelocityTracker();
    v.record(at(0, 0), 0);
    v.record(at(0, 1), 4_000);
    v.record(at(0, 2), 8_000);
    // A 10-minute gap: discarded rather than averaged in.
    v.record(at(0, 3), 620_000);
    expect(v.median()).toBe(4_000);
  });

  it('reports a neutral pace before any sample exists', () => {
    expect(new VelocityTracker().median()).toBe(8_000);
  });
});

describe('VelocityTracker.last', () => {
  it('exposes the most recent position for jump detection', () => {
    const v = new VelocityTracker();
    expect(v.last()).toBeNull();
    v.record(at(2, 7), 1_000);
    expect(v.last()).toEqual(at(2, 7));
  });
});
