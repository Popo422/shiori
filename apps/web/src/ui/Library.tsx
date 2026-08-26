import { useCallback, useRef } from 'react';
import type { StoredBook } from '../lib/db';

interface Props {
  books: StoredBook[];
  busy: boolean;
  onOpen(id: string): void;
  onAdd(files: FileList): void;
  onRemove(id: string): void;
}

/** The landing screen: a shelf, and one obvious way to add to it. */
export function Library({ books, busy, onOpen, onAdd, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) onAdd(e.dataTransfer.files);
    },
    [onAdd],
  );

  return (
    <main className="library" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <header className="library__header">
        <h1 className="library__title">Shiori</h1>
        <p className="library__tagline">Your books, illustrated as you read.</p>
      </header>

      {books.length === 0 ? (
        <div className="empty">
          <p className="empty__headline">Add a book to begin</p>
          <p className="empty__body">
            Drop an EPUB or PDF here, or choose a file. Everything stays on your device.
          </p>
          <button className="button button--primary" onClick={() => input.current?.click()}>
            Choose a file
          </button>
        </div>
      ) : (
        <>
          <ul className="shelf">
            {books.map((book) => (
              <li key={book.id} className="shelf__item">
                <button className="cover" onClick={() => onOpen(book.id)}>
                  {book.cover ? (
                    <img src={URL.createObjectURL(book.cover)} alt="" className="cover__image" />
                  ) : (
                    <span className="cover__fallback">{initials(book.title)}</span>
                  )}
                </button>
                <div className="shelf__meta">
                  <p className="shelf__book">{book.title}</p>
                  {book.author && <p className="shelf__author">{book.author}</p>}
                </div>
                <button
                  className="shelf__remove"
                  onClick={() => onRemove(book.id)}
                  aria-label={`Remove ${book.title}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button className="button" onClick={() => input.current?.click()}>
            Add another book
          </button>
        </>
      )}

      {busy && <p className="library__busy">Opening…</p>}

      <input
        ref={input}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        onChange={(e) => e.target.files && onAdd(e.target.files)}
      />
    </main>
  );
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}
