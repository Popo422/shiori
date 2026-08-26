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
    salience: real('salience').notNull().default(0.5),
  },
  (t) => [index('beats_by_position').on(t.bookId, t.spineIndex, t.paraIndex)],
);

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id),
  name: text('name').notNull(),
  descriptor: text('descriptor').notNull(),
  referenceKey: text('reference_key'),
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
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.beatId, t.styleId] }),
    index('art_by_book').on(t.bookId, t.status),
  ],
);
