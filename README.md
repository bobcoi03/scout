# Scout

Scout is a deliberately small, local-first feed for finding newly launched products, viral open-source projects, product demos, and new founders directly on X.

Scout uses an authenticated X account session through `@the-convocation/twitter-scraper`. Each scan runs broad global launch-query families with no engagement minimum, collects up to 600 deduplicated discovery candidates, then Nano-screens the strongest 300. The investigator deeply checks at most 30 candidates and publishes at most eight daily selections.

## Stack

- Next.js 16, React 19, TypeScript, and Tailwind CSS 4
- `@the-convocation/twitter-scraper` for read-only global X search
- Better SQLite3 for the local feed cache
- OpenAI nano for broad first-pass screening, plus bounded investigator and final-editor reviews
- X's standard embed widget for post rendering

There is no admin dashboard, application login, worker, Exa, Supabase, or paid X API.

## Setup

Use Node 24 or newer:

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev
```

In a dedicated X account, open Chrome DevTools → Application → Cookies → `https://x.com`. Copy only the values for `auth_token` and `ct0` into `.env.local`:

```env
X_SCRAPING_ENABLED=true
X_AUTH_TOKEN=...
X_CT0=...
X_MAX_POSTS_PER_QUERY=30
```

Never commit or share these values. They grant access to that X session.

Open `http://127.0.0.1:3000` and press **Scan X now**. You can also refresh the feed from the terminal with:

```bash
npm run scan
```

To run the automatic daily job manually, use:

```bash
npm run scan:daily
```

To compare the production investigator against previously stored results, replay
the most recent completed scan days:

```bash
npm run compare:investigator -- --days 3
```

The comparison is written to `outputs/`. Packets and verdicts remain separately
versioned in SQLite. Add `--force` only when intentionally paying to rebuild and
rejudge already cached results. `--refresh-evidence` refreshes
profiles/sites/repositories while reusing paid model verdicts.

The daily task scans the previous complete UTC day and checks the preceding six
days for anything missed while the machine was asleep or offline. Completed days
for the current analyst version are skipped, so catch-up runs do not repeat paid
analysis. Days completed before the investigator production cutover keep their
legacy curation; only newly completed investigator scans use the new verdicts.
When Vercel Blob is configured, the same job exports and publishes the curated
read-only dataset used by the hosted application.

## Safety and limits

Scout only reads searches and public posts. It does not post, like, follow, repost, send messages, rotate accounts, use proxies, or bypass X challenges. Requests are restricted to X/Twitter HTTPS hosts, have a 25-second timeout, and stop immediately on rate limiting.

The frontend API is undocumented and can change without notice. Use a dedicated non-personal account and moderate scan sizes.
