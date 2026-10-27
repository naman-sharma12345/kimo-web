# Phase acceptance evidence

## Integrated checkpoint, 2026-10-26 19:40 UTC

Executed in order: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
All four commands passed. ESLint has zero warnings, Prettier passes, strict TypeScript passes, and 90 tests in 11 files pass. Next.js 15.5.28 production build generated landing, token gallery, component gallery, warm-up, favicon, OG image and not-found routes without warnings. Future Studio, render and delivery UI are outside the supplied phases.

This is a **tested implementation checkpoint, not complete visual acceptance**. Source changes made after this checkpoint require a new gate run. No screenshot, axe, Lighthouse, 60fps video, codec compatibility or pixel-accuracy result is claimed from unit tests or a production build.

## Phase 0: foundation

- [x] Workspace, typed client, mock server, providers, stores and compositor integration boundary exist. Installation and production build succeeded.
- [x] Token definitions, typography, local licensed italic font and `/dev/tokens` implemented.
- [x] Component raw-hex lint prohibition configured.
- [x] Design bible, project rules, contracts and decisions documented.
- [x] Contract, client recovery and mock tests pass, including a real 45-edit WebSocket stream.
- [x] Requested skills and actual upstream install names recorded in `SKILLS.md`.
- [ ] Every requested skill installed under its exact requested name: upstream-name differences and unavailable names are explicitly recorded.
- [ ] `pnpm dev` and `pnpm mock:demo` manual smoke acceptance recorded.
- [ ] Browser rendering and token screenshots: BLOCKED, no authorized reachable preview.

## Phase 1: reusable UI

- [x] Components in sections 1.2 through 1.12 implemented with typed exports, DOM refs and token-based styling.
- [x] 24 UI tests cover keyboard behavior, overlays, field behavior and toast lifecycle.
- [x] Component source scan found no raw hex, `any`, `@ts-ignore` or inline fontSize.
- [x] `/dev/ui` production build passes.
- [ ] Axe zero-violation report, reduced-motion screenshot, screenshot evidence and visual review: UNVERIFIED.

## Phase 2: landing and composer

- [x] Landing, settings, sample prompts, composer interactions and metadata implemented.
- [x] Three interaction tests and five attachment-validation tests pass.
- [ ] Final integration review and global provider handoff: IN PROGRESS.
- [ ] Pixel bounding boxes, keyboard end-to-end route navigation, exit transition, desktop/mobile/file/drop/reduced-motion screenshots: UNVERIFIED.
- [ ] Lighthouse Performance >=95, Accessibility 100, Best Practices 100: NOT RUN.
- [ ] Named craft review complete: PENDING source review and visual evidence.

## Phase 3: uploads and browser media

- [x] Three-file scheduling, multipart above 100 MiB with 16 MiB parts, four part transfers, retries, cancellation and offline resume implemented and unit tested.
- [x] 24 upload/media tests cover fake-XHR scheduling, progress, ETags, early session creation, persistence, probes, filmstrip sizing, waveform and fallback paths.
- [x] Mock validates byte sizes, ordered part manifests, ETags, atomic completion and idempotency. Four multipart tests pass.
- [x] Global upload event listeners and toast infrastructure installed above route boundaries.
- [ ] Cross-route transfers and restoration screens verified end-to-end in a real browser: PENDING.
- [ ] Exact chip pixels, IndexedDB/codec compatibility in a real browser: UNVERIFIED.

## Phase 4: event-driven warm-up

- [x] Warm-up route and event-state reducer implemented; five state tests pass.
- [x] Production compilation of the dynamic warm-up route passes.
- [ ] Final integration review, restore and error routing: IN PROGRESS.
- [ ] Cancel/retry/time-out, actual streamed session navigation and asset prefetch verified in a browser: UNVERIFIED.
- [ ] Reduced-motion screenshots and 60fps unfold video: NOT RUN.
- [ ] Exact unfold-to-final-Studio geometry remains unverified. Phase 5 has since been supplied and its shell is now under validation.

