# Phase 7 timeline source checkpoint

`TimelineEditor` is exported from this directory's `index.ts`. All public props are in `types.ts`. This is the bounded Phase 7 timeline/assets writer only, not Studio integration or visual acceptance.

## Ownership and wiring

- Pass the current displayed `project`, actual `assets`, session `editing: EditingAPI`, subscribed `editState`, controlled selection, transport playhead/scrub callbacks, tool, snapping and linked state. No store, socket, transport clock, decoder, audio context, client or upload provider is created here.
- `zoom` is **actual pixels per second** from 4 to 600; `null` means fit. It is not Studio's old multiplier. Fit excludes the 160px header and divides duration by 1.1. `onZoomChange` can be omitted to make zoom controls unavailable.
- This component owns **one ruler**, sticky track headers, canvas rows, the drawer toggle and footer. Remove the old placeholder ruler and footer when placing it into the parent's slot. Do not wrap it in another ruler. Give the slot a bounded height with `min-height: 0`.
- `onSeek`, `onScrubStart`, `onScrub`, `onScrubEnd` go to the existing scrub intent lifecycle. The playhead and ruler end scrubbing on lost capture, cancellation or unmount. No second playback clock exists. `onTogglePlayback` is the Space shortcut seam.
- Root keyboard handlers are deliberately scoped to the focused editor. They do not register global shortcuts or replace `lib/keyboard.ts`. Input, textarea, select, contenteditable, IME composition and native control activation retain their own behavior. Focused trim handles use source-aware frame increments. Roving clip proxies use arrows to move focus and reveal offscreen clips; Enter uses native selection activation.
- `onInspect(id, 'speed')` opens the real inspector; `onReplace(id)` delegates the existing replacement pipeline. `onMessage` is **prefill only**, receiving exact `@clip_name ` including the trailing space. It is not a Phase 8 send endpoint.
- The optional `InlineTextEditor` is a structural adapter for the text owner's actual timeline text editor: `{clip, editing, onClose}`. It mounts inside the clip geometry with pointer events enabled and native caret protection. Without an adapter, double-click delegates to `onOpenText(id)`. New text is optimistically added as a 3-second `caption-clean` clip containing `your text`, selected, then opened. There is no duplicate text transaction service here. The text owner's module was not present at this checkpoint; the parent can supply the adapter without changing timeline internals.

## Drawing and media bounds

One canvas is mounted per visible track row, with vertical viewport plus one viewport margin. Horizontal clip filtering uses the viewport plus one viewport on either side. Each row backing store is at most three viewport widths and DPR is capped at 2, never duration times zoom. DOM clip bodies are not created: nonvisual roving proxies remain for keyboard access, while pointer/selected/focused clips get label/handle overlays. Canvas label drawing is suppressed beneath those overlays to avoid duplicate text. Inline editing suppresses the canvas text content for that clip.

Display order is the actual core `displayTracks` helper, without mutating compositor track order. Heights are text 48, overlay/audio 64, video 88. Canvas colors and fonts come from computed CSS variables. Gaps are diagonal canvas strokes, not a CSS gradient. Hover derives exact +4 percentage points of HSL lightness from the resolved track tint. Transitions use actual in/out declarations, with incoming precedence at the same cut. Marker labels/times come from project metadata; `markerOrigins` optionally supplies real author provenance, never guessed from label text.

`mediaHandle` is the existing compositor's structural `getFilmstrip` / `getWaveform` API. Return a new handle identity when readiness changes or the underlying source registry is replaced. Requests are abortable, at most two concurrent, at most 48 retained/queued entries, at most 1280 requested pixels/points per clip, and up to 16 filmstrip samples per request through the existing compositor's width sampling. Visible-center requests are prioritized. Entries beyond the budget remain unsampled rather than evicting other visible work forever. Stale keys are pruned before loading. Media failure leaves tint/label with no fake imagery or squiggles. Frames use their returned source timestamps, and waveform samples are the compositor's already source-in/speed/duration-windowed values. Only timeline-owned object URLs/images are revoked; no borrowed compositor bitmap is closed.

## Edits and authoritative motion

Core command helpers are imported from actual `lib/editing/commands`, not reimplemented. A pointer gesture captures one immutable baseline, takes pointer capture, allocates duplicate IDs once, coalesces local previews with rAF and commits the latest complete op batch once on release. There is no network call per pointer movement. Escape, pointercancel, lost capture and unmount cancel the draft. The foundation owns soft-lock queues, immediate incoming removal, per-author history, server reconciliation and notifications.

