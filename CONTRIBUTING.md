# Contributing

Scout is intentionally small. Please keep changes focused, evidence-driven, and safe for a read-only X workflow.

1. Use Node 24 or newer and install with `npm ci`.
2. Copy `.env.example` to `.env.local`; never commit real values.
3. Run `npm run preflight` before opening a pull request.
4. Add tests for changes to discovery, curation, routing, or filtering.

The X integration must remain read-only. Do not add posting, liking, following, messaging, proxy rotation, or challenge-bypass behavior.
