# Phase 6 media runtime API

These modules implement the DOM/WebAudio/cache boundary. They import no app aliases and depend on no new runtime libraries. Their structural inputs accept the legacy timing fields plus optional `audioRole`, `track.solo` and `animationOffsetSec`; they do not depend on an anticipated client schema export. The parent owns controller, renderer, barrel exports and Studio/cache integration.

## Ownership and initialization

One `MediaPool`, one `AudioEngine`, one `TimelineClock` and one `FilmstripService` per mounted preview. Constructors are lazy with respect to browser resources. Inject `createVideo`, fetch, bitmap creation and timers into the pool; an AudioContext/context factory into audio; monotonic and audio time into the clock; cache, capture, encoder and audio decode into filmstrips for deterministic tests. These injections are operation boundaries, not replacement synthetic frame success paths.

Dispose in this order: filmstrip service, audio engine, renderer, media pool. Renderer destruction must finish using textures before the pool closes their bitmaps. Injected AudioContexts are not closed by the engine; contexts created by its factory are owned and closed. Returned bitmaps are owned by the pool, not by the renderer.

## MediaPool

```ts
const pool = new MediaPool({ maxDecoders: 6 });
pool.adoptWarmup(videoCache); // ownership moves, map is cleared
const result = await pool.sync(requests, {
  time,
  playing,
  rate: transportRate,
  fps: project.fps,
  fast: scrubbing,
});
```

A `VideoRequest` is `{clipId, asset, start, duration, in, speed, purpose?, sourceTiming?}`. `sourceTiming` is an explicit encoded-media clock `{timelineTime, mediaTime, rate}`: target is `mediaTime + (time-timelineTime)*rate`, and effective element speed is `rate*transportRate`. For mask video, subtract the metadata time origin once in mediaTime; do not apply clip-relative timing again. Use rate 0 for a frozen source-boundary sample. A mask without this descriptor remains a reported legacy/degraded path, even if a callback timestamp matches its guessed target. `purpose` is `video` or `mask`. Use a distinct instance key such as `${clipId}:mask` for a mask, even when it references the same asset as another instance. Source time is `in + max(0, time-start)*speed`. Visible instances precede future instances; playback pre-roll extends 1.5 timeline seconds. At most six physical video elements exist, including idle reusable elements, masks, extraction and adopted warmups. Extraction yields to preview. Excess simultaneous clips produce an issue instead of allocating a seventh decoder.

Proxy URL is preferred. CORS is set before assigning every video URL, including original fallback. A failed proxy seek/load retries the original once for that slot/source identity, retaining the fallback on later sync calls. Different clip instances never share a playing element. Positive playback uses `(sourceTiming.rate ?? clip.speed) * transportRate`; `preservesPitch=false` matches buffer playback-rate pitch behavior. Masks stay muted. Only AudioEngine unmutes content after graph connection.

`adoptWarmup(map)` consumes old prefetch elements and unloads excess incoming elements. Incoming warmup CORS is repaired by reloading after setting it. Stop the old independent prefetch path while Studio owns the pool: the pool cannot count elements a separate caller creates and never adopts.

### Exact seeks and retained preview

`seek(clipId, sourceTime, {fps=30, fast=false, signal?})` returns `Promise<MediaFrame>`. A frame is `{element, sourceTime, exact, reason?}`. rVFC is registered **before** assigning `currentTime`; metadata must match within half a project frame. Existing matching, verified, decoded frames can be reused. Stale revisions, aborts, releases, preemption and disposal cannot publish a newer result. Each seek pauses the element before assigning the target; positive playback resumes after readiness. Normal playback observes presented timestamps and avoids repeated seeks while within a 100ms resynchronization threshold; timestamps outside the half-frame target window are reported as approximate, not as exact.

`fast=true` uses `fastSeek` when present and always marks the result degraded. During drag pass `fast:true` directly to `sync`; do not perform an exact sync and then a second fast seek. On release pass `fast:false` to get exact acceptance. The controller owns one-rAF coalescing and the latest transport revision.

When rVFC is absent or does not deliver while paused, `seeked`/timeout can resolve **degraded** only if there is decoded media at the target. An unresolved or failed seek does not produce a black placeholder. The controller must keep its last submitted framebuffer/texture set until the entire required resource set is coherent. A video element is mutable; retaining a reference to it alone does not freeze old pixels. Rejected and superseded operations must never clear the last good framebuffer. Lack of exact timestamp evidence must remain visible as an approximation.

Half-project-frame acceptance is not half-source-frame certification for VFR or unknown source fps. No browser presentation, A/V sync or hardware performance is certified by the unit tests.

### Extraction leases

