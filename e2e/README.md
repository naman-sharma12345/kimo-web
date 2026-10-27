# Authored browser acceptance harness

**2026-10-27: authored, not run. No Phase 10 baselines captured.** No local
browser, Playwright invocation, browser installation or fixture service was used
to author this suite. These instructions are for a separately authorized runner,
not permission to use the developer workstation or the active shared browser.

## Runner separation

1. Existing suites remain in place. `screenshots.spec.ts` and
   `accessibility.spec.ts` now consume `state-matrix.ts`: five exact CSS viewports,
   every listed forced state, default/reduced-motion/high-contrast modes.
2. Default/gallery/landing/privacy cases use `PLAYWRIGHT_BASE_URL`. Dev routes
   require an authorized host exposing them. The temporary public preview denies
   dev routes; a denied route is BLOCKED, not an application regression/pass.
3. SSR Studio/render/delivery fixtures require **both** Next's server transport
   and the browser's public transport to point to `http://127.0.0.1:8791` on the
   same isolated runner. `page.route` cannot intercept server-side Next fetches.
   Do not set `PHASE10_FIXTURE_RUNNER=1` against a normal/production service.
4. A separately authorized runner can start `pnpm exec tsx e2e/fixture-server.ts`,
   and start Next with `NEXT_PUBLIC_KIMO_API=http://127.0.0.1:8791`,
   `NEXT_PUBLIC_KIMO_WS=ws://127.0.0.1:8791`, and
   `KIMO_API_INTERNAL_URL=http://127.0.0.1:8791` in development. Rebuild if using
   a production build because public env values are baked into the bundle.
   Set `PHASE10_FIXTURE_RUNNER=1` only after `/health` identifies this fixture.
   The service binds loopback; do not expose it as a production backend.
5. The fixture uses parsed schema objects and existing original fixture bytes.
   `pnpm install`'s existing generator requires FFmpeg. Missing media yields 404,
   not substituted artwork. No inference, model, auth or quota implementation.
   CORS allows only localhost/127.0.0.1 web port 3000 with credential-mode requests;
   no auth cookies are issued or production policy inferred.
   All mutations deliberately fail 503. Terminate both services after the run.
6. `workflow.spec.ts` instead requires the existing disposable mock, GPU-capable
   infrastructure and `PHASE10_DISPOSABLE_MOCK_RUNNER=1`. Never combine that flag
   with this read-only fixture server. It creates one synthetic session, sends
   edits and approves a mock render. This requires explicit mutation authority.
   Renderer unavailability fails its GPU prerequisite; it is not hidden as success.

## Authorized runner commands (NOT executed here)

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm e2e --project=chrome
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm shots --project=chrome
# Only on the reviewed, authorized capture runner, after inspecting every result:
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm shots --project=chrome --update-snapshots=all
```

Chrome uses installed `chrome`; Edge uses installed `msedge`. Firefox is
Playwright Firefox. WebKit is explicitly a surrogate, **not Safari 18+**. Record
actual product/version/OS, runner/device, source commit, fixture hashes, font
versions, viewport, mode and artifact provenance for each run. Safari 18+ needs
actual Apple Safari infrastructure and manual/native automation receipts; do not
rename WebKit results to Safari.

`updateSnapshots: 'none'` prevents accidental baseline creation during normal
checks. Real `toHaveScreenshot` assertions resolve into
`e2e/baselines/<project>/<test-file>/<state>-<viewport>-<mode>.png`.
There are **no Phase 10 baseline files** in this handoff. Missing expected images
must fail. Capture/review each browser separately; never copy a Chrome baseline
to Edge/Firefox/WebKit or turn existing historical screenshots into baselines.
No masks, hidden overlays, axe exclusions or fake image files are introduced.

## Exact authored coverage and known gaps

- `state-matrix.ts`: tokens, UI gallery built-in hover/focus/pressed/disabled/
  loading/error variants; opened menu/dialog; landing empty/hover/keyboard focus/
  mouse-down/long text/upload rejection/presign failure/session failure/loading; privacy/not-found;
  warmup loading/error/drop/cancel; Studio empty/default/long/drop/restore failure/
  review; render queued/running/failed/expired/unavailable/cancel dialog/unknown cancellation; delivery
  default/long/expired download/expired record/missing record.
- `keyboard.spec.ts`: settings Escape/focus restore, dialog trap/Escape, Studio
  title typing guard. Existing landing/warmup/Studio geometry suites remain.
- `zoom.spec.ts`: half-CSS-viewport reflow proxy for each size and route. This is
  **not native 200% browser zoom**. Native zoom, text-only resizing, focus-ring
  visibility and optical Play centering still require manual evidence.
- `workflow.spec.ts`: one mock happy path and user-request message, title change,
  review, render, actual download event. It does not prove the message was sent
  mid-agent-action, exact interrupt ACK ordering, rendered text pixels, mixed-file
  uploads, SAM/web search, audio or production output fidelity.
- Upload failures, warmup socket drop, render failure and expired record states
  are authored. Mid-edit socket drop is a static restore/drop fixture, **not**
  durable queued edit recovery. Do not count it as ordered IndexedDB flush proof.
- Anonymous limit/auth are **BLOCKED** on agreed backend contracts; no guessed
  quota error/dialog is called acceptance. Unknown op ACK, multi-tab lease,
  real reload history, captions editor keyboard, 50-clip timeline keyboard,
  permission-denied clipboard/share, real HEVC fallback, GPU texture upload,
  `requestVideoFrameCallback`, View Transitions fallback and 20-minute memory
  remain required manual/runner scenarios in `docs/STATES.md` and `docs/A11Y.md`.
- The state grid is not a claim of exhaustive baseline coverage. Timeline,
  inspector, nine conversation messages, extras and every underlying control's
  focused/pressed/loading/offline combinations still need dedicated fixtures.
  These cells stay required/blocked in the inventory rather than all ticked.
- Axe attaches full results and incomplete checks; zero violations would still
  not establish WCAG conformance or a VoiceOver/NVDA pass. The cream-38 privacy
  conflict is deliberately not excluded. Review incomplete checks separately.
- Fixture paths reflect inspected source. Active parent changes can alter labels,
  auto-onboarding or dialog behavior; a future failed assertion requires inspection,
  not automatic snapshot update or broad selector weakening.

Do not run `pnpm shots` as part of a formatting/typecheck gate. Existing compositor
screenshots also remain authored only and need genuine GPU initialization before
capture. See `docs/A11Y.md` for the complete browser/device/manual matrix.

`failures.spec.ts` also authors a browser-intercepted 503 presign failure using the
existing grain PNG, preserving the prompt and requiring a visible alert. That
assertion may expose the inspected landing chip's lack of a distinct network-error
surface; it is a required behavior, NOT a recorded pass. The render-cancel-unknown
case aborts the cancel request and observes unchanged REST authority before
requiring status reconciliation. Neither case modifies a backend record.
