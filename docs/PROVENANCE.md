> **Current direction, 2026-10-29:** [Actual sites with a Wiki hub](PUBLIC-DIRECTION.md) supersede the six-role prototype and fixed-six/no-hub plan. The earlier evidence below remains limited to its original prototype/module scope. For the actual Wiki see [Wiki validation](../sites/wiki/VALIDATION.md).

# Source selection and attribution

The maintainer selected source from the canonical commits of six independently developed applications. No private working tree, history, database, personal note, conversation export, cache, account credential or original third-party site asset was copied wholesale.

`provenance.json` records each selected file's source commit, source-relative locator, original SHA-256, public path, selected-byte SHA-256 and transformation. Private repository identities are maintained separately by the owner. A source hash supports byte tracking; it is not a public link to inaccessible private source, nor proof that every private feature is shipped here.

## Selection boundaries

| Role | Existing implementation selected | Public adaptation |
| --- | --- | --- |
| Conversation archive | Search, Unicode highlighting, context, fixed links, HTTP repository helper | Remove private static-demo loader; bind synthetic messages |
| Notes workspace | Graph simulation/UI, metadata/query, JSON Canvas/UI, draft journal/recovery/shared-document modules | Relative imports and role-only namespaces; extract required YAML helpers/type; file cards use existing open-file fallback |
| Knowledge & reports | Complete knowledge contract and shared error class | Remove private host check; retain public archive fixed-reference validation; browser transitions are new code |
| Document editing | Structured operations/staging, fingerprints, portability/contract helpers, reviewed engine bytes and patches | Use bundled engine for public initialization and reopen; sanitize public engine manifest |
| Reference boards | Existing workspace validation | Public catalog and browser persistence adapter; private product directory omitted in source locator |
| Media library | Existing corpus identity/search and carousel/video controller | Rename runtime namespace; use same-origin authored assets |

Some selected library code is included for inspection and later adapter work but is not wired into the demo: full shared-document transport/recovery coordination, archive HTTP repository, and some document portability helpers. Their presence does not imply these network or format features are enabled. The test record names the exercised behavior.

## Third-party engine

The HWP/HWPX engine originates from [edwardkim/rhwp](https://github.com/edwardkim/rhwp), upstream commit `1a76570e833917d15817415a53c09ad61ab3203f`, MIT. The public copy contains an already reviewed patched WASM, matching bindings, original license, upstream notices and the retained source patches. `components/documents/engine-lock.json` identifies them.

This release does not include the opaque original Studio bundle. It builds its own small structured editing UI around the engine. The included binary was not rebuilt from Rust in this public task. Prior upstream host tests were blocked by absent fixtures; only the public runtime checks reported in `VALIDATION.md` are claimed here.

Runtime libraries keep their own licenses. The build preserves bundled legal comments in `dist/app.js.LEGAL.txt`. `licenses/rhwp-third-party.md` is the retained upstream dependency notice and may describe upstream packages not included in this demo. Original authored SVG/WebM assets follow the project license.

## Verification

Run `npm run check:public` to verify selected-byte hashes and scan the selected file set for known private-host/credential/path patterns. Review the diff as well: a heuristic scanner cannot prove absence of every possible personal datum. Do not regenerate provenance from a whole private directory or use a copy command that also takes runtime state.
