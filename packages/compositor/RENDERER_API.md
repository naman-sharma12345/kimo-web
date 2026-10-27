# Pixi renderer API

Renderer-owned Phase 6 slice. Import direct modules until the parent integrates exports. This is not a claim that the whole preview phase has passed.

## Entry points

```ts
import { PixiRenderer, fitViewport } from './src/pixi-renderer';
import type {
  PreparedRendererResource,
  RendererResourceRequest,
} from './src/renderer-types';

const renderer = new PixiRenderer({
  getResource(
    request: RendererResourceRequest,
  ): PreparedRendererResource | undefined {
    return preparedResources.get(request.clipId)?.get(request.role);
  },
});
await renderer.init({ canvas, width: 1280, height: 720, resolution: 1 });
const result = await renderer.render(scene);
renderer.resize(720, 1280, 1);
renderer.destroy();
```

The example's resource registry belongs to the caller. It must distinguish LUT asset IDs, mask frame indices and source times, not only the illustrative clip/role key. The renderer does not instantiate a media pool, decoder, AudioContext, fetch pipeline, animation clock, rAF or video-frame callback. Parent owns index exports and integration.

`init(options: RendererInit): Promise<void>` lazily imports Pixi and filters together, uses caller's canvas, prefers `['webgpu','webgl']`, explicitly retries `['webgl']` if preferred initialization rejects, disables autoStart/sharedTicker and stops the application ticker. Only `Application.stage` is a render group. Multiple init calls share the first promise. After destroy this instance cannot be reinitialized.

`resize(width,height,resolution=1): void` takes controller-selected logical viewport dimensions and an explicit pixel multiplier. To avoid double device-pixel scaling, pass device-pixel dimensions with resolution 1, or CSS dimensions with the intended resolution, not both. Parent owns adaptive quality and FPS measurement. `fitViewport(W,H,deviceW,deviceH,lowQuality=false)` fits project aspect, capping landscape at 1920x1080 or 1280x720 and portrait at 1080x1920 or 720x1280. The helper has no hardware or time reads.

`render(scene: SceneGraph): Promise<RenderResult>` prepares only fonts asynchronously. Call after media synchronization and await it before seeking/mutating borrowed resources. Media readiness must already be established by the injected getter. A later render revision cancels the older pending preparation; destroy releases its acquired leases immediately even if a font promise never settles. No asynchronous completion submits a stale scene.

`RenderResult` is `{submitted,retained,approximations}`. Submitted means the application render call returned, not GPU presentation, decoded-frame accuracy, measured latency or visual acceptance. Resource absence retains the entire prior submitted scene without changing nodes, filters, scalar values or textures. On an initial frame with no prior image, available content may submit with explicit reasons for missing resources. Unknown effects, unavailable fonts and invalid atlas/control metadata use explicit approximation reasons. Parent displays the exact `preview approx.` badge and owns all UI chrome. Actual initialization or draw exceptions are errors, not successful approximation submissions.

`destroy(): void` is idempotent. It releases owned Pixi textures/sources, filters, pair wrappers, pending preparation leases, text objects and Application resources, while leaving caller's canvas attached. It never calls a borrowed bitmap's close or a video element's pause/load/src setters. The media owner's lease release decides when to close/recycle its media. Renderer-owned buffer arrays become collectible when their texture lease is released.

## Prepared resource contract

A synchronous getter receives:

```ts
interface RendererResourceRequest {
  clipId: string;
  assetId: string;
  sourceTime: number;
  role: 'media' | 'mask' | 'lut';
  frameIndex?: number;
}
```

Media uses `layer.sourceTime` directly, including paired-transition handle/frozen-boundary samples. Mask uses `layer.mask.sourceTime` and the resolved frameIndex. Do not independently filter transition members by the original clip's visible interval or recompute their source time from that interval. LUT role uses the requested asset ID from `assetId`/`lutAssetId` effect params. The resource provider owns mask-video/RLE frame selection, LUT/image loading, CORS and actual decoder evidence. There is no second decoder pool.

