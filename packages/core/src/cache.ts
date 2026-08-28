/**
 * Cache keys.
 *
 * A key is built only from things that are identical for every reader of a book:
 * the book's content hash, the beat, and the style. Nothing from ReaderTelemetry
 * may appear here — that is what lets reader #2 of a popular book pay nothing.
 */
export function illustrationKey(bookId: string, beatId: string, styleId: string): string {
  return `art/${bookId}/${styleId}/${beatId}.jpg`;
}

export function referenceSheetKey(bookId: string, characterId: string): string {
  return `ref/${bookId}/${characterId}.jpg`;
}

/**
 * Content hash of the uploaded file — identical books share art automatically.
 *
 * Beat ids are *not* hashed: they are built as `bookId-spineIndex-paraIndex` in
 * the analyzer, which is stable for the same reason a hash would be and stays
 * readable in a database row. Two schemes for one id invites drift, so there is
 * only the one.
 */
export async function bookIdFrom(bytes: ArrayBuffer): Promise<string> {
  return (await sha256Bytes(bytes)).slice(0, 20);
}

async function sha256Bytes(input: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', input as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
