# Contributing

Prefer GitHub Issues for concrete work. Suggested labels include `bug`, `enhancement`, `ui`, `favicons`, `organization`, `research`, and `maybe-someday`.

For behavior that depends on ChatGPT's DOM or private backend endpoints, document the assumption being made and keep selectors/API coupling as narrow as possible.

For persistence changes, perform a migration review: what changed, why, old-to-new mappings, fallback behavior, and whether legacy data is retained for rollback/testing.

Keep the root `Projecture.user.js` as the canonical current userscript and retain released snapshots in `versions/`.