Move respects same-kind track boundaries and preserves mixed linked-track placement; trim/ripple/slip use source seconds and core bounds. Snap tolerance is 8 screen pixels converted to seconds, excludes moving selection edges, considers start and end and resolves ties deterministically. Delete uses core V1 union ripple behavior, with Shift-delete lift. Context menu order and quoted copy match 7.2. Asset tiles use the actual metadata and call the injected upload manager callback or add a typed clip on a compatible unlocked track. Unknown video/audio duration is rejected rather than invented. Image insertion defaults to three seconds as a local ordinary choice, not a stored preference.

For live AI animation, pass `agentChange: {id, ops}` from real authoritative metadata. `id` must change when a queued authoritative batch becomes visible after release as well as on an immediate batch. It must not identify user previews as agent work. Creates grow from zero; moves use the canonical `spring.snappy` stiffness/damping/mass from `lib/motion`; removals retain only render tombstones for `--dur-3`, never stale project entities. Reduced motion uses opacity-only `--dur-2` fades with fixed geometry. `activeClipId` selects one orange AI treatment with spinner, wash and a 600ms end fade. To honor the one-orange-per-panel rule, the normally orange structural playhead becomes cream while that AI treatment/fade owns orange. Marker origin and agent motion are optional rather than fabricated when the parent has not supplied provenance.

## Local semantic tokens and named numeric exceptions

All styling inherits existing ink/cream/orange/track/type/radius/focus/motion tokens. Scoped Phase 7 tokens encode explicitly specified exceptions: header 160px, ruler 28px, label 18px, handle 8px, playhead 1.5px, triangle 7px, drawer 240px, asset image height 54px, inner highlight cream at 5%, gap hatch cream at 3%, follow glide 240ms and AI end fade 600ms. Delete aliases `--dur-3`; no new easing or font exists.

Pure geometry/canvas code necessarily uses numeric coordinates corresponding to the spec rather than CSS `var()` strings: row heights, 8px snap/edge zones, 80px tick spacing/thumbnail sampling, 6px hatch spacing, 1px hatch/highlight, 1.5px selection, 18px label offset, 60% filmstrip alpha, 20px chips, 14/12/10px spec icons, and 4-point HSL hover lightness. These are named exceptions, not a second design system. Spring integration's timestep/substeps and media/cache/DPR caps are resource/physics bounds, not UI timings or invented visual tokens. Fallback fade/delete numbers only serve absent CSS environments such as source tests; rendered components resolve the semantic CSS duration first.

## Verification and open acceptance

Focused commands from the repository root:

```sh
NODE_ENV=test ./node_modules/.bin/vitest run apps/web/src/components/studio/timeline
./node_modules/.bin/eslint apps/web/src/components/studio/timeline --max-warnings 0
./node_modules/.bin/prettier --check apps/web/src/components/studio/timeline
./node_modules/.bin/tsc --project /var/lib/openclaw/state/workspace/.openclaw/tmp/kimo-timeline-tsconfig.json --noEmit
```

The scratch tsconfig extends the actual repository tsconfig and limits roots to this directory plus the existing Next/jest-dom ambient declarations. No manifest or global test configuration was changed. The mechanical design detector returned an empty findings array for this directory. No browser, service, local Playwright, global build or push ran.

Tests mock canvas calls and cover geometry/hits, source clocks/ripple union/source bounds, snapping, selection, virtual canvas allocation, bounded media/abort/URL disposal, gesture coalescing/commit-once/cancel, actual UI pointer move/ripple/slip/duplicate, caret protection, roving focus, inline injection, context ordering/prefill, upload/attribution, frame ticks, locks, scrub cleanup and agent tombstones/reduced motion. They do **not** prove hardware pixels, font alignment, accessibility with a real assistive technology, 60fps on the 50-clip fixture, real upload-to-session association, real server conflict enforcement or full Shell integration.

Parent-owned remaining acceptance: remove placeholder chrome; connect subscribed projection/selection/transport and optional media readiness; supply authoritative agent/marker metadata and the real text adapter; route uploads through existing registration and refresh asset registry; reconcile global keyboard integration; run permitted integration and managed-browser/performance acceptance later. Phase 6 GPU validation remains environment-blocked before RendererClass/shaders, **not passed**. This checkpoint does not claim Phase 7 or later phases visually accepted.
