import Dexie, { type EntityTable } from 'dexie';

/**
 * Local library. The book file itself never leaves the device — only extracted
 * text for the beats being analyzed is sent to the server.
 */
export interface StoredBook {
  id: string;
  title: string;
  author: string | null;
  format: 'epub' | 'pdf';
  file: Blob;
  cover: Blob | null;
  addedAt: number;
  lastOpenedAt: number | null;
  /** Serialized foliate CFI or section index. */
  lastLocation: string | null;
}

const db = new Dexie('shiori') as Dexie & {
  books: EntityTable<StoredBook, 'id'>;
};

db.version(1).stores({
  books: 'id, addedAt, lastOpenedAt',
});

export { db };

export async function saveBook(book: StoredBook): Promise<void> {
  await db.books.put(book);
}

/**
 * Most recently read first, then newly added.
 *
 * Sorted in memory rather than with orderBy: IndexedDB omits records whose
 * indexed key is null, so a never-opened book (lastOpenedAt === null) would be
 * saved and then silently never listed.
 */
export async function listBooks(): Promise<StoredBook[]> {
  const all = await db.books.toArray();
  return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  return db.books.get(id);
}

export async function rememberLocation(id: string, cfi: string): Promise<void> {
  await db.books.update(id, { lastLocation: cfi, lastOpenedAt: Date.now() });
}

export async function removeBook(id: string): Promise<void> {
  await db.books.delete(id);
}
