# Deploying Shiori

Everything that could be provisioned without your dashboard has been. This is
what's left.

## Already done

| Resource | Value |
|---|---|
| Cloudflare account | `zerniereyes@gmail.com` (`71d690817f1fa3abd0fb65adc837f1eb`) |
| D1 database | `shiori` — `c29a8781-1bb2-421f-99d1-ed8b46b538ef`, region APAC |
| D1 schema | migrated, 4 tables (`books`, `beats`, `characters`, `illustrations`) |
| Queue | `shiori-render` |
| GitHub repo | `Popo422/shiori` |
| GitHub secret | `CLOUDFLARE_ACCOUNT_ID` |
| CI | passing on every push and PR |

## Step 1 — Enable R2

This is the one blocker. R2 needs to be switched on once from the dashboard
because it requires accepting the R2 terms, which can't be done from the CLI.

1. Go to <https://dash.cloudflare.com/71d690817f1fa3abd0fb65adc837f1eb/r2>
2. Click **Enable R2** and accept the terms (the free tier covers this app: 10 GB
   storage and **zero egress**)
3. Then create the bucket:

```bash
npx wrangler r2 bucket create shiori-art
```

## Step 2 — Workers Paid plan

Cloudflare Queues requires the Workers Paid plan ($5/month). Everything else
here fits inside free tiers.

If you'd rather not pay, say so and the queue can be replaced with
`ctx.waitUntil()` — generation would then run inside the request that triggered
it. It works, but a slow render can hit the 300s wall-clock limit and there are
no automatic retries, which is why the queue is the better default.

## Step 3 — Deploy

```bash
npm run build
cd apps/api && npx wrangler deploy
```

That single deploy publishes both the API and the reader — the built web app is
served from the same Worker as static assets, so they share an origin.

Your app will be at `https://shiori.<your-subdomain>.workers.dev`.

## Step 4 — Automatic deploys (optional)

For the Deploy workflow to run on every push, add an API token:

1. Go to <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**
2. Use the **Edit Cloudflare Workers** template, and confirm it includes:
   - `Account · Workers Scripts · Edit`
   - `Account · Workers R2 Storage · Edit`
   - `Account · D1 · Edit`
   - `Account · Queues · Edit`
   - `Account · Workers AI · Read`
3. Add it to GitHub:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh variable set DEPLOY_ENABLED --body true
```

The workflow skips itself until `DEPLOY_ENABLED` is set, so pushes stay green
rather than failing on a missing token.

## Step 5 — Install on your phone

Open the deployed URL in mobile Safari or Chrome and choose **Add to Home
Screen**. It installs as a standalone PWA: works offline, keeps your library in
on-device storage, and remembers your position per book.

Then drop an EPUB or PDF on it.

## What hasn't been verified

Being straight about this: the Workers AI binding reports `not supported` in
local dev, so **beat analysis and image generation have never actually run**.
The routes, database writes, queue plumbing, dedup logic, and error paths around
them are all tested against real bindings — but the two `env.AI.run()` calls
themselves are unexercised.

Expect to iterate on the analysis prompt once you see real output. The most
likely thing needing a tune is `TARGET_SPACING` in
`apps/api/src/analyze.ts` (illustration density) and the wording of `SYSTEM`
in the same file.

## Cost once running

| | |
|---|---|
| Per illustration (832×1216) | $0.0017 |
| A 30-illustration novel | ~$0.05 |
| Serving art | $0.00 (R2 egress is free) |
| Workers Paid (for Queues) | $5/month |

Free tiers cover the rest: 10,000 Workers AI neurons/day, 10 GB R2, 5 GB D1
with 5M row reads/day. Art is cached by book content hash rather than per user,
so a second reader of the same book pays nothing.
