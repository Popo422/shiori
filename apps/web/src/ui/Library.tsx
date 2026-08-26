import { useCallback, useRef, useState } from 'react';
import type { StoredBook } from '../lib/db';

interface Props {
  books: StoredBook[];
  busy: boolean;
  notice: string | null;
  onOpen(id: string): void;
  onAdd(files: FileList): void;
  onRemove(id: string): void;
  onDismissNotice(): void;
}

/** The landing screen: a shelf, and one obvious way to add to it. */
export function Library({
  books,
  busy,
  notice,
  onOpen,
  onAdd,
  onRemove,
  onDismissNotice,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) onAdd(e.dataTransfer.files);
    },
    [onAdd],
  );

  return (
    <main
      className={`library ${dragging ? 'is-dragging' : ''}`}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the page, not on every
        // child element it passes over.
        if (e.currentTarget === e.target) setDragging(false);
      }}
    >
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

      {busy && (
        <p className="library__busy" role="status">
          <span className="spinner" aria-hidden="true" />
          Adding your book…
        </p>
      )}

      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button className="notice__close" onClick={onDismissNotice} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

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