## Browser evidence boundary

The implementation environment permits only its managed browser. Local Playwright/Chromium execution is not permitted here. Temporary frontend previews were subsequently authorized; actual captured evidence is listed below. Playwright and axe harnesses are supplied but have not been executed. No fabricated screenshot paths or local-browser execution are claimed.

## Publication

Initial five-file configuration scaffold: `00f993a2fbd1114ac5be2b3efab1caa6a6920f29`. Full-source publication and subsequent checkpoints are tracked separately and must be verified against the remote tree. Generated CC0 media fixtures are recreated by the versioned FFmpeg script rather than committed as large binaries. The exact licensed font and license are versioned.

## Follow-up checkpoint, 2026-10-26 19:50 UTC

The full source checkpoint `f59b65100c9744354119472eb81716ac773fe239` was published and its entire 122-file remote tree matched the frozen manifest. It was not presented as complete visual acceptance. Later changes are being published separately.

- All implementation handoffs are integrated. The landing route now uses global toast/upload listener ownership.
- The new Studio restore boundary performs authoritative REST status checks, redirects warming/rendering/done sessions, distinguishes 404, and presents the specified session errors. It is explicitly not the later Studio editor. Nine new restore-route tests pass.
- Three actionable UI audit defects are fixed; the UI suite now has 28 tests. Four storage-denial/malformed-record tests pass.
- The latest implementation test run passes **107 tests across 13 files**. Production compilation and type validation include the Studio route. Final publication will record the completed four-gate result.
- The prescribed 160x160 original grayscale grain tile now exists, generated by scripts/grain.mjs. PNG dimensions, decompressed length and every chunk CRC were validated. SHA-256: `18b3bfbdb8af5b0b10cd3ab4fe90b01c9171ad45e8a7845f568484e08ed17d75`.
- Actual mock CLI smoke: 45 consecutive project versions, 45 successful actions and final ask_review, command exit 0.
- Default-port dev startup is environment-blocked by an unrelated host process occupying 3000. An alternate-port dev start became Ready and served the actual landing HTML with status 200 and data-ready=true. This does not prove rendered browser behavior.
- Added axe audit scripts for landing and UI, deterministic warm-up screenshot fixture, and reduced-motion screenshot variants. These scripts are authored, not executed. Screenshots wait for fonts; no screenshot files are claimed.
- Exact palette contrast conflict is documented in DECISIONS.md. Source review is not an axe or screen-reader pass.

Remaining visual and browser acceptance items above remain unchecked. No full Phase 4 unfold-to-editor acceptance is possible without the real later-phase editor geometry. No user data or supplied private PDFs are published.

### Final publication gate

At 2026-10-26 19:51 UTC, the complete sequential command `pnpm lint && pnpm typecheck && pnpm test && pnpm build` exited 0 on the final implementation, including the grain generator, new browser-test scripts and Studio restoration boundary. All 107 tests in 13 files passed. The production build completed with zero warnings. This result does not change any unverified visual/browser acceptance item.

Post-gate HTTP smoke found the gallery omitted its required data-ready marker, which would hang the screenshot harness. The marker was added before the final corrected publication gate. Landing, token gallery, UI gallery and grain asset all returned HTTP 200; browser rendering remains unverified.

## First managed-browser evidence, 2026-10-26 20:03–20:08 UTC

The user explicitly authorized a temporary frontend preview, then ongoing frontend exposure for tests and screenshots. The approved preview made real managed-browser captures possible. These are screenshots of the running application, not generated mockups:

- `screens/phase-02-landing-desktop.png`: actual 1440x900 desktop landing.
- `screens/phase-02-landing-mobile.png`: CSS viewport requested at 390x844; the separate capture worker produced a 500x844 raster. This is not accepted as an exact 390px pixel baseline. The prompt-chip horizontal scrollbar needs specification review, not an assumed defect.
- `screens/phase-01-buttons.png`: actual component-gallery button variants.
- `screens/phase-01-fields-attachments.png`: actual fields and attachment-chip demo states, not a live-upload acceptance test.
- `screens/phase-00-tokens.png`: actual token gallery viewport.
- `screens/phase-04-browser-fetch-error.png`: actual warm-up failure, deliberately preserved rather than hidden.

