# Phase 7 inspector

Source-only consumer of the frozen `EditingAPI`. Import `InspectorEditor` and `InspectorEditorProps` from this directory. It owns no socket, store/context, media object, AudioContext, HTTP client, upload manager, or transaction/history engine. All projection/history/network work remains in the injected editing session.

## Parent wiring

Required: `project`, `assets`, `editing`, subscribed `editState`, selected clip IDs, and the existing timeline `playhead`. Use the same project projection that feeds the existing compositor. Never instantiate a second session for this panel. Parent owns follow-kimo and must not add another toggle here.

Optional callbacks/resources have explicit availability boundaries:

- `onMaskOpen(open)` drives the parent's existing mask-section-open state. Selection changes and unmount close the previous section. The callback is only a visibility signal, not a SAM action.
- `onMessage(text, clipId)` is the sole path for `run sam`. Exact payload: `use sam 3.1 to select "{description}" on {actual clip label}`. Asset name, actual text or real clip ID supplies the label; no arbitrary source/subject identity is invented. No Phase 8 sender is implemented here.
- `maskPreview` must contain a real composed subject-cutout URL and actual optional subject label for that clip. A mask alpha map is not a cutout. Missing preview stays explicit. Checker cells are exactly 8px via a 16px SVG pattern using ink-2/ink-3.
- `compare` is discriminated by `available`. Available includes parent-owned `enabled` and `onChange(enabled, clipId)`. Missing/unavailable is disabled with a reason. Parent must implement the real split-wipe renderer, not substitute images.
- `levelMeter` is discriminated by `available`. Available exposes `measure(clipId)` returning actual existing output linear peak amplitudes in `channels` plus `playing`, and `subscribe(listener)` returning unsubscribe. Parent must publish when output becomes stopped/silent. The panel never derives levels from clip gain, waveform or an invented oscillator. Output peak rather than RMS is the documented default. No hold/ballistics are invented. Invalid samples are ignored, stopped output is zero bars; warning strictly above -6dB, error at/above 0dB. Geometry is 120x24.
- `lutAssets` maps exact names `warm film`, `teal & orange`, `bleach`, `mono` to actual asset IDs registered in `assets` with LUT metadata. No external URLs, placeholder look IDs or identity aliases are manufactured. Missing entries are disabled; current unsupported LUT can always be cleared to `none`, including LUT params embedded in a grade while retaining grade parameters.
- `onReplace(clipId, 'search' | 'upload')` invokes parent search/upload flows. The panel does not create a new upload manager or new session. Source metadata/attribution is the actual asset; links accept http(s) only and use noopener/noreferrer.
- `onReframeRequest({width,height})` is a request seam, not proof of completed engine reframing. Aspect confirmation commits one real `project.update` group, then invokes the callback. Cancel sends no ops. Dimensions are not represented as a clip op. UI retains an explicit reframing-pending message. The engine reframe protocol is unspecified and must be integrated/verified by parent.
- `onSeek` and `captionTrackId` are the explicit caption-editor bridge inputs. Parent classifies caption tracks, not this inspector.
- `propertyActivity` contains actual running action IDs, clip IDs and exact property paths (`transform.x`, `effects.<id>.exposure`, `mask.feather`, etc.). First running selected property owns orange within this inspector. Ended actions never acquire orange. Numeric values use dur-2 underline/tween, with reduced motion; keyframes share their field's state. Content-colour swatches are video content, not decorative orange.

## Interaction policy and spec choices

The exact section order is Transform, Crop, Speed, Text, Colour, Effects, Mask, Audio, Transitions, Source, Project. Text appears for text payloads, Audio for video/audio, Source for image clips; Project is shown with no existing clip selected. No follow toggle or duplicate chrome.

Numeric labels scrub horizontally at 8px per field step, shift 10x. Inputs type finite values, arrows +/-1, shift +/-10. Changes preview from the BEGIN baseline, rAF-coalesced during pointer scrubs. Pointer release, Enter or blur commits once. Escape, pointercancel, capture loss and unmount cancel. Resets use canonical transform/grade/text-style defaults rather than a mount-time snapshot. Changes to existing transform animations edit evaluated scalar keys at the stable `playhead - start + animationOffsetSec` clock; diamond keys canonicalize to project frames and remove legacy transform aliases. The pure existing compositor interpolation function is imported directly, not the GPU-heavy compositor barrel.

