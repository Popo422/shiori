import {
  STYLE,
  buildPrompt,
  dimensionsFor,
  illustrationKey,
  referenceSheetKey,
  referenceKeys,
  type Beat,
  type CharacterAppearance,
  type CharacterSheet,
  type SettingSheet,
} from '@shiori/core';
import type { Env } from './env';

/**
 * FLUX.2 klein 4B — chosen over flux-1-schnell for two reasons that matter here:
 *   1. It accepts width/height, so we can render portraits for character beats
 *      and landscapes for action spreads. schnell is locked to a square.
 *   2. It accepts up to 4 reference images, which is how a character stays
 *      on-model across an entire book.
 * Cost is ~$0.0017 per 832x1216 image (~580 per dollar).
 */
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b' as const;

/** Reference images must be under 512x512 per the model's input contract. */
const MAX_REFERENCE_EDGE = 512;

export async function renderBeat(
  env: Env,
  beat: Beat,
  cast: readonly CharacterSheet[],
  places: readonly SettingSheet[] = [],
): Promise<{ key: string; width: number; height: number }> {
  const { width, height } = dimensionsFor(beat.kind);
  const prompt = buildPrompt(beat, cast, places);
  const references = await loadReferences(env, beat, cast);

  const form = new FormData();
  form.append('prompt', `${prompt}. Avoid: ${STYLE.negative}`);
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('seed', String(stableSeed(beat.id)));
  // Positional reference slots: input_image_0..3, as binary parts.
  references.forEach((blob, i) => form.append(`input_image_${i}`, blob));

  const result = (await env.AI.run(MODEL as never, {
    multipart: toMultipart(form),
  } as never)) as { image?: string };
  if (!result?.image) throw new Error('model returned no image');

  const bytes = base64ToBytes(result.image);
  const key = illustrationKey(beat.bookId, beat.id, STYLE.id);
  await env.ART.put(key, bytes, {
    httpMetadata: {
      contentType: 'image/jpeg',
      // Art is immutable once generated — let the CDN and phone cache it hard.
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return { key, width, height };
}

/**
 * FLUX.2 klein takes a real multipart body, not a JSON object. Serializing the
 * FormData through a Response is how you get the stream and its boundary-bearing
 * content type, which is what the binding expects.
 */
function toMultipart(form: FormData): { body: ReadableStream | null; contentType: string | null } {
  const response = new Response(form);
  return {
    body: response.body,
    contentType: response.headers.get('content-type'),
  };
}

async function loadReferences(
  env: Env,
  beat: Beat,
  cast: readonly CharacterSheet[],
): Promise<Blob[]> {
  const keys = referenceKeys(beat, cast);

  const loaded = await Promise.all(
    keys.map(async (key) => {
      const obj = await env.ART.get(key);
      if (!obj) return null;
      return new Blob([await obj.arrayBuffer()], { type: 'image/jpeg' });
    }),
  );
  return loaded.filter((x): x is Blob => x !== null);
}

/**
 * Deterministic seed per beat: regenerating the same beat yields the same image,
 * which keeps the shared cache coherent if a render is ever retried.
 */
function stableSeed(beatId: string): number {
  let hash = 0;
  for (let i = 0; i < beatId.length; i++) {
    hash = (Math.imul(31, hash) + beatId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { MAX_REFERENCE_EDGE };

/**
 * Render a character's reference sheet: a plain, well-lit portrait on a neutral
 * ground, generated once from their introduction descriptor.
 *
 * Every later illustration featuring them passes this back as an input image, so
 * the same person stays recognizably the same person across the whole book —
 * which is the entire reason for choosing klein over the cheaper schnell.
 *
 * Kept small deliberately: the model requires reference images under 512x512.
 */
export async function renderReferenceSheet(
  env: Env,
  character: CharacterSheet,
  era: CharacterAppearance,
): Promise<string> {
  const form = new FormData();
  form.append(
    'prompt',
    `${STYLE.positive}. Character reference sheet, single figure, front facing, ` +
      `neutral grey background, even lighting, full body, neutral expression. ` +
      `${era.descriptor}. Avoid: ${STYLE.negative}, multiple views, text labels`,
  );
  form.append('width', String(MAX_REFERENCE_EDGE));
  form.append('height', String(MAX_REFERENCE_EDGE));
  form.append('seed', String(stableSeed(`${character.id}@${era.fromSpineIndex}`)));

  const result = (await env.AI.run(MODEL as never, {
    multipart: toMultipart(form),
  } as never)) as { image?: string };

  if (!result?.image) throw new Error('model returned no reference image');

  const key = referenceSheetKey(character.bookId, `${character.id}@${era.fromSpineIndex}`);
  await env.ART.put(key, base64ToBytes(result.image), {
    httpMetadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  return key;
}
