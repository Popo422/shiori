import type { Beat, BeatKind, CharacterSheet } from './types.js';

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
  id: 'ln-v1',
  positive:
    'light novel illustration, anime style, clean cel shading, delicate linework, ' +
    'soft rim lighting, muted film-grade palette, detailed background art',
  negative:
    'photorealistic, 3d render, watermark, signature, text, extra limbs, deformed hands',
} as const;

/**
 * Build the final prompt. The beat supplies the scene; characters supply the
 * appearance descriptors that keep a cast consistent across a whole book.
 */
export function buildPrompt(beat: Beat, cast: readonly CharacterSheet[]): string {
  const present = cast.filter((c) => beat.characterIds.includes(c.id));
  const who = present.map((c) => `${c.name}: ${c.descriptor}`).join('; ');
  return [STYLE.positive, who && `Characters — ${who}`, beat.prompt]
    .filter(Boolean)
    .join('. ');
}

/**
 * Reference images for on-model characters. klein takes up to 4, each under
 * 512x512, addressed positionally as input_image_0..3.
 */
export function referenceKeys(beat: Beat, cast: readonly CharacterSheet[]): string[] {
  return cast
    .filter((c) => beat.characterIds.includes(c.id) && c.referenceKey)
    .slice(0, 4)
    .map((c) => c.referenceKey as string);
}