`acquireExtraction(id, asset)` returns `null` at capacity or `{element, isCurrent(), seek(time, options?), release()}`. A lease can be preempted at any time by visible/pre-roll work; `isCurrent()` and its seek epoch prevent stale work from using a reassigned element. Release is idempotent and cannot release a replacement lease. The service checks ownership before and after bitmap capture/encoding. Extraction also retries original on proxy failure, with an explicit reason.

### Images

`loadImage(asset)` eagerly fetches CORS media and creates/deduplicates a cached ImageBitmap. It is a **borrowed** cache value; unleased values can be evicted. Renderers should use:

```ts
const lease = await pool.acquireImage(asset);
// prepare a texture from lease.bitmap; do not close the bitmap
// release when this renderer resource is no longer needed
lease.release();
```

Image leases reference-count the source bitmap. Default cache capacity is 32 entries, configurable up to 128. All-pinned capacity rejects new allocation instead of closing an in-use bitmap or growing indefinitely. Different source URLs/revisions have separate entries so an old leased source remains valid while a replacement loads. Eviction/disposal abort fetches and close bitmaps. Late bitmap completion after disposal is closed and rejected. First-visible web-image 120ms fade belongs to parent presentation state, not this cache.

## TimelineClock

`new TimelineClock({now?, audioTime?, duration?})` accepts monotonic milliseconds and a callback returning running, audible AudioContext seconds or null. It owns no rAF loop. `currentTime`, `playing`, `rate` and `loopRevision` are getters.

Commands: `play`, `pause`, `seek(seconds)`, `setRate(0.5..2)`, `setAudioActive(boolean)`, `setDuration(seconds)`, `setLoop(enabled, I|null, O|null)`. Clock-domain changes preserve elapsed wall time rather than adopting an unrelated absolute audio epoch. Play, pause, seek, rate and loop changes re-anchor. Project end clamps and stops. A valid loop is `[I,O)` with `0 <= I < O <= duration`. Both absent means whole project; one absent is invalid. Overflow uses modulo and re-anchors; seeking outside an enabled loop moves to I. `loopRevision` increments at each observed crossing, including a clock-domain-switch tick.

Pass `audioTime: () => engine.audioTime()` and enable the audio domain when appropriate. A null return automatically selects performance time. Pass `epoch: clock.loopRevision` into `AudioEngine.sync` so even sub-frame loop regions restart one-shot buffer sources. Negative J shuttle is not an HTMLVideo playback rate: parent may step timeline time backwards and call pool sync with negative rate for silent, explicitly degraded exact-seek preview. The clock itself accepts only the positive 0.5..2 transport range.

## AudioEngine

```ts
const audio = new AudioEngine({ onIssue });
await audio.resume(); // invoke in a user gesture; false means activation denied
await audio.loadBuffer(audioAsset);
audio.sync(
  clips,
  tracks,
  time,
  {
    playing,
    rate,
    master,
    epoch: clock.loopRevision,
  },
  elementsByClipId,
);
```

`loadBuffer` uses real fetch + `decodeAudioData`, proxy first with original fallback and explicit issue reporting. Pending requests deduplicate by asset/source identity; at most four loads/decodes are pending, including superseded native decodes that cannot be cancelled. Fetches abort on replacement/disposal; late decode results cannot repopulate a disposed/replaced entry. `setBuffer(assetId, buffer)` injects an actually decoded buffer. Default buffer cache holds 32 entries. Replacing a buffer increments its identity so playing one-shot sources restart on the next sync.

**Single audio authority:** pass raw MediaClip[] + tracks + transport master to AudioEngine.sync. Do not feed `scene.audio.gain` or `scene.audio.duckGain` into this path: those are already-resolved scene metadata including master/gates/duck. The raw path applies each exactly once. Current controller was inspected read-only and already uses raw clips + master.

Graph: source -> per-clip gain -> music duck gain -> master -> destination. Buffers schedule at the correct future context time with source offset `in + (timeline-start)*speed`; source playback rate is `clip.speed * transportRate`, duration is bounded by clip trim and available samples. Only a 1.5s future scheduling horizon is considered. Pause, seek, source edits, rate changes and loop epochs stop/disconnect old one-shot sources and schedule replacements. Ordinary ticks do not recreate sources.

Video audio uses a persistent WeakMap keyed by AudioContext and physical element. Exactly one MediaElementAudioSourceNode is created for that pair, even after pause, clip reuse or engine disposal. Reconnecting a reused source never calls createMediaElementSource a second time. The audio engine must be the sole routing owner for those elements/context. Video native playback stays muted until routed; removed/paused sources mute it again. Browser CORS silence, absent audio tracks and actual speaker output still require real source/browser checks; creating a node is not evidence of audible output.

