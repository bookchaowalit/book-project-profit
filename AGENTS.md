# Project instructions

This repository owns Project Profit Tracker. Do not depend on the Solo Empire hub,
read its database, or import code by a path outside this checkout.

- API code and its PostgreSQL migrations/tests belong in `apps/api`.
- Web code and its own dependency manifest/tests belong in `apps/web`.
- Store money as integer minor units; serialize monetary API fields as decimal
  strings so JavaScript cannot silently round large amounts.
- Every private route requires verified authentication and workspace membership.
- Do not introduce development authentication bypasses into the shipped app.
- Use disposable PostgreSQL databases and synthetic identities in tests.
- Do not provision providers, use production credentials, deploy, or push without
  the parent agent's release decision.
- Preserve unrelated work; use apply_patch for manual edits.