The capture worker returned JPEG-encoded bytes even for PNG filenames. The repository evidence copies are decoded and saved as genuine PNGs without altering screenshot pixels.

The warm-up attempt used an explicitly declared synthetic session fixture, but exposed `Illegal invocation` from the native browser fetch function. The client default now binds fetch to globalThis; a receiver-sensitive test covers both GET and POST. The complete four-gate run passed with 108 tests in 13 files and zero warnings. Published regression fix: `1452b6022caaf0e1cc99ced14ef1f80b0bd51116`, exactly two client files; 130 unrelated remote files unchanged.

After rebuilding, the browser no longer throws Illegal invocation. It still cannot fetch the private localhost API from a remote browser, so warm-up/upload end-to-end acceptance is NOT claimed. A disposable synthetic-mock-backed frontend preview is being prepared for that transport test. No production backend credentials, real engine or workspace files are exposed by these previews.

These captures supersede the earlier blanket statement that no screenshots exist, but do not turn the unchecked visual, accessibility, performance or cross-browser acceptance items into passes.

## Phase 5 implementation checkpoint, 2026-10-27

The shell, responsive panels, guarded central keyboard registry, transport intent, typed session subscription, original-request restoration, local layout/title persistence and composable later-phase slots are implemented. No compositor, timeline editing, agent-message sending or final rendering is claimed in this phase.

The source audit fixed viewer-owned fullscreen toggling and reopening the tablet inspector after a new non-empty selection. Regression tests cover both; unrelated fullscreen elements and desktop selection are not overridden.

- [x] Fresh post-audit lint and formatting check passed with zero warnings.
- [x] Fresh post-audit TypeScript check passed.
- [x] Fresh post-audit full suite passed: **129 tests across 16 files**.
- [x] Post-audit production build passed with zero warnings. The initial combined run was interrupted; the restarted build finished with `BUILD_EXIT=0`.
- [x] Actual managed-browser panel boxes match at 1920x1080, 1440x900 and 1280x800 within one pixel. Evidence: `screens/phase-05-studio-1920.png`, `screens/phase-05-studio-1440.png`, `screens/phase-05-studio-1280.png`. This was direct Studio restoration of a real synthetic session, not automatic warm-up navigation.
- [x] Browser checks: keyboard agent resize 360 to 368, reload persistence, double-click reset, collapse to agent 48px/timeline 36px/inspector removed, shortcuts dialog/Escape, B tool shortcut and suppression while typing. Evidence: `screens/phase-05-collapsed-1920.png`.
- [x] Live mock action pill and pause/resume local intent observed. Mobile CSS viewport 390x844 has no horizontal DOM overflow and chat/timeline/edit tabs switch. `screens/phase-05-watch-390-crop.png` is an explicitly cropped 390x844 PNG from the capture worker's 500x844 padded raster, not an uncropped pixel baseline.
- [ ] Review pulse, original-message visual check and reduced-motion visual checks remain unverified.
- [ ] Rendered accessibility and cross-browser acceptance: not run.

The prior disposable-preview transport smoke succeeded for HTTP, actual WebSocket events, fixture bytes, binary upload round trip and blocked private paths. This does not establish a successful automatic warm-up-to-Studio navigation; the observed stall remains to investigate. No real backend, user data, workspace files or credentials are exposed in the synthetic preview.

### Browser-found restoration defect

The real browser restored an awaiting-review session at project version 45 but Finish was disabled, because action IDs were discarded. The fix adds optional server-recorded `actionIds` to the REST snapshot. The mock records actual unique action-start events and the shell hydrates those IDs; project version is never used as an action count. Legacy snapshots without history remain supported and do not invent actions. Focused contract/mock/Studio tests pass. Fresh full lint, typecheck and all 133 tests in 16 files pass; the post-fix production build completed with `BUILD_EXIT=0` and zero warnings. The browser reload retest passed at 2026-10-27 01:06 UTC: actual REST action IDs were present, the direct Studio restored them, and Finish remained enabled after reload. Evidence: `screens/phase-05-restored-finish-1920.png`.

