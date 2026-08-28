import { describe, it, expect } from 'vitest';
import { isDiscontinuous } from './position';

const at = (spineIndex: number, paraIndex: number) => ({ spineIndex, paraIndex });

describe('isDiscontinuous', () => {
  it('treats an ordinary page turn as continuous', () => {
    expect(isDiscontinuous(at(3, 10), at(3, 12))).toBe(false);
  });

  it('treats reading on into the next section as continuous', () => {
    // The last page of a section lands at the top of the following one; that is
    // reading, not jumping, and must not collapse the buffer at every chapter.
    expect(isDiscontinuous(at(3, 140), at(4, 0))).toBe(false);
  });

  it('treats a table-of-contents jump across sections as a jump', () => {
    expect(isDiscontinuous(at(1, 20), at(12, 0))).toBe(true);
  });

  it('treats a long scrub within one section as a jump', () => {
    expect(isDiscontinuous(at(3, 10), at(3, 200))).toBe(true);
  });

  it('treats jumping backwards to an earlier section as a jump', () => {
    expect(isDiscontinuous(at(9, 5), at(2, 30))).toBe(true);
  });

  it('treats landing deep inside the next section as a jump, not a page turn', () => {
    expect(isDiscontinuous(at(3, 140), at(4, 90))).toBe(true);
  });

  it('does not fire on a small backward flip', () => {
    expect(isDiscontinuous(at(3, 20), at(3, 14))).toBe(false);
  });
});
