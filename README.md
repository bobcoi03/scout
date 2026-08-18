# Scout

Scout is an evidence-based launch intelligence feed for finding products, open-source projects, demos, and new founders directly on X. It turns a noisy stream into a small daily research brief and an interactive market map.

Live demo: [scout.justwrapapi.com](https://scout.justwrapapi.com)

## What it does

Scout runs broad global launch searches with no engagement minimum, then verifies the strongest candidates against the things they actually built. The goal is precision: surface launches that deserve five minutes from an early-stage investor, including small accounts that would be invisible in a popularity feed.

The production pipeline is deliberately bounded:

1. Fifteen X query families collect launch, demo, open-source, and founder candidates.
2. Deterministic filters remove replies, reposts, funding news, roundups, crypto promotion, and other obvious noise. Candidates are deduplicated and ranked with a light engagement-and-recency discovery score.
3. Scout recovers product links and inspects linked sites and repositories. It records availability, page substance, repository metadata, and artifact mismatches.
4. A low-cost first pass reviews at most 300 candidates with the post and artifact evidence together. Engagement is not treated as product quality.
5. The strongest 30 receive deeper investigation: author profile, recent posts, product sites, repositories, launch media, source authority, novelty, substance, market potential, differentiation, and credibility.
6. A final daily editor compares the shortlist and publishes at most eight selections. Weak days can produce fewer.

Completed work is cached by content hash and prompt version in SQLite, so retries and catch-up runs do not repeat paid analysis.

## Architecture

- **Web:** Next.js 16 App Router, React 19, TypeScript, and CSS modules
- **Discovery:** read-only global X search via `@the-convocation/twitter-scraper`
- **Curation:** bounded OpenAI Responses API screening and evidence-based investigation
- **Storage:** Better SQLite3 for raw posts, analyses, investigation packets, verdicts, and scan state; production checkpoints are compressed into a private Vercel Blob
- **Publishing:** a sanitized JSON snapshot uploaded to Vercel Blob
- **Hosting:** Vercel serves the read-only app and refreshes the published snapshot every five minutes, with a bundled snapshot as fallback
- **Scheduling:** Vercel Cron calls a protected server-only route once per day; the worker checks the previous complete UTC day and catches up the preceding six days

The browser never receives the X session, model key, private database, or Blob credentials. Discovery and curation run inside the protected Vercel worker; only the sanitized curated dataset is published publicly.

## Setup

Use Node 24 or newer:

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`. The bundled public dataset is enough to explore the web app without any credentials.

### Optional discovery configuration

For live discovery, use a dedicated X account. In Chrome DevTools, open Application → Cookies → `https://x.com` and copy only the values of `auth_token` and `ct0` into `.env.local`.

```env
X_SCRAPING_ENABLED=true
X_AUTH_TOKEN=...
X_CT0=...
OAI_API_KEY=...
```

Never commit or share these values. They grant access to the corresponding sessions and services. Scout restricts X requests to X/Twitter HTTPS hosts, applies request timeouts, and stops on rate limits.

Run one date manually:

```bash
npm run scan -- 2026-08-17
```

Run the idempotent daily catch-up job and publish the sanitized snapshot:

```bash
npm run scan:daily
```

`BLOB_READ_WRITE_TOKEN` is required only to publish the snapshot. `SCOUT_DATA_URL` is required only by the hosted web app when reading that snapshot.

### Production ingestion

The production deployment defines `/api/cron/ingest` in `vercel.json` at `01:15 UTC` each day. Vercel sends `CRON_SECRET` as a bearer token, and the route fails closed if it is missing or incorrect. A private Blob store holds the compressed SQLite checkpoint between invocations, while a short-lived `/tmp` copy is used during each run. A private Blob lock and SQLite scan records make duplicate delivery and catch-up runs idempotent.

The route is configured for Vercel Pro Fluid Compute because a full evidence pass can take more than ten minutes. Local `npm run scan:daily` remains available for development and emergency recovery, but it is not the production scheduler.

## Data model

The current pipeline stores X posts, artifact inspections, first-pass analyses, investigation packets, investigator verdicts, and scan runs. Public rows contain the builder name and X username, which the Themes workspace aggregates into a filterable people index.

Rich profile evidence such as biography, website, follower counts, recent posts, and repository metadata is retained in private investigation packets. It is not included in the public snapshot by default.

## Commands

```bash
npm run dev             # start the web app
npm run scan -- DATE    # discover and curate one UTC day
npm run scan:daily      # catch up missed days and publish the snapshot
npm run export:public   # regenerate the sanitized bundled dataset
npm run check:secrets   # scan tracked files before publishing
npm run preflight       # secrets, lint, tests, and production build
```

## Safety

Scout reads public searches and posts. It does not post, like, follow, repost, send messages, rotate accounts, use proxies, or bypass X challenges. The frontend integration is unofficial and may change; use modest scan sizes and comply with applicable platform terms.

Local `.env` files, SQLite databases, screenshots, investigation media, cached repositories/sites, logs, and Vercel project metadata are ignored by Git. The secret preflight scans both the publishable working tree and every reachable Git-history blob. See [SECURITY.md](SECURITY.md) before changing repository visibility.

## License

MIT
