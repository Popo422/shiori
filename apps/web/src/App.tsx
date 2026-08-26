import { useCallback, useEffect, useState } from 'react';
import { bookIdFrom } from '@shiori/core';
import { Library } from './ui/Library';
import { Reader } from './ui/Reader';
import { listBooks, saveBook, getBook, removeBook, type StoredBook } from './lib/db';

export function App() {
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [open, setOpen] = useState<StoredBook | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listBooks().then(setBooks).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const onAdd = useCallback(
    async (files: FileList) => {
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          const bytes = await file.arrayBuffer();
          const id = await bookIdFrom(bytes);
          if (await getBook(id)) continue;

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
        }
        refresh();
      } finally {
        setBusy(false);
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
    <Library books={books} busy={busy} onOpen={onOpen} onAdd={onAdd} onRemove={onRemove} />
  );
}

function cleanTitle(filename: string): string {
  return filename.replace(/\.(epub|pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
}