Transport verification at 2026-10-27 00:39 UTC passed actual HTTP, WebSocket project operations, the 8,011,107-byte MP4 fixture, binary upload/download round trip and blocked private paths. Browser runtime errors were empty. The disposable preview subsequently stopped; its historical URL is not a live deployment.

### Published checkpoint and remaining flow boundary

Checkpoint `e0aead39282768efedaf70b5554a612300ed2d79` was published with parent `1452b6022caaf0e1cc99ced14ef1f80b0bd51116`. All 157 paths, Git blob hashes and file modes match the frozen intended tree `270e614ec07822197b4e8df77bbbafa6a62da963`. One dispatch, no retry, no deletions; the temporary approved-source transfer was removed. This is a tested implementation checkpoint, not unconditional phase acceptance.

The single follow-up landing flow reached ready with unfolding=true, but no Studio request occurred during the observed interval. The native transition API was present and CSS animation clocks were reported at zero. Subsequent preview-process loss caused connection errors. These observations do not prove a native transition bug or cached redirect; no prefetch redirect was observed. A defensive bounded navigation fallback is being implemented so cosmetic transitions cannot indefinitely delay essential routing, then requires fresh gates and a real-browser flow check.

### Bounded cosmetic-transition safeguard

Native transition callbacks are no longer an unbounded routing dependency. The shared once-only helper keeps the existing native animation, but dispatches navigation after the existing 220ms crossfade bound if the callback has not run. Native throws and rejected lifecycle promises use the same guard; cleanup cancels pending work and reduced motion navigates directly after the existing route delay. Late native callbacks cannot navigate twice. The original warm-up 400ms beat plus 900ms unfold, prefetch behavior and authoritative REST routing are unchanged.

The exact original stall cause is still unproven; this is a defensive navigation guarantee under normal JavaScript timer scheduling, not proof of a native-browser bug. Full lint, typecheck, **151 tests in 18 files**, and production build passed sequentially with `GATES_EXIT=0` at 2026-10-27 01:18 UTC. Tests cover absent/deferred/throwing/rejecting native APIs, once-only behavior, cleanup, reduced motion and both route integrations. The full browser flow retest is pending.

### Restart-resilient synthetic test preview

The next full flow attempt reached automatic warm-up and triggered Studio compilation, but execution restart destroyed the temporary services and browser continuity before Studio completion could be verified. This remains infrastructure-interrupted, not an established application failure or an end-to-end pass.

A manually dispatched GitHub Actions test preview now provides a lifecycle independent of this execution environment. The repository permission is read-only, checkout credentials are not persisted, child environments are allowlisted, all mock routes are method/path restricted, HTTP request bodies are capped at 32 MiB and websocket buffers at 1 MiB. The public endpoint contains synthetic fixture data only, uses a checksum-verified official tunnel binary and shuts down no later than 15 minutes after gateway startup. A URL/expiry-only artifact is uploaded before the bounded hold so a browser test can retrieve it during the run. No production engine, provider keys, private workspace or permanent deployment is included.

Server-rendered requests may use the optional internal gateway URL; browsers continue using the public API URL. Four regressions cover that separation. Eight gateway tests cover route/method boundaries, environment isolation, real local synthetic HTTP/WebSocket transport, URL validation and declared/chunked body caps. Full integrated lint, typecheck, **163 tests across 20 files**, and production build passed sequentially with `GATES_EXIT=0` at 2026-10-27 01:38 UTC. A test-double lint issue and the integrated Next ProcessEnv type requirement were corrected before that successful run.

Hosted workflow execution, artifact availability during the active run and the automatic browser flow remain pending. The code and authored workflow are not evidence of a running deployment.
