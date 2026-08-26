import { useCallback, useEffect, useState } from 'react';
import { bookIdFrom } from '@shiori/core';
import { Library } from './ui/Library';
import { Reader } from './ui/Reader';
import { listBooks, saveBook, getBook, removeBook, type StoredBook } from './lib/db';

export function App() {
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [open, setOpen] = useState<StoredBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listBooks().then(setBooks).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const onAdd = useCallback(
    async (files: FileList) => {
      setBusy(true);
      setNotice(null);
      const rejected: string[] = [];

      try {
        for (const file of Array.from(files)) {
          if (!isSupported(file)) {
            rejected.push(file.name);
            continue;
          }
          try {
            const bytes = await file.arrayBuffer();
            const id = await bookIdFrom(bytes);
            if (await getBook(id)) continue; // same file, already on the shelf

            await saveBook({
              id,
              title: cleanTitle(file.name),
              author: null,
              format: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub',
              file,
              cover: null,
              addedAt: Date.now(),
              lastOpenedAt: null,
              lastLocation: null,
            });
          } catch {
            // Storage can fail on a full disk or in private browsing. Say so
            // rather than leaving the shelf mysteriously unchanged.
            rejected.push(file.name);
          }
        }
        refresh();
      } finally {
        setBusy(false);
        if (rejected.length > 0) {
          setNotice(
            rejected.length === 1
              ? `Couldn't add ${rejected[0]}. Shiori reads EPUB and PDF files.`
              : `Couldn't add ${rejected.length} files. Shiori reads EPUB and PDF files.`,
          );
        }
      }
    },
    [refresh],
  );

  const onOpen = useCallback(async (id: string) => {
    const book = await getBook(id);
    if (book) setOpen(book);
  }, []);

  const onClose = useCallback(() => {
    setOpen(null);
    refresh();
  }, [refresh]);

  const onRemove = useCallback(
    async (id: string) => {
      await removeBook(id);
      refresh();
    },
    [refresh],
  );

  return open ? (
    <Reader book={open} onClose={onClose} />
  ) : (
    <Library
      books={books}
      busy={busy}
      notice={notice}
      onOpen={onOpen}
      onAdd={onAdd}
      onRemove={onRemove}
      onDismissNotice={() => setNotice(null)}
    />
  );
}

/** Accept what foliate-js can actually parse. */
function isSupported(file: File): boolean {
  return /\.(epub|pdf)$/i.test(file.name);
}

function cleanTitle(filename: string): string {
  return filename.replace(/\.(epub|pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
}