The spec does not define multi-selection layout. Safe chosen policy: expose shared absolute Transform edits for all selected clips atomically, explain it visibly, and require one selection for specialized sections. Any locked clip or locked track guards the whole selection; core validation is still authoritative. Crop aspect lock is local selection-scoped state and preserves retained width/height ratio, hence actual source aspect, while preventing opposing edge sums from reaching one. It is not a new persistent crop field.

Speed is bounded 0.1..4 and delegates source-span-preserving duration math to the existing pure core helper. `keepPitch`, linear volume, audio fades/duck, text fields, project background/notes and effect.enabled are actual schema proposals, not local toggles. Renderer/audio/backend consumption is parent-owned and not proved by the UI wiring or this test suite. In particular WebAudio pitch preservation and music duck behavior must be verified on the audible path.

Transitions update both declarations of an actual adjacent cut. Stored seconds and durationFrames always agree at the actual project fps. Locked adjacent clips reject the edit instead of silently writing contradictory declarations. Direction controls are available for slide and whip.

Collapse persistence is local-only, optionally injected storage or guarded browser localStorage: `kimo:inspector:v1:<projectId>:<Section>`. Storage denial does not block editing or imply backend persistence. Section Row/Section/Input/Slider/Segmented/Toggle/Dialog/Button primitives reuse Phase 1; local CSS consumes DESIGN tokens. New spec geometry is named in the local CSS module; parent can hoist those variables later. No shared CSS is edited. RGB wheel HSV geometry is computed, not a CSS gradient, and numeric RGB fields provide the full keyboard equivalent.

Feather UI range 0..256 is a proposed control bound only. Engine units are unknown and explicitly stated in UI. Zoom-punch display ranges amount 0..16 and attack/release 0..3600 seconds are UI bounds, not verified production-engine constraints.

## Evidence

Focused checks only. No global lint/typecheck/test/build, browser, GPU, server, engine or push operations by this writer. Test logs and final integration gaps are in `.openclaw/tmp/kimo-phase7-inspector-result.md` outside the repository. Phase 6 GPU environment remains blocked before construction/shaders, not visually accepted. jsdom tests prove state/contract/UI event behavior only, not rendered pixel acceptance, live audio fidelity or backend agreements.

Additional renderer handoff: `resolveText` was observed to check centered style placement before the `top` position override in its anchor.y branch. Parent must fix/verify top positioning on centered title/quote styles. Inspector reports their actual unset default as middle. The actual shared `effectParameterBounds` client export now owns known filter ranges. Blur radius/x aliases are effective, while legacy strength/y fields are preserved with a visible unsupported-preview explanation because the current shader does not consume them. Radius updates synchronize a stored x alias so it cannot hide the user's change.

Unspecified numeric safety choices: transform x/y use +/-1,000,000 content px, scale uses 0.01..100,000%, rotation +/-36,000 degrees, text size 1..4096 content px, crop opposite sums remain below 1. These are explicitly UI bounds, not newly claimed backend/renderer constraints. Video-content picker colours are exact prescribed normalized RGBA values. Selecting a text style preserves content, secondary content, words and explicit custom overrides; resetting font size uses the newly selected canonical style's default.

## Actual text bridge

`TextContentFields` imports the actual writer-owned `InspectorTextField` and `InspectorTextFieldProps` directly from text-editing. Content plus lower-third/actual secondary content share that writer's existing edit model. No inspector-owned content debounce/IME/suggestion engine exists. An explicit `captionTrackId` switches to the actual `CaptionsEditor` dedicated mode. `onSeek` is mandatory for that mode; missing callback or missing/non-text track is explicit, never a fake seek. Parent can leave captionTrackId unset for the normal single-clip style inspector.

AI numeric readouts also use a real UI-only Motion numeric tween with existing `durations.d2` and `easings.out`, not only a colour transition. It is interrupted by direct user input, respects reduced motion, and never edits project state or creates another preview/transport clock. Meter segments retain cream below -6dB, warning only above -6dB and error at/above 0dB, based on actual measured peaks rather than guessed clip gain.

## Real audio capability handshake

Optional `audioCapabilities(clipId): {keepPitch:boolean;reason?:string}` gates the keep-pitch switch. A supplied unsupported result disables it and shows the actual reason (or an explicit unavailable fallback). Missing provider preserves isolated consumer behavior; parent must always provide actual readiness/capability. Stored keepPitch does not prove pitch-preserving audio. Buffered audio cannot preserve pitch merely because the field is true.

The meter is visibly and accessibly labelled **master output**, matching the actual controller hook. Its retained `measure(clipId)` adapter signature does not imply isolated per-clip measurement; parent supplies existing master samples and existing playback/tick subscription. No extra sampling loop, context, fake level, or compare renderer is added here.
