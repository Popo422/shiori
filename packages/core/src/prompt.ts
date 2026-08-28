import type {
  Beat,
  BeatKind,
  CharacterAppearance,
  CharacterSheet,
  SettingSheet,
} from './types.js';

/** Aspect ratios per beat kind. klein accepts width/height in 256..1920. */
const DIMENSIONS: Record<BeatKind, { width: number; height: number }> = {
  character: { width: 832, height: 1216 },  // portrait
  scene:     { width: 1216, height: 832 },  // establishing landscape
  action:    { width: 1216, height: 832 },  // spread
  item:      { width: 1024, height: 1024 },
};

export function dimensionsFor(kind: BeatKind) {
  return DIMENSIONS[kind];
}

/** House style. Changing this changes styleId, which invalidates the cache on purpose. */
export const STYLE = {
  id: 'ln-v2',
  positive:
    'light novel illustration, anime style, clean cel shading, delicate linework, ' +
    'soft rim lighting, muted film-grade palette, detailed background art',
  negative:
    'photorealistic, 3d render, watermark, signature, text, extra limbs, deformed hands, ' +
    // Anime-trained models fall back to contemporary Japan unless told otherwise,
    // which turned a Martian mining colony into a high school corridor.
    'modern school uniform, classroom, contemporary city street, smartphone',
} as const;

/**
 * Build the final prompt. The beat supplies the scene; characters supply the
 * appearance descriptors that keep a cast consistent across a whole book.
 *
 * `omitBeat` drops the beat's own sentence and keeps the world, setting and
 * cast. That is the softened retry for a moment the image model refuses: the
 * violence lives in the beat sentence, so an establishing shot of the same
 * place still illustrates the scene without depicting it. Built here from the
 * same parts rather than by splitting the finished string, because a beat
 * prompt of more than one sentence cannot be found again once split.
 */
export function buildPrompt(
  beat: Beat,
  cast: readonly CharacterSheet[],
  places: readonly SettingSheet[] = [],
  world?: string | null,
  options: { omitBeat?: boolean } = {},
): string {
  const present = cast.filter((c) => beat.characterIds.includes(c.id));
  const who = present
    .map((c) => {
      const look = appearanceAt(c, beat.spineIndex);
      return look ? `${c.name}: ${look.descriptor}` : null;
    })
    .filter(Boolean)
    .join('; ');
  const place = places.find((p) => p.id === beat.settingId);

  // Place before the beat's own sentence: it establishes the world the moment
  // happens in, so the model doesn't invent a generic room for every scene.
  // World first: it establishes genre and era before anything else, which is
  // what stops the model defaulting to present-day Earth.
  return [
    STYLE.positive,
    world && `World — ${world}`,
    place && `Setting — ${place.descriptor}`,
    // A softened retry keeps the world and the place but drops the people: the
    // refusal is usually about what is being done to them.
    !options.omitBeat && who && `Characters — ${who}`,
    options.omitBeat
      ? 'An establishing shot of this place, empty of people, sombre and still'
      : beat.prompt,
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * Reference images for on-model characters. klein takes up to 4, each under
 * 512x512, addressed positionally as input_image_0..3.
 */
export function referenceKeys(beat: Beat, cast: readonly CharacterSheet[]): string[] {
  return cast
    .filter((c) => beat.characterIds.includes(c.id))
    .map((c) => appearanceAt(c, beat.spineIndex)?.referenceKey)
    .filter((key): key is string => typeof key === 'string')
    .slice(0, 4);
}

/**
 * How a character looked at a given point in the book: the latest appearance
 * starting at or before this spine index.
 *
 * Most characters have one appearance and this returns it unconditionally. It
 * matters for a character who is physically remade partway through — Red Rising
 * carves Darrow from a small Red into a tall Gold — where a single fixed
 * descriptor would draw him wrong for the rest of the book, and drawing him as a
 * Gold before the carving would spoil it.
 */
export function appearanceAt(
  character: CharacterSheet,
  spineIndex: number,
): CharacterAppearance | null {
  let best: CharacterAppearance | null = null;
  for (const appearance of character.appearances) {
    if (appearance.fromSpineIndex > spineIndex) continue;
    if (!best || appearance.fromSpineIndex > best.fromSpineIndex) best = appearance;
  }
  // Before the first recorded appearance, fall back to the earliest one rather
  // than dropping the character out of the prompt entirely.
  if (best) return best;
  return (
    character.appearances.reduce<CharacterAppearance | null>(
      (earliest, a) => (!earliest || a.fromSpineIndex < earliest.fromSpineIndex ? a : earliest),
      null,
    ) ?? null
  );
}
