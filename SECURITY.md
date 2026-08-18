# Security

Please report a vulnerability privately to the repository owner instead of opening a public issue.

Scout uses an authenticated X session for read-only discovery. Treat `X_AUTH_TOKEN` and `X_CT0` like passwords: use a dedicated account, keep them only in `.env.local` or a secret manager, and rotate them immediately if they are exposed.

Before publishing a branch or changing repository visibility, run:

```bash
npm run check:secrets
```

Production secrets belong in Vercel environment variables. The full ingestion database is stored only in a private Blob store; the public store contains the sanitized feed snapshot.

Local databases, investigation artifacts, logs, `.env*` files, and Vercel project metadata are excluded from version control. Only `.env.example`, with blank values, is committed. The preflight scans both current publishable files and all reachable Git-history blobs.
