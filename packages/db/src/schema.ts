import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Books are keyed by content hash, so the same file uploaded by two people is one
 * row — and one shared set of illustrations.
 */
export const books = sqliteTable('books', {
  id: text('id').primaryKey(),               // sha256 prefix of file bytes
  title: text('title').notNull(),
  author: text('author'),
  format: text('format', { enum: ['epub', 'pdf'] }).notNull(),
  spineCount: integer('spine_count').notNull().default(0),
  /**
   * The book's visual world — genre, era, technology, palette — established from
   * its opening and prepended to every illustration prompt.
   *
   * Without it an anime-styled model defaults to contemporary Japan: Red Rising
   * rendered as a modern high school instead of a Martian mining dystopia.
   */
  world: text('world'),
  /** Set once the whole book has been segmented into beats. */
  analyzedAt: integer('analyzed_at'),
  createdAt: integer('created_at').notNull(),
});

export const beats = sqliteTable(
  'beats',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id').notNull().references(() => books.id),
    spineIndex: integer('spine_index').notNull(),
    paraIndex: integer('para_index').notNull(),
    kind: text('kind', { enum: ['character', 'scene', 'action', 'item'] }).notNull(),
    prompt: text('prompt').notNull(),
    characterIds: text('character_ids', { mode: 'json' }).$type<string[]>().notNull(),
    settingId: text('setting_id'),
    salience: real('salience').notNull().default(0.5),
  },
  (t) => [index('beats_by_position').on(t.bookId, t.spineIndex, t.paraIndex)],
);

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id),
  name: text('name').notNull(),
});

/**
 * How a character looks, from a point in the book onward.
 *
 * Most characters have exactly one row and never change. Some genuinely do —
 * Red Rising carves Darrow from a small Red into a tall Gold partway through —
 * and a single fixed descriptor would draw him wrong for the rest of the book.
 *
 * A beat resolves to the latest era starting at or before its own position, so
 * art matches who the character was at that point in the story, and a reader in
 * chapter 3 never sees what they become in chapter 14.
 */
export const characterAppearances = sqliteTable(
  'character_appearances',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id').notNull().references(() => characters.id),
    bookId: text('book_id').notNull().references(() => books.id),
    /** First spine index where this appearance holds. */
    fromSpineIndex: integer('from_spine_index').notNull(),
    descriptor: text('descriptor').notNull(),
    /** R2 key of this era's reference portrait; null until rendered. */
    referenceKey: text('reference_key'),
  },
  (t) => [index('appearance_by_character').on(t.characterId, t.fromSpineIndex)],
);

/**
 * Recurring places, so a tavern looks like the same tavern in chapter 9 as it
 * did in chapter 1.
 *
 * Text only, deliberately: a descriptor costs nothing and steers the prompt,
 * where a generated reference plate would add an image per location for a
 * consistency gain that matters far less than it does for faces.
 */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id),
  name: text('name').notNull(),
  descriptor: text('descriptor').notNull(),
});

/**
 * One row per (beat, style). Status lets many readers await one generation
 * instead of racing to start duplicates.
 */
export const illustrations = sqliteTable(
  'illustrations',
  {
    beatId: text('beat_id').notNull(),
    styleId: text('style_id').notNull(),
    bookId: text('book_id').notNull().references(() => books.id),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
    key: text('key'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    error: text('error'),
    /** Re-roll counter, folded into the seed so a regenerate differs. */
    attempt: integer('attempt').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.beatId, t.styleId] }),
    index('art_by_book').on(t.bookId, t.status),
  ],
);
