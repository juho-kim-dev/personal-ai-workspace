# Actual application instances with a Wiki hub

The authoritative current decision is [PUBLIC-DIRECTION.md](PUBLIC-DIRECTION.md). It supersedes the six-role shell and the subsequent fixed-six/no-hub plan.

Each application keeps its own UI, service logic, runtime and storage. Wiki hosts its own documents and the existing front-page portal; it does not absorb the other applications into one runtime or database. The first adapted application is `sites/wiki/`, with real wiki API routes, migrations, document history, knowledge/review and browser tools retained.

The directory may contain internal compatibility names; public branding is PAW Wiki. No personal records or existing deployment identities are shipped. Root `src/` and its tests remain historical prototype code and are not a release target.

Future applications must be based on their actual current source, not reconstructed from selected role modules. Add only confirmed public URLs to Wiki. Projects is a candidate; excluded products and SWU follow the scope decision.

## Nodes

[PAW - Nodes (pawn)](PAWN.md) is the planned visual workspace for documents, data and meaningful relationships. Its first target is a complete Markdown node/relationship workflow using the existing application foundation. JSON/object views, AI proposal review, Mermaid integration and workflow execution are staged goals. Graph/Canvas views do not yet establish a shared semantic relationship model. Nodes keeps independent runtime/storage; Wiki remains the hub.
