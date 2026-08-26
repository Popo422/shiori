import { describe, it, expect } from 'vitest';
import { buildPrompt, referenceKeys, dimensionsFor, STYLE } from './prompt.js';
import type { Beat, CharacterSheet } from './types.js';

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: 'b1',
  bookId: 'book',
  spineIndex: 0,
  paraIndex: 3,
  kind: 'character',
  prompt: 'a girl in a red coat on a snowy platform',
  characterIds: [],
  salience: 0.8,
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  id: 'book:mei',
  bookId: 'book',
  name: 'Mei',
  descriptor: 'short black hair, grey eyes, red wool coat',
  referenceKey: 'ref/book/book:mei.jpg',
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
    const cast = [sheet(), sheet({ id: 'book:ren', name: 'Ren', descriptor: 'tall, scarred' })];
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
      sheet({ id: `book:c${i}`, referenceKey: `ref/book/c${i}.jpg` }),
    );
    const keys = referenceKeys(beat({ characterIds: cast.map((c) => c.id) }), cast);
    expect(keys.length).toBeLessThanOrEqual(4);
  });

  it('skips characters who have no sheet yet', () => {
    const cast = [sheet({ referenceKey: null })];
    expect(referenceKeys(beat({ characterIds: ['book:mei'] }), cast)).toEqual([]);
  });
});
