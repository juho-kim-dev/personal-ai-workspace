# Public application deployment handoff

Follow [PUBLIC-DIRECTION.md](PUBLIC-DIRECTION.md). The old combined prototype package is disabled and must not be deployed. The first actual application is [PAW Wiki](../sites/wiki/README.md), a dynamic Vinext/Workers application with D1 and R2, not a static export.

1. Review the local Wiki and its source manifest. Confirm only fresh starter/help data, no private endpoints or deployed identity.
2. Verify the connected Sites owner is the intended secondary account. Existing private Site IDs must never be reused.
3. Create a separate Wiki site and fresh storage only in the authorized account. Put its returned identity into the ignored hosting manifest while preserving DB/BUCKET and MCP requirements; do not invent an ID.
4. Preserve server auth and determine public visitor read/edit isolation explicitly. This original owner-oriented app is not automatically a safe shared anonymous editor. Do not disable auth to make the demo visible.
5. Build/package the actual Wiki with the current supported Sites workflow, then verify hosted navigation, editing policy, storage, MCP and privacy. Record actual URL/version/commit.
6. Repeat for each selected actual application and put confirmed public URLs into the Wiki hub.

This task prepares a local preview and GitHub record only. No hosted deployment, public URL, external access change or secondary-account verification is claimed.
