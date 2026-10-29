# Historical combined-prototype validation — 2026-10-29

The combined presentation below was superseded by the decision to build six independent demo websites with no guide site. These checks and screenshots describe that earlier prototype only. They do not verify independent entries, storage, outputs or deployments. Those checks remain pending. The old transfer package is obsolete; see `DEPLOY-SITES.md`.

Scope-correction checks: documentation links and authored diff whitespace passed; public-boundary scan passed for 89 files with all 37 provenance hashes matching. The disabled packaging command was checked to exit 1 with the independent-site explanation. The earlier 14-test suite and browser walkthrough were not rerun for this documentation/packaging correction; no new independent-site behavior is claimed.

Environment: Windows desktop, Node.js 24.22.1, npm 11.19.1. Local Codex in-app browser; mouse/keyboard input. This is local evidence, not a hosted deployment or an external-browser certification.

## Automated checks

- `npm test`: **14 passed, 0 failed**. Source search and Unicode boundaries; fixed links/context; graph links; canvas unknown-field preservation and dangling-edge rejection; YAML comment preservation; independent draft records and quota fallback; knowledge contract; stale/idempotent proposal application; board validation/conflict; media corpus matching; MCP tools; actual WASM document edit/reopen; failed batch leaves original bytes unchanged.
- `npm run build`: browser bundle, CSS, assets, WASM and local MCP built successfully.
- `npm run check:public`: selected files scanned for known private paths/hosts/credentials; 37 selected-source output hashes verified. This is a bounded heuristic check, supplemented by explicit source selection and diff review.
- MCP stdio smoke: initialize, list seven tools, call conversation search; valid JSON-RPC responses and two expected results for the fixture query.
- HTTP range smoke: WebM byte range `10–19` returns HTTP 206 and exactly 10 bytes. This matters for browser seeking.
- Authored-file whitespace checks passed. The full staged diff reports retained whitespace in original patch context, one upstream license and two selected modules; those bytes are preserved for source hashes rather than rewritten solely for formatting.
- GitHub Actions: paused, no workflow added. Before remote delivery the repository had no workflows and zero runs. Remote CI was not run or represented as passed.

The first document test used an incorrect hard-coded cell length and was corrected to use the actual scalar length returned by the engine. The complete suite then passed. This was a test-fixture error, not a suppressed engine failure.

## Browser checks

| Role | Observed result |
| --- | --- |
| Conversations | Searching “자막” returns 2 authored messages; fixed source link opens message 3 and surrounding context |
| Notes | Graph shows 3 actual notes/2 links; canvas text card can be added/edited; leaving an unsaved note and returning offers its recovery record |
| Knowledge | Proposal applies and preserves history; a later direct save makes the previous open proposal stale and disables application |
| Documents | Body and table-cell text changed; HWPX export/reopen reports 1 page/6 cells and preserved selected text/style/table checks |
| Boards | Note text and membership in “선정 후보” persist after interaction |
| Media | 6-second synthetic video plays; 2-second seek readback is `applied`, actual time 2; image annotation opens carousel image 2 |

The initial preview server did not advertise byte-range support and video seeking returned time 0. Adding range responses fixed the observed seek. The deployment handoff includes the same acceptance check.

Desktop layout inspected at 1280×900. All six roles also opened at a 390×844 viewport override; measured content width and scroll width both 375 CSS pixels, with no horizontal page overflow. The browser's scrollbar accounts for the remaining width. This is responsive-layout inspection, not physical phone/touch testing. Browser error/warning log inspection returned no entries during the role walkthrough.

Screenshots show the actual local UI and synthetic data: [overview](screenshots/overview.jpg), [conversations](screenshots/conversations.jpg), [notes](screenshots/notes.jpg), [knowledge](screenshots/knowledge.jpg), [documents](screenshots/documents.jpg), [boards](screenshots/boards.jpg), [media](screenshots/media.jpg), [mobile media](screenshots/mobile-media.jpg). A full-page screenshot API produced distorted captures; those files were replaced with normal viewport captures, rather than presented as a product rendering result.

## Not checked or not provided

- Secondary-account registration/publication, actual public URL and live-host resource behavior.
- Chrome/Safari/Firefox regression, physical touch, screen-reader audit, complete keyboard coverage or conformance certification.
- Live AI/model invocation, private accounts, production databases, remote import/collection, server-side ownership, multi-user concurrency, actual OCR/ASR.
- Full remote note-recovery workflow, all selected library helpers, independent document parser or arbitrary real-world document compatibility.
- Rust rebuild, upstream host test suite, historical private 8-page/16-cell fixture. Those are not substitutes for the public 1-page/6-cell test.

Source publication, main integration and deployment remain separate states. See the PR for the delivered commit and `DEPLOY-SITES.md` for pending independent-site preparation and account-bound publication.