Volume is linear gain, default 1. Volume keys override the base gain. `volumeAt` calls the actual core `interpolateKeyframes` export after normalizing legacy structural keys, including the `transform.volume` alias. Duplicate times use the last input key; hold, linear, ease_out, ease_in_out and bezier exactly share the core formula and departing-key semantics. `animationOffsetSec` preserves split animation timing. Future automation uses native linear/hold AudioParam operations or 129 bounded samples of the shared nonlinear formula via setValueCurveAtTime. Curve sampling between points is a WebAudio approximation, not a claim of continuous symbolic equality. Automation is rebuilt from the exact current scalar over a 1.5-second lookahead; clearing all owned events also cancels already-running curves before replacement. Muted wins; if any unmuted track is solo, non-solo tracks are gated. Hidden is visual-only. Explicit voice clips trigger music gain `10^(-12/20)` with continuous 300ms linear attack and release, including interrupted ramps. Roles are never inferred from names. Master is independent.

`audioTime()` returns currentTime only when routed clips are active, master is nonzero and context is running. Suspended/denied resume is reported and does not masquerade as playback. `pause()` cleans sources/blips; `dispose()` cleans all owned nodes, fetches and cached buffer references.

`scrub(clips, tracks, time, enabled=true)` plays buffer-based 60ms blips at source in/speed, cancels prior auditions and returns whether it played anything. It does not auto-resume a suspended context. **Video scrub audio requires an actually decoded/injected AudioBuffer**: it is not automatically extracted by seeking the media element. Without that real buffer the engine reports it unavailable, rather than fabricating a sample-accurate audition. Negative transport is silent. Audio-buffer speed changes pitch; video sets preservesPitch=false for parity, not server-fidelity certification.

## FilmstripService and cache adapter

`new FilmstripService({pool, cache?, capture?, encode?, decodeAudio?, fetch?, onIssue?, maxEntries?, maxFrames?})` exposes `getFilmstrip(clip, widthPx, signal?)`, `getWaveform(clip, points, signal?)` and `dispose()`. The clip is a structural MediaClip plus its resolved asset. Parent implements public compositor `getFilmstrip(clipId,widthPx)` by resolving the clip/asset then calling this service.

A filmstrip frame is `{time, blob, exact?, reason?}`, where `time` is the actual **source** timestamp, never a fabricated requested time. Sample centers use `clip.in + (i+0.5)/count * clip.duration * clip.speed`. Count is ceil(width/80), default capped at 64 (hard ceiling 128). Frame output is JPEG at height 45, source aspect preserved. Extraction is sequential within a job, shares the six-video pool, and checks preemption/abort at asynchronous boundaries. At most six extraction jobs and six worker encode requests are admitted; excess work is explicitly deferred.

The injected cache reads/writes `{frames?, waveform?, timelinePeaks?}` using a key containing format version, asset ID, selected URL and source duration. The app adapter inverts its persisted localId -> assetId map; the package imports no app store or IndexedDB module. `legacyTimestampedFrames(Blob[], sourceDuration)` assigns inferred whole-source bin midpoint times and marks them degraded. A legacy timestamp is not exact extraction evidence. Nearest cached samples are usable within known bin coverage and retain their actual timestamps plus an approximation reason. Missing timestamps/duration/mapping are not invented cache hits.

CORS/tainted pixel errors fall back only to **real cached samples** with explicit degradation. With no real cache the failure propagates, allowing the caller to retain its old filmstrip. Quota/read/write failures are reported through `onIssue`; real generated results can still be used in memory. The adapter must reject on storage errors if reporting is required. The old app write helper swallows errors, so wrapping that helper cannot establish persistence success. A swallowed error is not proof of a durable cache hit.

Waveforms consume existing source-time `timelinePeaks` at 10ms bins and the 64-bin summary convention. If absent, actual injected/default decoded audio samples generate channel-maximum amplitude bins. Source in, trim and speed map bins into the requested display points, capped at 10,000; at most two waveform jobs run concurrently. Failed decode is not replaced with silent/synthetic peaks. Native sample processing preserves 10ms maxima without claiming an 8kHz resampled signal.

### Literal worker decoder boundary

HTMLVideoElement decode and seek run on the main thread because workers cannot create HTMLVideoElement. An ImageBitmap is transferred to `filmstrip.worker.ts`, which uses OffscreenCanvas for resize/JPEG and closes the transfer in success/error paths. This worker **does not demux or decode MP4**. No allowed demux library is installed; no full in-worker decode claim is made. Worker error/timeout/disposal rejects real operations, terminates stuck work and does not invent images. When Worker/OffscreenCanvas are absent, the explicitly reported fallback resizes/encodes on a main-thread canvas. An injected encoder assumes ownership and must close every bitmap, even on error. A real full-worker proxy decode remains a backend timestamped-frame or approved demux/WebCodecs integration dependency.

