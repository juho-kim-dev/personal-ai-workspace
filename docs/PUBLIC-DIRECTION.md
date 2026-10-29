# Public direction — 2026-10-29

The owner selected public instances of the actual applications, preserving their existing screens and behavior and changing public names. Exclude all personal usage data. Do not replace these applications with a six-role reference prototype or a new simplified demonstration shell.

PAW Wiki is the central hub, using the existing Wiki42 front page. Each other application remains an independent site/runtime/store and will be linked from the Wiki once its public URL is confirmed. Wiki is also a functioning wiki, not a separate marketing/guide site. The former prohibition on any hub and the fixed six-site scope are superseded by this decision.

| Source product | Public title | Scope |
| --- | --- | --- |
| Wiki42 | PAW Wiki | First preview; central wiki and hub |
| Yarnbox | PAW Threads | Planned |
| Naid | PAW Notes | Planned |
| Yeobaek | PAW Documents | Planned |
| Nalanhi | PAW Study | Planned |
| Tseret | PAW Boards | Planned |
| Marga | PAW Media | Planned |
| Acra | PAW Community | Planned |
| Tig | PAW Projects | Candidate only |

Ikna, Alder, Cedar and Uman Wiki are not currently planned for public delivery. SWU remains a separate repository/tool, not a replacement for these sites.

## Data and deployment

Publish separate instances in the secondary Sites account after verifying the actual connected owner. Do not reuse a private Site ID, database, bucket, account connection, hostname, token, uploaded file, backup, browsing record, conversation or personal document. Public source may retain product names in provenance/internal compatibility identifiers; functional public names apply to the UI. Start with empty storage and product help authored for this instance, not migrated usage data.

Keep actual application capabilities. Authentication, per-visitor edit isolation, storage and MCP access must be verified for the new public deployment; do not make an owner-only application's shared write store anonymously writable simply by renaming it. This local preview preserves the existing auth logic and uses the upstream loopback-only development sign-in. Public audience and hosted access behavior remain a separate deployment step.

## First delivery: Wiki

`sites/wiki/` is a source adaptation of Wiki42 Git main `df2dc031c48e25a4018b0bf1c9f302ec0d74665a`, inspected on 2026-10-29. Shared guidance SHA: `c831be80249192d2acbeaa01ad0b0b488a970569`. The current connected Sites account could not read the private Wiki42 site, so parity with the latest live Sites version is not asserted. This is the latest verified GitHub main, not the stale Mac primary checkout.

Only tracked runtime/build/migration source was selected. Private checkout, worktrees, operating services and production data remain unchanged. The local preview uses new D1/R2 emulator state and no imported personal data. Public branding, starter guide and hub cards are adapted; unavailable destinations are visibly pending rather than linking to private sites. Source paths and SHA-256 comparisons are recorded in `sites/wiki/source-manifest.json`.

## Former prototype

The root `src/` six-role prototype, selected `components/`, fixtures and their tests are historical reference work. Do not package or deploy them as the requested public websites. Their 14 tests do not prove full application parity. Keep prior evidence with its date/scope. The next work proceeds application by application, starting with Wiki; no other application is claimed ported or deployed.

## Acceptance and order

1. Record names and scope; prepare actual Wiki source and independent local storage.
2. Verify Wiki front page, navigation, search, document editing, persistence and stale-version rejection; inspect branding and private endpoints.
3. Review local Wiki. Prepare its separate secondary-account hosting and explicit public access/data-isolation policy; verify actual hosted behavior before recording a live URL.
4. Port the remaining actual applications independently under the selected names; keep their own build/storage and source provenance.
5. Connect confirmed public URLs in the Wiki hub. Projects remains a candidate until selected for implementation.

No main merge or hosted deployment is performed by the current local-preview task. GitHub Actions remain paused; remote delivery commits include `[skip ci]`.
