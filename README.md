# Shiori

An adaptive illustrator for EPUB and PDF. It reads ahead of you, finds the moments
worth drawing, and has a light-novel illustration waiting on the page where a
character is introduced or a fight kicks off.

Drop a book on your phone. That's the whole interaction.

**Live:** https://shiori.zerniereyes.workers.dev

---

## How it works

Two clocks drive the app, and keeping them apart is the central design decision.

**The scene clock is stable.** A book is segmented into *beats* — a character
introduction, a location change, an action set piece — anchored to
`(spineIndex, paraIndex)`. Never to a page: EPUB pages are a function of viewport,
font size and column count, so a page-anchored beat lands somewhere different on
every device. Because beats depend only on the book, the same beat produces the
same image for every reader, and the art cache is shared.

**The reader clock is per-session.** Reading velocity, screen size, and how the book
was opened decide *how far ahead* to generate — never *what*. If telemetry leaked
into the cache key, changing your font size would invalidate a book's entire art
library.

```
buffer depth ≈ beatsPerScreen × velocityFactor × confidence   (clamped 1–6)
```

Open at chapter 1 and read linearly → confident, five beats ahead. Jump via the
table of contents into chapter 12 → low confidence, generate only what's on screen
and wait to see which way you move. Flip backwards → stop prefetching entirely.

## Cost

Illustrations are generated with FLUX.2 klein 4B on Workers AI. It was chosen over
the cheaper `flux-1-schnell` for two reasons that decide the product: it accepts
`width`/`height` (so character beats render as portraits and action beats as
landscape spreads — schnell is locked to a square), and it accepts up to four
reference images, which is how a character stays on-model across a whole book.

| | |
|---|---|
| Per illustration (832×1216) | **$0.0017** |
| A 30-illustration novel | **~$0.05** |
| Serving that art to your phone | **$0.00** (R2 has zero egress) |

Free tiers absorb personal use entirely: 10,000 Workers AI neurons/day, 10 GB R2
(~100k images), 5 GB D1 with 5M row reads/day.

Because art is keyed by book content hash rather than by user, the second reader of
any book pays almost nothing.

## Stack

| | |
|---|---|
| Monorepo | Turborepo + npm workspaces |
| Reader | [foliate-js](https://github.com/johnfactotum/foliate-js) — EPUB, PDF, MOBI, AZW3, CBZ in one library |
| Web | React 19, Vite 8, Zustand, Dexie (IndexedDB), vite-plugin-pwa |
| API | Hono on Cloudflare Workers |
| Data | D1 + Drizzle ORM |
| Images | Workers AI (FLUX.2 klein 4B) → R2 |
| Background work | ctx.waitUntil (generation runs off the request path) |

```
packages/core   domain logic — beats, buffer policy, prompts, cache keys
                (no React, no Cloudflare: shared by browser and Worker)
packages/db     Drizzle schema for D1
apps/web        the reader (PWA)
apps/api        Hono Worker: analysis, generation, serving
```

## Setup

Requires Node 22+ and a Cloudflare account.

```bash
git clone --recurse-submodules https://github.com/Popo422/shiori.git
cd shiori
npm install
```

If you already cloned without submodules: `git submodule update --init --recursive`

### 1. Create the Cloudflare resources

```bash
npx wrangler login

npx wrangler d1 create shiori
npx wrangler r2 bucket create shiori-art
```

### 2. Add your database id

`wrangler d1 create` prints a `database_id`. Put it in
`apps/api/wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_ID`.

**This is the only value you need to fill in.** Workers AI, R2, and D1 are all
bindings — there are no API keys to manage.

### 3. Create the tables

```bash
npm run db:generate          # generate migrations from the Drizzle schema
npm run db:migrate           # apply them to your remote D1
```

### 4. Run it

```bash
npm run dev                  # web on :5173, api on :8787
```

### 5. Deploy

```bash
npm run deploy
```

One deploy publishes both: the built reader is served as static assets from the
same Worker as the API, so they share an origin. On your phone, open the deployed
URL and use **Add to Home Screen** — it installs as a PWA, works offline, and
remembers your position.

## Notes

- **Your books never leave your device.** The file is stored locally in IndexedDB.
  Only the extracted text of a section being analyzed is sent to the server, and only
  once per book across all readers.
- **Analysis is lazy.** Sections are segmented shortly before you reach them, so
  opening a book is instant rather than blocking on a whole-book pass.
- **foliate-js is vendored as a submodule** because it documents its own API as
  unstable and publishes no npm release. All contact with it is confined to
  `apps/web/src/reader/FoliateView.tsx`, so upstream churn touches one file.
- Changing `STYLE.id` in `packages/core/src/prompt.ts` intentionally invalidates the
  cache — that is how you re-render a book in a new art style.

## License

MIT
