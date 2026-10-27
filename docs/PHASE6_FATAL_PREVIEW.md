# Phase 6 fatal preview and font recovery

## Contract

The default Studio compositor owns a shared `previewStatus`: `initializing`, `ready`, `unavailable`, or `error`. `legacy` is an explicit compatibility mode for the empty Phase 5 viewer and custom viewer slots, not proof of an initialized renderer. A same-session snapshot refresh preserves the compositor's current status; changing sessions resets transport state. The mounted compositor marks `ready` only after its existing controller initialization resolves. Disposal guards prevent an abandoned initialization promise from publishing readiness.

A failed initialization is fatal to preview, not an approximation. It hides the inactive canvas surface with `hidden`, removes the rendered-frame attribute, stops preparing, and exposes an accessible alert with a full-width scrollable fallback. The fallback uses the host geometry rather than the fixed project/zoom canvas dimensions, including fullscreen. It is not a synthetic image or CPU rendering fallback.

`requestPlayback` gates Play, fullscreen Play, and the global Space/J/K/L shortcuts. Non-ready states stop playing and shuttle intent and reject stale playback clock publications. The bridge also gates playback/audio-scrub transport while retaining seek position intent. Manual seek, timeline editing, session review, and fullscreen close are not globally disabled. Ordinary approximation issues are displayed only after successful initialization.

## Diagnostics

`previewFailure` selects exception name/message strings, traverses aggregate errors and `cause`, and bounds lines (10), depth (4), child counts (10), and each string (400 characters). It omits stacks and arbitrary object fields, redacts URL and common credential patterns, and removes control characters. The text is rendered as React text, not HTML. Diagnostic messages must never intentionally contain credentials.

Both original Pixi initialization exceptions remain in the aggregate. A third diagnostic reports secure-context status, a bounded (500 ms) read-only WebGPU `requestAdapter` result, and whether the WebGL2 API is exposed. A rejected probe retains its exception cause for the same bounded/redacted display. The helper never requests a GPU device, creates a GL context, changes launch flags, or substitutes CPU pixels. API exposure is explicitly **not** GL-context availability; a non-null adapter is **not** device creation or renderer success. The original initialization causes remain authoritative.

The observed managed-browser environment rejected both Pixi support selections before backend construction. This is not evidence of a source shader compilation defect. A GPU-capable environment remains an external dependency for actual renderer/frame acceptance.

## Fonts and gateway

The observed `/__nextjs_font/geist-latin.woff2` belongs to the installed Next 15 development overlay middleware, not to the application's `geist/font` local-font module. A focused test invokes the installed upstream middleware through a local test-only frontend and gateway, verifies HTTP 200, `font/woff2`, and real `wOF2` bytes. The gateway admits **only that exact** development-overlay font, not its namespace or other private development endpoints. Arbitrary fonts, extra suffixes, encoded traversal, and unlisted devtools paths stay denied.

The app now explicitly bundles unmodified `geist@1.8.2` variable WOFF2 files at two exact public paths, with `Geist` and `Geist Mono` CSS family aliases matching compositor Canvas text styles. See `apps/web/public/fonts/GEIST-SOURCE.md` for source paths and the copied package SIL OFL 1.1 license. There is no external font service or runtime dependency.

## Verification boundary

Focused RTL/state/renderer/gateway tests exercise these contracts with mocked controller/Pixi initialization and local test-only HTTP fixtures. They do not establish real GPU initialization, shader execution, visible pixels, mobile rendered geometry, frame rate, A/V sync, or all-feature acceptance. No new browser, live CI dispatch, build, global four-gate run, commit, or push is part of this fix. Parent review, consolidated gates/publication, and later GPU-capable browser validation remain separate.

## Timeline resizer hydration

The timeline resizer initializes its height bound from the same constant (1080) on the server and first client render. Only an effect reads the actual window height and subscribes to resize, with listener cleanup on unmount. Thus the observed server `aria-valuemax=648` does not mismatch the client's first render at a 720px viewport; after hydration the effect updates it to 432. Pointer/keyboard resize handlers still use the current viewport for actual resizing. A server-markup/hydrateRoot test checks identical initial markup, no recoverable hydration or console errors, and subsequent resize updates. This is a unit hydration check, not a new live-browser validation.
