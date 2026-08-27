import type { Beat, ReadingPosition } from '@shiori/core';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export interface ArtState {
  beatId: string;
  status: 'pending' | 'ready' | 'failed';
  url: string | null;
  width: number;
  height: number;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Register a book by content hash. Returns whether art already exists for it. */
export function registerBook(input: {
  bookId: string;
  title: string;
  author: string | null;
  format: 'epub' | 'pdf';
  spineCount: number;
}) {
  return json<{ analyzed: boolean; beatCount: number }>('/books', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Ask the server to segment a section into beats. Idempotent per section. */
export function analyzeSection(input: {
  bookId: string;
  spineIndex: number;
  paragraphs: string[];
}) {
  return json<{ beats: Beat[] }>('/analyze', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getBeats(bookId: string, spineIndex?: number) {
  const query = spineIndex === undefined ? '' : `?spine=${spineIndex}`;
  return json<{ beats: Beat[] }>(`/books/${bookId}/beats${query}`);
}

/**
 * Request art for a window of beats. The server dedupes against the shared
 * cache, so asking for something another reader already generated is free.
 */
export function requestArt(input: { bookId: string; beatIds: string[] }) {
  return json<{ art: ArtState[] }>('/art', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Absolute, deliberately.
 *
 * Illustrations are rendered inside the book's own document, which foliate
 * serves from a blob: URL. A root-relative path resolves against that blob
 * origin rather than the site, so the image silently fails to load and the
 * plate renders as an empty page.
 */
export function artUrl(bookId: string, beatId: string): string {
  return new URL(`${BASE}/art/${bookId}/${beatId}`, window.location.origin).href;
}

export type { Beat, ReadingPosition };

/** Draw a beat again when the reader doesn't like the result. */
export function regenerateArt(input: { bookId: string; beatId: string }) {
  return json<{ beatId: string; status: 'pending'; attempt: number }>('/art/regenerate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
