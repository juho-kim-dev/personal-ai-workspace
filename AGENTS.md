# Public PAW reference implementation

Use functional role names in public content. Private product identities, account addresses, real conversations, documents, databases, deployment IDs and credentials do not belong here.

Read README.md, docs/ARCHITECTURE.md and docs/PROVENANCE.md before changing the demo. Reused modules have original and selected SHA-256 hashes in provenance.json. Record any adaptation and update its output hash; do not silently claim an adapted module is byte-identical.

Keep private source checkouts read-only. Work in a small codex/ branch and submit a PR. Preserve unrelated changes. Do not merge main or deploy without the applicable task authorization.

GitHub Actions are paused until the owner explicitly resumes them. Do not add or run workflows. Use [skip ci] in every delivered commit and PR HEAD. Use local npm test, npm run build and npm run check:public. Check actual workflow events before remote writes and new runs afterward.

Public demos are destined for the secondary Sites account. Never infer that the currently connected Sites account is the intended account. Use docs/DEPLOY-SITES.md. A prepared directory is not a deployment. Do not publish a private implementation, migrate personal data, or change a private Site's audience.

Test assertions must support the published claims. Keep live AI, fixture responses, locally tested behavior, historical private evidence and deployed behavior separate. The document engine is third-party MIT software plus identified patches, not an engine authored entirely by this project.
