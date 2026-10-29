> **Current direction, 2026-10-29:** [Actual sites with a Wiki hub](PUBLIC-DIRECTION.md) supersede the six-role prototype and fixed-six/no-hub plan. The earlier evidence below remains limited to its original prototype/module scope. For the actual Wiki see [Wiki validation](../sites/wiki/VALIDATION.md).

# Claims and reproducible evidence

Use this document to keep project/CV descriptions proportional to what a reader can inspect. AI assistance was used in development; third-party engine authorship is attributed separately.

The target is six independent demo websites with no landing/guide site. They are not yet implemented as independent outputs or deployed. The previous combined prototype is superseded. Source publication in a PR, main adoption and deployment are distinct. Do not claim six complete public sites.

## Supported public wording

**English:** Developed an AI-assisted personal workspace collection and prepared public reference source spanning conversation archives, linked notes, evidence-based knowledge review, HWPX editing, reference boards and media browsing. Reused and documented selected implementation modules, added synthetic fixtures and local tests for draft preservation, stale-proposal rejection, idempotent application and document export/reopen checks.

**한국어:** AI 보조로 개발한 개인 작업공간의 여섯 역할의 공개 참조 소스를 준비했다. 대화 원문·노트 연결·근거 기반 지식 검토·HWPX 편집·자료 보드·미디어 탐색의 기존 핵심 코드를 선별 공개하고, 합성 자료로 초안 보존·오래된 수정안 차단·중복 적용 방지·문서 저장 후 재열기 검사를 재현했다.

| Claim | Inspectable evidence | Limit |
| --- | --- | --- |
| Source-preserving search and fixed links | `components/conversations/core.js`, archive and link tests | Public synthetic messages; no live share-link collector |
| Linked notes and editable canvas | Existing `GraphView.tsx`, `CanvasEditor.tsx`, metadata/graph/canvas modules; UI checks | Public shell uses a plain text note editor; private embedded editor host omitted |
| Unsaved draft preservation | `draft-journal.ts`, quota-failure and separate-run tests; recovery UI | Browser-local records; full remote conflict recovery is selected library source, not a connected public server |
| Revision-bound knowledge review | Existing `contract.ts`, new `src/domain.ts`, stale/idempotency tests | Browser demo transitions, not D1 concurrent transaction proof |
| HWPX editing and preservation checks | `structured.mjs`, `structured-snapshot.mjs`, `documents.mjs`, WASM, tests | First-section body/direct cells; selected fingerprints; same engine reopens output |
| Reference-board organization | `workspace-validation.mjs`, membership/conflict tests, UI notes/favorites | Authored image catalog; no remote collection or social service |
| Media corpus and timed navigation | `saved-corpus.js`, `saved-media.js`, original SVG/WebM and UI seek readback | Annotations are authored fixtures, not real OCR/ASR inference |
| MCP interface | `src/mcp.ts`, seven tool contract tests and stdio smoke check | Local read-only fixture adapter; not browser state or an always-on hosted endpoint |
| Independent deployment plan | `docs/ARCHITECTURE.md`, `docs/DEPLOY-SITES.md` | Six outputs and packages pending; old single-site packaging disabled; no live URLs |

## Claims not established by this public release

- Full autonomous operation, universal AI access to all apps, real-time collaborative editing, live cross-device synchronization or production authentication.
- Live ChatGPT collection, resumed remote collection, always-on background execution, or model-generated OCR/transcripts. These require separate safe source publication and reproducible integration tests.
- Independent authorship of the HWP/HWPX engine. The bundled MIT engine and retained patches are explicitly attributed in `licenses/` and the engine manifest.
- Complete HWP/HWPX compatibility, lossless editing of arbitrary documents, an independent-parser comparison, or successful upstream host test suite.
- The historical private **8-page / 16-cell** document check is not reproduced by this release. The automated public fixture checks **one page / six cells**. Do not substitute one result for the other.
- A deployed public website, user counts, performance gains, measured reliability or production scale. Add those only with actual receipts or measurements.

The existing public overview's historical examples have been retained here as scope boundaries, not silently converted into public test passes. This PR changes the repository from documentation-only to executable reference source; main adoption and deployment are separate events.