## Validation boundary

Focused tests exercise fake clocks, DOM callbacks and WebAudio operations, plus source-time/cache/worker resource paths. They do not launch a browser, synthesize an actual decoded-frame pass, measure hardware FPS, prove cold seek latency, certify real audio output or verify one-frame A/V sync. Parent owns managed-browser fixtures, the four canonical gates, actual codec/CORS/user-activation checks and publication.

## Phase 7 preview additions (2026-10-27)

Single authority is unchanged. Graph with analyser support is source -> clip gain -> duck gain -> master -> analyser -> destination, in the SAME AudioContext. Without createAnalyser it remains master -> destination and the meter is explicitly unavailable. Reading the meter never constructs or resumes a context.

```ts
interface AudioLevels {
  available: boolean;
  state: 'measuring' | 'paused' | 'suspended' | 'unavailable' | 'disposed';
  peak: number; // absolute maximum of actual master output samples, may exceed 1
  rms: number; // sqrt(mean(sample^2)), not peak or slider estimate
  peakDb: number | null; // 20*log10(peak), null at zero
  rmsDb: number | null;
}
```

`audio.getLevels()` / `controller.getAudioLevel()` returns this structure. There is no clip meter: parent must label it master/output. UI thresholds are warning above -6 dBFS, error at or above 0 dBFS; no estimation or second context is appropriate. Actual samples are polled on demand only while playing with a running context; paused/disposed/suspended states zero the display immediately. No nonzero cached reading persists after stopping. Float32 fixtures in tests exercise silence, warning, clipping, RMS/peak distinction and disposal, not actual browser sound.

`controller.getAudioCapabilities(clipId)` returns `{keepPitch:boolean,reason?:string}`. Native video supports its element's preservesPitch path; audio-only buffered playback is explicitly unsupported, even though the proposed keepPitch field survives schema parsing. Non-unit buffered keepPitch playback reports that limitation; Inspector must disable it with the capability reason. This patch does not allocate an audio-only native media path or increase the six-decoder budget.

Raw clip fade gain is `clamp(local/fadeInSec)*clamp((duration-local)/fadeOutSec)` with an absent/zero side equal to one. It multiplies the shared keyed-volume scalar on the animation-offset clock. `duckUnderVoice:false` excludes that music clip from ducking and releases any previous duck ramp continuously; it is consumed by raw audio AND resolved scene metadata. `keepPitch` defaults false on native video to preserve existing pitch-rate semantics. Buffer pitch and video CORS/speaker output remain browser fidelity gaps.

Preview-only controller editing: `setEditingTextClip(id|null)` suppresses only visual text in the renderer input; `onScene` remains unfiltered. Existing exported `measureTextOverlay(layer,scene)` measures loaded-font Pixi CPU geometry with no additional GPU renderer. Clear this transient suppression on editor cancel, commit and teardown; never translate it into a server op. `getCompareCapability()` currently returns `{available:false,reason:'Isolated before/after grade composition is not implemented'}`. No comparison pixels or setCompare API are supplied.

### Typed text measurement bridge

The package now exports `ControllerPreviewAPI`, `TextGlyphBounds`, `MeasuredTextStyle`, `MeasuredTextRegion`, `TextFontStatus`, `TextOverlayBounds`, `TextMeasurementOptions`, `measureTextOverlay` and its `measureResolvedTextLayout` alias. ControllerPreviewAPI consists of readonly currentScene plus setEditingTextClip/getAudioLevel/getAudioCapabilities/getCompareCapability. No new controller, clock, renderer or decoder is required.

`await measureTextOverlay(layer,scene,{loadFont?})` retains the previous combined rectangle and word rectangles, adding `status:ready|font-pending|unavailable`, `primary:{bounds,style}`, optional `secondary:{bounds,style}`. Bounds use actual Pixi CPU glyph geometry before transforms relative to scene centre. Style contains source fontFamily, scaled fontSize, fontWeight/fontStyle, measured lineHeight, resolved letterSpacing, source colour/alignment and optional alpha-correct WebkitTextStroke. Secondary style/bounds are independent of primary, including lower-third pop-word mode. Parent must not place both editable regions over the combined rectangle.

Font-pending/unavailable is not authorization to hide text: keep the existing preview and use read-only editing until ready. Missing CPU layout or rejected measurement must map to unavailable, not a guessed line-height/box. The existing document.fonts.ready event can trigger a parent remeasurement without another clock. An explicit injected loadFont(css,content) must truthfully resolve true only for the requested face; default browser checks reject empty fallback-only FontFace loads even when check() returns true. Actual rendering and measuring share one glyph-layout helper. No GPU success is implied by these CPU measurements.