Return an acquired lease:

```ts
interface PreparedRendererResource {
  key: string;
  revision?: string | number;
  source:
    | HTMLVideoElement
    | ImageBitmap
    | HTMLImageElement
    | HTMLCanvasElement
    | OffscreenCanvas
    | { data: Uint8Array; width: number; height: number };
  width: number;
  height: number;
  release?: () => void;
  approximation?: string;
}
```

- `key` identifies the same underlying source across references. Different per-clip videos need different keys. Immutable replacement bitmaps/buffers need different keys. A key reused for a different source is rejected explicitly rather than displaying the old source as if it were new.
- Each getter call acquires a distinct lease. Duplicate cached-source acquisitions release immediately; the original retained lease remains until its final node reference disappears. A pending/cancelled batch releases all acquired leases exactly once. `release` must not throw or close a source that another lease still owns.
- `revision` updates mutable buffers/canvases without recreating textures. Static sources do not reupload on scalar-only edits. Borrowed videos without an explicit revision are updated once per acquired prepared use; with a revision they upload only when it changes. The caller must make the reported revision correspond to the actual accepted video frame.
- `approximation` carries media-owner evidence such as seeked-only fallback, decoder-budget freeze or boundary sampling. A nonempty reason is not exact-frame proof.
- Pixel buffers are row-major **premultiplied RGBA8**, exactly width*height*4 bytes. `decodeRLE` returns this format with binary coverage in all four channels. LUT RGBA buffers are opaque. Use the mask descriptor's declared channel; binary output supports luma, red and alpha.
- All dimensions must be positive safe integers. LUTs must be exactly 512x512. Wrong atlas dimensions skip that LUT with a reason; they are not sampled with invented layout metadata.
- Renderer borrows media through `ImageSource`, whose installed 8.22 typings include HTMLVideoElement. This avoids VideoSource's automatic update/playback hooks and its destructive video cleanup. There is no automatic video update to disable because no VideoSource is constructed. ImageSource upload occurs only on a controller-driven submit/revision.

## Diff and transition contract

Nodes are keyed by clipId, not cloned clip object identity. Layer kind changes explicitly replace a node. Visible removals destroy it; reorders reuse the same node. Scalars update in place. Media, filter instances and word-highlight Text objects persist across otherwise equivalent frames. Changed text layout/shape geometry may rebuild content children, not the clip container.

Core resolves visibility, animation, opacity, slide/zoom transforms, zoom-punch envelope, source handles and paired weights. Renderer must not apply those envelopes again. `layer.opacity`, not `transform.opacity`, is the final keyed/transition opacity.

`SceneGraph.transitionPairs` is optional for legacy synthetic inputs. A complete pair suppresses its members' standalone root draws and composites once at `compositeAtClipId`. Weighted premultiplied pairs isolate each member, apply explicit weights once, add premultiplied RGB and alpha plus any opaque-black weight inside a transparent intermediate, then source-over the isolated result once. Source-over pairs group resolved members in outgoing/incoming order without multiplying weights. Pair wrappers are ordinary containers, not render groups. Invalid/missing/overlapping pair membership reports a base-preview reason.

## Validation boundary

Focused tests use real Pixi containers, sprites, textures, uniform groups and WGSL binding reflection, with mocked Application submission, GL-program creation and text metrics. They exercise lifetimes and formulas without creating WebGL/WebGPU contexts. Text metrics mocks verify layout plumbing, not actual glyph fidelity. Twelve deterministic resolved input scenes are exported by `pixi-renderer.test.ts`; they are not screenshots/goldens or server comparisons.

See `FIDELITY-RENDERER.md` for formulas, units, coefficients, limits and unresolved acceptance work. No new dependencies, Three.js/TSL runtime or pixi-filters package is introduced.
