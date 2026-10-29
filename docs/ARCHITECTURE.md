# Six independent demo websites

Public delivery consists of six separately usable and deployable websites: conversation archive, notes workspace, knowledge/reports, document editing, reference boards and media library. There is no seventh landing/guide website, unified app or shared role-switching shell. README provides the explanation and eventual direct links.

## Boundaries

- One public source repository may contain all six demos; this does not imply one runtime or deployment.
- Each demo has its own entry point, role-specific UI, synthetic fixtures, storage namespace and build output. It opens directly and works without another demo running.
- Each output becomes a separate Site through the secondary account, with its own Site ID, URL and deployment record. Credentials and deployment identities stay out of public source.
- Prefer existing application code and UI. Record copies, adaptations, new code, omissions and pending work. Do not replace six actual products with six generic pages of a common app.
- Share source utilities where useful, but not a mutable runtime state object, production database or personal content.
- Cross-site source links use explicit optional public URLs. Missing URLs must be shown as unavailable, not routed through a combined app. Each demo remains usable alone.
- Public names describe functions; all records are synthetic. Private applications and data remain private.

## Current implementation

`components/` contains 37 selected existing files with provenance. `src/app.tsx` still contains a combined prototype with overview, role navigation and aggregate browser state. Those choices are superseded. Its code is temporarily retained for extracting verified behavior, not offered as the release architecture.

The single-site packaging command is disabled. Previous `.local/sites-ready/` output and transfer ZIPs must not be published. Independent entry points, output directories and deployment packages are pending. Historical prototype checks remain evidence of exercised behavior, not acceptance of six independent sites.

The local MCP example reads immutable fixtures only; it does not access browser edits. `read_documents` describes a contract, not a live parsed browser document.

## Existing code and remaining adaptation

| Demo | Existing code | Remaining independent demo work |
| --- | --- | --- |
| Conversation archive | Search, highlights, context, fixed references | Archive UI/entry, fixture loading and standalone fixed links |
| Notes workspace | Metadata, graph/canvas UI, draft recovery | Independent editor/state and preserved recovery |
| Knowledge & reports | Evidence/proposal contracts | Review UI/state, local evidence and optional external source links |
| Document editing | Staging, preservation checks, patched MIT WASM | Editor/fixture, dedicated engine assets, download/reopen flow |
| Reference boards | Workspace validation | Board UI/catalog/state based on existing behavior |
| Media library | Corpus and player/carousel controls | Media UI/assets, byte ranges and seek verification |

## Development sequence

1. Correct scope, PR, issue, CV wording and deployment instructions. Keep the six-site issue open; code selection alone does not complete it.
2. Recheck the original apps' relevant UI/behavior, then separate each demo's entry and state. Remove the combined overview/navigation from deliverable code when replacement entries exist. Preserve source fidelity, recovery and error handling.
3. Build six self-contained outputs with only their required assets. Prepare separate deployment workspaces and per-site manifests. Do not create a root landing page.
4. Verify each output in isolation: direct load/reload, independent persistence, no other demo required, no private requests and role behavior in the deployment checklist. Test configured cross-site links separately.
5. Publish only through the correctly connected secondary Sites account after these checks. Record six actual URLs, source/deployment revisions and verification dates. Check the owner's address constraint before linking them from README.

Collectors, server concurrency, live MCP writes, independent document-parser comparisons and reproducible engine rebuilds are separate later work. SWU is outside this repository.

## Behavior to preserve

Keep source text, order, stable IDs and revision-bearing links. Summaries are derivatives. Distinguish observations, proposals and adopted changes; new evidence does not automatically edit a report. Reject stale proposals and repeated application. Preserve unsaved drafts and stage document changes before committing. Authored annotations are not OCR/transcript inference. Remote archive availability does not prove its collector runs while a local machine is off.
