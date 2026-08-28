import { describe, it, expect } from 'vitest';
import { buildPrompt, referenceKeys, dimensionsFor, appearanceAt, STYLE } from './prompt.js';
import type { Beat, CharacterSheet } from './types.js';

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: 'b1',
  bookId: 'book',
  spineIndex: 0,
  paraIndex: 3,
  kind: 'character',
  prompt: 'a girl in a red coat on a snowy platform',
  characterIds: [],
  settingId: null,
  salience: 0.8,
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  id: 'book:mei',
  bookId: 'book',
  name: 'Mei',
  appearances: [
    {
      fromSpineIndex: 0,
      descriptor: 'short black hair, grey eyes, red wool coat',
      referenceKey: 'ref/book/book:mei.jpg',
    },
  ],
  ...over,
});

describe('dimensionsFor', () => {
  it('gives character beats a portrait frame and action beats a landscape one', () => {
    const portrait = dimensionsFor('character');
    const spread = dimensionsFor('action');
    expect(portrait.height).toBeGreaterThan(portrait.width);
    expect(spread.width).toBeGreaterThan(spread.height);
  });

  it('stays inside the model 256..1920 range on every axis', () => {
    for (const kind of ['character', 'scene', 'action', 'item'] as const) {
      const { width, height } = dimensionsFor(kind);
      expect(width).toBeGreaterThanOrEqual(256);
      expect(height).toBeGreaterThanOrEqual(256);
      expect(width).toBeLessThanOrEqual(1920);
      expect(height).toBeLessThanOrEqual(1920);
    }
  });
});

describe('buildPrompt', () => {
  it('carries the house style and the scene description', () => {
    const result = buildPrompt(beat(), []);
    expect(result).toContain(STYLE.positive);
    expect(result).toContain('snowy platform');
  });

  it('includes descriptors only for characters actually in the beat', () => {
    const cast = [sheet(), sheet({ id: 'book:ren', name: 'Ren', appearances: [{ fromSpineIndex: 0, descriptor: 'tall, scarred', referenceKey: null }] })];
    const result = buildPrompt(beat({ characterIds: ['book:mei'] }), cast);
    expect(result).toContain('red wool coat');
    expect(result).not.toContain('scarred');
  });

  it('reads cleanly when nobody is present', () => {
    expect(buildPrompt(beat({ kind: 'scene' }), [])).not.toContain('Characters —');
  });
});

describe('referenceKeys', () => {
  it('respects the four-image limit the model imposes', () => {
    const cast = Array.from({ length: 7 }, (_, i) =>
      sheet({
        id: `book:c${i}`,
        appearances: [
          { fromSpineIndex: 0, descriptor: 'a person', referenceKey: `ref/book/c${i}.jpg` },
        ],
      }),
    );
    const keys = referenceKeys(beat({ characterIds: cast.map((c) => c.id) }), cast);
    expect(keys.length).toBeLessThanOrEqual(4);
  });

  it('skips characters who have no sheet yet', () => {
    const cast = [sheet({ appearances: [{ fromSpineIndex: 0, descriptor: 'a person', referenceKey: null }] })];
    expect(referenceKeys(beat({ characterIds: ['book:mei'] }), cast)).toEqual([]);
  });
});

describe('appearanceAt', () => {
  // Red Rising carves Darrow from a small Red into a tall Gold partway through.
  const darrow: CharacterSheet = {
    id: 'rr:darrow',
    bookId: 'rr',
    name: 'Darrow',
    appearances: [
      { fromSpineIndex: 0, descriptor: 'lean Red, rust-red hair, small', referenceKey: 'a.jpg' },
      { fromSpineIndex: 14, descriptor: 'tall Gold, golden hair, sculpted', referenceKey: 'b.jpg' },
    ],
  };

  it('draws him as a Red before the carving', () => {
    expect(appearanceAt(darrow, 3)?.descriptor).toContain('rust-red');
  });

  it('draws him as a Gold after it', () => {
    expect(appearanceAt(darrow, 20)?.descriptor).toContain('golden');
  });

  it('switches exactly at the boundary, not one section late', () => {
    expect(appearanceAt(darrow, 13)?.descriptor).toContain('rust-red');
    expect(appearanceAt(darrow, 14)?.descriptor).toContain('golden');
  });

  it('never reveals a later appearance to an earlier reader', () => {
    // The whole point: a reader in chapter 3 must not see what he becomes.
    for (let spine = 0; spine < 14; spine++) {
      expect(appearanceAt(darrow, spine)?.descriptor).not.toContain('golden');
    }
  });

  it('uses the matching era reference sheet, not a fixed one', () => {
    expect(appearanceAt(darrow, 2)?.referenceKey).toBe('a.jpg');
    expect(appearanceAt(darrow, 30)?.referenceKey).toBe('b.jpg');
  });

  it('handles the ordinary case of a character who never changes', () => {
    const mei = sheet();
    expect(appearanceAt(mei, 0)?.descriptor).toContain('red wool coat');
    expect(appearanceAt(mei, 99)?.descriptor).toContain('red wool coat');
  });

  it('falls back to the earliest era rather than dropping the character', () => {
    const late: CharacterSheet = {
      id: 'x',
      bookId: 'b',
      name: 'X',
      appearances: [{ fromSpineIndex: 5, descriptor: 'appears late', referenceKey: null }],
    };
    expect(appearanceAt(late, 0)?.descriptor).toBe('appears late');
  });
});

describe('buildPrompt omitBeat — the softened retry', () => {
  const place = {
    id: 'book:pit',
    bookId: 'book',
    name: 'The Pit',
    descriptor: 'a rust-walled mining shaft lit by sodium lamps',
  };

  it('drops a multi-sentence beat entirely', () => {
    // The bug this guards: the retry used to rebuild itself by splitting the
    // finished prompt on '. ', which shatters a multi-sentence beat into
    // fragments that no longer match, so the flagged text was resent verbatim
    // and the refusal repeated.
    const violent = beat({
      prompt: 'A man hangs from a scaffold. The crowd watches from below',
      settingId: 'book:pit',
    });

    const softened = buildPrompt(violent, [], [place], 'Martian mining colony', {
      omitBeat: true,
    });

    expect(softened).not.toContain('hangs from a scaffold');
    expect(softened).not.toContain('crowd watches');
  });

  it('keeps the world and the setting so the place is still recognisable', () => {
    const violent = beat({ prompt: 'A beating in the square', settingId: 'book:pit' });
    const softened = buildPrompt(violent, [], [place], 'Martian mining colony', {
      omitBeat: true,
    });

    expect(softened).toContain('Martian mining colony');
    expect(softened).toContain('sodium lamps');
    expect(softened).toContain('empty of people');
  });

  it('leaves the normal prompt untouched when not softening', () => {
    const normal = beat({ prompt: 'a girl steps onto the platform' });
    expect(buildPrompt(normal, [], [], null)).toContain('a girl steps onto the platform');
  });
});
