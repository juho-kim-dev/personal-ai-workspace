# Secondary-account handoff: six independent Sites

**Independent deployment packages are not ready; no Site is deployed by this change.** The previous single-site plan is superseded. There will be six independent Sites, with no landing/guide Site. README will link directly to actual demo URLs.

## Superseded package

`npm run build` currently builds the combined prototype. `npm run package:sites` intentionally stops instead of packaging it. Previously generated `.local/sites-ready/` and transfer ZIPs are obsolete and must not be uploaded. `sites/hosting.template.json` is only a neutral reference, not a complete six-site configuration.

## Preparation and publication

1. Give every demo a direct entry, independent state and self-contained output. It must work while the other five are absent.
2. Produce one transfer directory/manifest per demo, including only required assets and notices. Keep document WASM with the document demo and the Node MCP process outside browser bundles.
3. Run behavior, build, provenance/privacy and isolated browser checks. Record actual results; combined-prototype checks do not establish independent-site acceptance.
4. In the secondary account's session, confirm the Sites connection belongs to that account and follow its installed Sites skill. GitHub login and local folder do not select the Sites account. Do not substitute the main account connector.
5. Create six Sites with functional names, each with its own deployment workspace, returned Site ID and output directory. No guide Site or reused private Site ID. Keep credentials and account identities out of this repo.
6. Follow the installed skill's supported packaging/publication flow for each Site. Only record deployment after terminal success. Inspect each returned URL against the owner's naming constraint before adding README links.

## Acceptance and deployment record

All rows are pending. Populate actual URLs/revisions only from confirmed results.

| Site | Required behavior | URL / deployed source / verification |
| --- | --- | --- |
| Conversation archive | Search, context, fixed links, unknown-revision rejection | Pending |
| Notes workspace | Editing, graph, canvas and unsaved-draft recovery | Pending |
| Knowledge & reports | Source observations leave reports unchanged; review/apply; stale rejection | Pending |
| Document editing | Body/table edits, WASM render, HWPX download/reopen, standalone fixture | Pending |
| Reference boards | Selections, boards and notes persist independently | Pending |
| Media library | Authored annotations, video seek to 2 seconds, image 2 navigation | Pending |

For each Site verify direct load/reload, desktop/narrow layouts, independent storage, no private-domain requests and public access under the intended account. Test media byte ranges and WASM serving on the actual host. Missing optional cross-site destinations must not prevent standalone use.

Source delivery, main adoption, package readiness and deployment are separate states. This correction updates scope and records; it does not complete six-site implementation or publication.
