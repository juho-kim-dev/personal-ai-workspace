# Personal AI Workspace (PAW)

**Keep the source. Connect the context. Continue the work.**

[한국어](README.ko.md) · [Architecture and next steps](docs/ARCHITECTURE.md) · [Evidence and limits](docs/CV-EVIDENCE.md) · [Secondary-account deployment](docs/DEPLOY-SITES.md)

PAW is an AI-assisted collection of personal tools. This repository contains selected existing code, synthetic fixtures, local checks and attribution. Public delivery means **six independent demo websites**. There will be **no landing/guide website, unified app or shared role-switching shell**. README provides the explanation and eventual direct demo links.

## Six independent demos

| Demo | Existing implementation to reuse | Independent site status |
| --- | --- | --- |
| Conversation archive | Search, Unicode highlights, context and fixed links | Pending extraction and verification |
| Notes workspace | Metadata, graph, JSON Canvas and draft recovery | Pending extraction and verification |
| Knowledge & reports | Evidence/proposal contracts and revision-bound review | Pending extraction and verification |
| Document editing | Structured staging, preservation checks and patched HWPX engine | Pending extraction and verification |
| Reference boards | Board, item and section validation | Pending extraction and verification |
| Media library | Corpus search, timed video and image navigation | Pending extraction and verification |

Reuse each application's actual behavior and UI where suitable, replacing private content with synthetic fixtures. Selected core modules are present; this does not mean six full applications have been ported. Private names, sites, records, credentials and production databases stay outside this publication. SWU is separate.

## Current source status — 2026-10-29

The earlier combined prototype is **superseded and is not the release architecture**. Its source is temporarily retained to extract verified behavior. Its screenshots and shared browser state do not demonstrate six independent sites. Independent entry points, state, builds and deployment packages remain to be implemented.

The following commands reproduce the **superseded prototype only** (Node.js 22.13+):

```sh
npm ci
npm test
npm run build
npm start
```

The local preview is at `http://127.0.0.1:4173`. Download document edits before leaving its view. `package:sites` intentionally stops; the old single-site package and previously generated transfer ZIPs must not be published. No independent Site is currently claimed ready or deployed.

## Source and evidence

- `components/`: selected existing modules; `provenance.json` records source commits, original/selected hashes and adaptations.
- `src/`, `assets/`: synthetic fixtures, original assets, adapters and the superseded combined prototype.
- `tests/`: behavior and real-WASM checks. [Validation](docs/VALIDATION.md) separates prototype evidence from pending independent-site checks.
- `docs/`: architecture, provenance, deployment acceptance and [CV boundaries](docs/CV-EVIDENCE.md).
- `sites/`: neutral configuration reference, not a six-site deployment package.

`npm run check:public` checks selected-source hashes and known private-data patterns; it cannot prove arbitrary future additions safe. GitHub Actions remain paused.

After building, `node <absolute-checkout-path>/dist/mcp.mjs` runs a read-only fixture MCP example, without browser edits, private apps or a live model. AI proposals and media annotations are authored examples.

The document engine derives from [rhwp](https://github.com/edwardkim/rhwp); see [provenance](docs/PROVENANCE.md) for patches and third-party notices. Full engine authorship and universal compatibility are not claimed. Project-authored code/assets are MIT; third-party licenses remain applicable.
