/** Domain types shared by the reader (browser) and the generator (Worker). */

/** What kind of illustration a beat calls for. Drives aspect ratio and prompt shape. */
export type BeatKind =
  | 'character'   // someone is introduced or first described — portrait
  | 'scene'       // a location or mood shift — landscape establishing shot
  | 'action'      // a fight or set piece kicks off — landscape spread
  | 'item';       // an object of significance — square

/**
 * A beat is an illustratable moment, anchored to a *stable* position in the book.
 *
 * Anchoring is by spine index + paragraph index, never by page: EPUB pages are a
 * function of viewport, font size and column count, so a page-anchored beat would
 * land somewhere different on every device and break the shared cache.
 */
export interface Beat {
  /** Content hash of the book this beat belongs to. */
  bookId: string;
  id: string;              // stable hash of (bookId, spineIndex, paraIndex)
  spineIndex: number;      // which document in the spine (or PDF page group)
  paraIndex: number;       // paragraph ordinal within that document
  kind: BeatKind;
  /** Short visual description the image model can consume directly. */
  prompt: string;
  /** Character ids present, used to attach reference sheets for consistency. */
  characterIds: string[];
  /** Where this happens, if a known place. Keeps a location visually stable. */
  settingId: string | null;
  /** 0..1 — how strongly this moment wants art. Used to trim under budget. */
  salience: number;
}

/**
 * A character, and how they looked across the book.
 *
 * appearances is ordered by fromSpineIndex. Most characters have exactly one
 * entry; a character who is physically remade partway through has more, and the
 * one in force at a given beat is resolved by position.
 */
export interface CharacterSheet {
  id: string;
  bookId: string;
  name: string;
  appearances: CharacterAppearance[];
}

/** How a character looks from a point in the book onward. */
export interface CharacterAppearance {
  fromSpineIndex: number;
  descriptor: string;
  referenceKey: string | null;
}

/** A recurring place. Text only — no reference image. */
export interface SettingSheet {
  id: string;
  bookId: string;
  name: string;
  descriptor: string;
}

export type IllustrationStatus = 'pending' | 'ready' | 'failed';

export interface Illustration {
  beatId: string;
  bookId: string;
  status: IllustrationStatus;
  /** R2 object key; null until ready. */
  key: string | null;
  width: number;
  height: number;
  styleId: string;
  createdAt: number;
}

/** Where the reader currently is, in the same stable coordinates as a Beat. */
export interface ReadingPosition {
  spineIndex: number;
  paraIndex: number;
}

/** Per-session signals that decide how far ahead to generate. Never cache keys. */
export interface ReaderTelemetry {
  /** Rolling median milliseconds spent per paragraph. */
  msPerParagraph: number;
  /** Beats visible on one screen, derived from viewport + font size. */
  beatsPerScreen: number;
  /** How the book was opened — drives initial confidence. */
  entry: 'linear' | 'jump' | 'restore';
  /** +1 reading forward, -1 flipping back, 0 unknown. */
  direction: 1 | -1 | 0;
}
