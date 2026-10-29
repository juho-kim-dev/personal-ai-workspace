# PAW Wiki local preview

Actual Wiki42 runtime/UI adapted from Git main `df2dc031c48e25a4018b0bf1c9f302ec0d74665a`. This is a functioning independent wiki and the planned PAW hub, not the root six-role prototype. Personal data and production identities are excluded. See [source manifest](source-manifest.json) and [validation](VALIDATION.md).

## Run locally

Node 22.13+ is required. From this directory:

```sh
npm run install:ci
npm run prepare:local
npm run dev -- --host 127.0.0.1 --port 5197
```

Open http://127.0.0.1:5197/ . The upstream loopback-only development sign-in establishes a synthetic local user, without connecting a real account. New local D1/R2 state lives in ignored `.wrangler/`; no production DB is fetched. Six initial help/starter pages are code-authored product content. Your edits persist in this local state.

```sh
npm test # while the local preview is running; exercises only synthetic local data
npm run typecheck
npm run build
```

Deployment uses a new secondary-account Site and fresh bindings, not this local emulator. `hosting.template.json` has no Site ID. The preparation command refuses to replace an existing hosting manifest containing a project ID. No public visitor/edit policy or hosted MCP verification is claimed. Internal `wiki42_*` tool IDs are preserved for compatibility; public branding is PAW Wiki.
