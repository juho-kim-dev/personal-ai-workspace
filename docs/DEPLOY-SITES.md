# Secondary-account Sites handoff

The source and static output are prepared. **No public Site has been deployed by this change.** Use the secondary account's Sites connection. The repository intentionally contains no project ID, account-specific hostname, secret or deployment credential.

## Build and transfer

Node.js 22.13+:

```sh
npm ci
npm test
npm run package:sites
npm start
```

Open `http://127.0.0.1:4173`. `package:sites` creates `.local/sites-ready/` with `dist/`, a SHA-256 file manifest, this handoff and a neutral hosting template. The ordinary source checkout is also sufficient; do not transfer private source folders. The included `assets/light.webm` is original synthetic media, not a download from a private service.

## Deploy in the secondary account

1. Open the public repository in the secondary account's task. Confirm the Sites tool connection belongs to that account. The tool connection, not the local directory or GitHub login, determines the Site owner. Do not reuse a main-account Site ID or connection.
2. Read the installed Sites skill. Register a **new** Site using a neutral role-based name such as `paw-demo`, preserving the returned `project_id`. Creation normally starts private. The owner has requested a public demo; use the supported audience control to make **only this synthetic demo** public.
3. In a dedicated deployment checkout, run the Sites helper `set-project-id.mjs --project-id <returned-id> --static-directory dist`. `.openai/hosting.json` is local to that deployment and ignored by the public repository. Keep the source helper's required identity in the deployment checkout, not in this public repo.
4. Run `npm ci`, `npm test`, `npm run build`, `npm run check:public`. Because the resulting `dist/` is already static, package it with the installed Sites `site-workflow.mjs` source helper using its documented JSON input and a credential returned by the secondary account's native tool. Use `commands: []` when these unchanged checks/builds already passed. Do not pass a hand-made ZIP as if it were the helper's verified archive.
5. Pass the helper's returned `project_id`, `commit_sha`, and `archive` to the native save/publish tools. For a supported public audience, use `save_site_version` then `deploy_site_version`; follow the installed skill's current schema. Never reuse a credential from another account or print it into this repository.
6. Wait for a successful terminal result. Record actual Site URL, source commit, deployment/version identifier and verification date in the release record. Until then, use “deployment prepared,” not “live demo.”

The built browser assets do not need the Node-only `dist/mcp.mjs`; the transfer script omits it. The document WASM is about 15.6 MB and is lazy-loaded when the document role opens. Static hosting must serve WASM and support byte-range video requests. Test media seeking after deployment, not only playback.

## Acceptance checks

- Fresh visitor can open every role without sign-in and without any private-domain request.
- Fixed source links open the expected message; an unknown revision is explicitly rejected.
- Editing a note yields a recovery record; graph links and canvas edits work.
- A new source observation leaves report content unchanged; stale proposals cannot apply.
- HWPX body and table edits survive download/reopen; arbitrary document compatibility remains unclaimed.
- Board selections and notes persist in the tab; video can seek to 2 seconds; image annotations open image 2.
- Inspect the **actual returned URL** for the owner's naming constraint before adding it to the public README. A secondary account is not by itself proof of the final hostname.

There is no credential-free way for this checkout to deploy through a different account's connector. This handoff leaves that account-bound step to the correctly connected secondary session.
