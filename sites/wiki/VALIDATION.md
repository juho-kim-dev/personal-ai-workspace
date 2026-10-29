# PAW Wiki local verification — 2026-10-29

Source baseline: Wiki42 Git main `df2dc031c48e25a4018b0bf1c9f302ec0d74665a`. macOS, Node 26.5.0, local Codex browser and local D1/R2 emulator. The current Sites connection could not read the private production site; latest live-version parity was not independently confirmed.

- Installed the pinned dependencies in the independent public copy.
- Applied all five original SQL migrations to new local D1 state; no remote flag or production identity was used.
- TypeScript checking passed.
- Vinext production build passed, retaining all ten API/MCP routes plus the dynamic page.
- `npm test` exercised real local API routes: local synthetic sign-in, unauthenticated API 401, original identity migration/backup/verify/activation, stable document IDs, search, save/read persistence, history, stale-version 409 and content restoration. Exactly six authored starter/help pages remained. Temporary backup responses stayed in process memory; no backup was published.
- Browser: actual front page, renamed brand and eight hub cards (seven pending destinations plus Projects candidate), document navigation and real editor source/preview controls inspected. Browser reload retained stored data. No private destination remains in the hub.
- The existing auth and write/version guards remain. Local sign-in is the upstream loopback-only mock; no real account was connected.

The six pages are code-authored starter/help material. They are not imported operating documents. Personal DBs, files, backups, secrets and Site identities were not copied. Namespace/display references were adapted consistently to PAW Wiki in this fresh instance; this is not an in-place migration of a private database. Existing machine tool IDs are retained for compatibility. The fixed Threads reference validator is now keyed by the archive URL route shape instead of a private hostname; other source/version checks remain.

Not claimed: hosted deployment, correct secondary-account connection, public visitor permission/isolation, external-browser or physical-phone verification, whole original regression suite, hosted MCP or all original feature parity. The full source is present; these checks are a bounded local handoff, not full production acceptance.
