# PAW Spaces, Tools, Objects and Core

The current direction is [PUBLIC-DIRECTION.md](PUBLIC-DIRECTION.md). PAW — Personal AI Workflow — is a modular Personal AI Workspace. Spaces are applications; Tools are reusable capabilities; Objects are the information they use; Core names the shared contracts and integration foundation. A Space can offer several Tools, and other Spaces can embed/reuse them.

Existing applications retain their source history, domain responsibilities and independent deployment options. This does not require isolated duplicate copies of every object. The goal is to reference the original owner, stable identity and selected revision while preserving access rules. Intentional copies and derived outputs retain distinct identities and provenance. Physical database topology and final schemas remain design work.

Wiki is a functioning wiki and hub linking confirmed public application URLs. It need not absorb all runtimes or own all originals. `sites/wiki/` is the first source adaptation with its existing API, migrations, document history, knowledge/review and browser tools. No public Canvas port is present. Root prototype code/tests are historical, not the release target. Private production data and deployment identities remain excluded.

## Canvas and reusable visualization

[PAW - Canvas](CANVAS.md) starts with the existing Markdown note-map foundation. It aims to combine document editing, relationship exploration, spatial composition, actual PAW object/status views, diagrams/charts and later workflow design/execution.

Separate original content, semantic relations, derived graph indexes, saved layout/filter state and execution records. Canvas may own view documents; it should not take ownership of every displayed source object. Reuse a Viewer and an object-reference contract in Wiki/Git/Forum rather than copying data or implementing separate graph engines. Yarns remains responsible for its original-conversation reader; Canvas can consume that Tool.

The first recommended integration is a read-only graph in Wiki, backed by the same objects as Canvas. Validate pinned/latest revisions, rename/deletion, source authorization and stale/error display. Later editing needs observed-revision conflict handling. UI reuse does not itself implement common storage, and an embed must not expose private sources through a public host. Cross-Space embeddings, shared object services, live updates and workflow execution are planned, not currently shipped.
