# Renderer preview fidelity ledger

Implemented against installed **PixiJS 8.22.0** declarations and source. This renderer ledger complements the core owner's `FIDELITY.md`; it does not replace core timing contracts or claim server agreement. No backend reference render, GPU shader compilation/presentation, browser screenshot, local GL, Playwright or hardware benchmark was run by this owner.

## Sources and architecture

Read the installed webgpu-threejs-tsl and vercel-react-best-practices skills. Applied lifecycle, ownership, lazy imports and transient-state guidance only. No Three.js/TSL or React render loop was introduced.

Official sources read:

- https://pixijs.com/8.x/guides/components/textures
- https://pixijs.com/8.x/guides/concepts/render-groups
- https://pixijs.com/8.x/guides/components/filters
- https://raw.githubusercontent.com/pixijs/pixijs/v8.22.0/src/rendering/renderers/shared/texture/sources/VideoSource.ts

Installed declarations/source consulted: Application/AutoDetectRenderer, VideoSource/ImageSource/BufferImageSource/TextureSource/Texture/RenderTexture, Filter/FilterSystem, GlProgram/GpuProgram/UniformGroup, Graphics/Text/TextStyle, sprite-matrix mapping, built-in shader programs and GL/GPU additive blend factors. Dual shader programs use Pixi's public Filter/GlProgram/GpuProgram/UniformGroup APIs. Their binding reflection is tested without a GPU; executable compilation and pixels remain unverified.

Only Application.stage is a render group. Ordinary clip and transition-pair containers are retained. No ticker, decoder pool, tracking inference, audio clock or rAF is created here. Controller drives submits, chooses viewport size/quality and reports actual FPS. Readiness absence leaves the previous submitted framebuffer and its full scene resources untouched.

## Geometry and compositing

Source media is centered and contain-fitted: `k=min(W/sourceWidth,H/sourceHeight)`. For local source pixel p, project position is `projectCenter + (x,y) + R(clockwiseDegrees*pi/180) * scale * k * (p-sourceCenter)`. Transparent letterboxing is intentional. Cover/reframe must arrive as the core/AI transform, not another renderer-side crop/tracker. Portrait uses the same formula.

Crop l/t/r/b is interpreted as source-normalized fractions. A stencil Graphics rectangle clips the source-fitted image before parent transform: x=-w/2+w*l, y=-h/2+h*t, width=w*(1-l-r), height=h*(1-t-b). Invalid legacy units are surfaced by the core ledger; they are not certified normalized server data. Opacity comes from layer.opacity once. Rounded rectangles are centered local width/height; lines use the supplied endpoints. Content RGBA comes from supplied shape/style data, never UI chrome.

All scene layers use ordered premultiplied source-over. Pair compositions use the actual new core `ResolvedTransitionPair` API:

- Premultiplied mix: `C=wA*A+wB*B+wBlack*(0,0,0,1)`. A and B include their keyed opacity. Each member is isolated with an identity filter, its result uses additive ONE/ONE RGB and alpha into an isolated pair, then that pair uses normal source-over once at the incoming slot. This is not two weighted source-over sprites on the background.
- Example: opaque red A and opaque blue B at weights .5/.5 give `(0.5,0,0.5,1)` regardless of a green layer beneath. Naive stacking would leave alpha .75 and leak green; that path is not used.
- Dip midpoint: weights 0/0/1 give `(0,0,0,1)` even over other visible tracks. Black is a content compositing sample, not UI styling.
- Slide/whip source-over pairs preserve both resolved transforms and ordinary outgoing/incoming order inside one group. Zoom scale and zoom-punch envelopes already resolved by core are not reapplied.
- Source timestamps and handle/boundary evidence come from core plus media provider. No invalid source extension or guessed frame is decoded by the renderer. All pair members must have coherent prepared resources before changing the submitted scene.

The legacy descriptor-only path still consumes resolved scalar transitions; only scenes supplying transitionPairs receive certified-by-code paired isolation semantics. Pixel fidelity is not certified by the CPU vectors.

## Color grade

Unless stated otherwise, shaders unpremultiply RGB using `max(alpha,1e-6)` before color operations, clamp final encoded RGB to [0,1] and premultiply again. Alpha is preserved for grade/LUT/vignette/grain/sharpen/B&W. Identity/isolation copies the original RGBA directly.

Grade operates in linear light, in this exact order:

1. Decode each encoded sRGB a: `a/12.92` when a<=.04045, else `((a+.055)/1.055)^2.4`.
2. Exposure stops EV: `rgb *= 2^EV`.
3. Contrast around linear .18: `rgb=(rgb-.18)*contrast+.18`.
4. Linear Rec.709 luma `L=dot(rgb,[.2126,.7152,.0722])`; saturation `rgb=L+(rgb-L)*saturation`.
5. Temperature/tint offsets in linear RGB: `rgb += .1*(temperature,-tint,-temperature)`. Legacy temp aliases temperature; explicit temperature wins.
6. Component lift/gamma/gain: `rgb=pow(max(rgb+lift,0),1/gamma)*gain`. Global lift/gamma/gain is a fallback for missing per-channel liftR/G/B, gammaR/G/B and gainR/G/B.
7. Encode each linear a: `12.92*a` when a<=.0031308, else `1.055*a^(1/2.4)-.055`.

Defaults: exposure/temp/tint/lift 0; contrast/saturation/gamma/gain 1. Vectors: identity preserves [0,.5,1]; neutral .18-linear remains fixed at contrast2; encoded .5 with EV1 becomes encode(2*decode(.5)); red at saturation0 becomes encode(.2126) in all channels. A lift.25, gamma2, gain.5 starting at black yields encode(.25).

These are declared preview formulas, not established server color management. Browser decode color conversion, HDR/wide-gamut sources, ICC profiles, texture/render-target formats and server linear/encoded blending agreement need real reference frames.

### Scalar registry and explicit bounds

Only documented scalar controls are consumed. Unknown controls, nonnumeric controls and substitutions produce approximation reasons, not silent acceptance.

| Family             | Controls and bounds                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grade              | exposure [-16,16] stops; contrast/saturation [0,8]; temperature/temp/tint [-1,1]; lift/global+RGB [-1,1]; gamma/global+RGB [.001,16]; gain/global+RGB [0,16]; optional LUT assetId/lutAssetId strings |
| blur/gaussian_blur | radius or legacy strength [0,256] project pixels, default8; internal x/y [0,256]                                                                                                                      |
| sharpen            | amount [0,8], default1; radius [0,256], default1                                                                                                                                                      |
| vignette           | strength [0,1], default.5; inner [0,2], default.4; outer [0,2], default1, adjusted above inner by1e-6 when necessary                                                                                  |
| grain/film_grain   | amount [0,1], default.1; seed [-16777216,16777216], default0                                                                                                                                          |
| whip               | x/y [-256,256] project pixel half-extents; radius fallback [0,256]                                                                                                                                    |
| LUT                | assetId/lutAssetId strings; actual atlas must be512x512                                                                                                                                               |
| B&W                | no scalar controls                                                                                                                                                                                    |

Aliases implemented: grade/colour_grade/color_grade and named grade subfamilies; blur/gaussian_blur; grain/film_grain; bw/black_white/black_and_white. Zoom-punch/zoom-punch-in is consumed through already-resolved core transforms. This table declares preview safety ranges, not server parameter limits.

## 64-cube LUT

Domain is encoded sRGB, declared by core/client metadata. Atlas is512x512, eight by eight tiles of64x64. r increases right, g increases down, b advances tile column then row. For integer blue slice z, UV=`((z%8,floor(z/8))*64 + (r,g)*63 + .5)/512`. Sample bilinearly within two adjacent blue slices and linearly mix by fract(b*63), which equals trilinear interpolation of eight cube corners. Half-texel centers avoid neighboring-tile bleed. No nearest-blue shortcut or guessed strip layout.

LUT can be its own ordered effect or follow a grade carrying lutAssetId. Scope compositing happens per ordered filter stage. Missing/wrong-size atlas renders base grade/content with a reason, or retains the previous frame for a resource still pending. Metadata absence is already a core approximation. CPU tests cover tile0/tile8/tile63, exact endpoints, identity cube fractional swatches and eight-corner participation.

## Spatial effects

- Gaussian blur: one bounded9x9 pass. Index i,j in[-4,4], weight `exp(-(i*i+j*j)/8)` normalized by its sum; offset `(i,j)*radius/4` in project pixels, multiplied by the current project-to-viewport fit scale before conversion to filter UV. This is a Gaussian truncated at2 sigma with sigma=radius/2. Sample boundaries clamp to Pixi inputClamp; no expanding transparent halo. A single pass retains the original stage input for correct inside/outside mask interpolation. Blur propagates weighted premultiplied alpha. Weight center1D=.2041636887; center2D=.04168281179; constants remain constant.
- Sharpen: same Gaussian with default radius1 and amount1; straight RGB `rgb += amount*(rgb-blurredRGB)`, original alpha retained. This is bounded unsharp masking, not a server-specified kernel.
- Whip: nine samples along the supplied signed x/y axis, offsets axis*i/4 and weights exp(-i*i/8), normalized. Core supplies direction/blurPx and resolved translation. It is a real directional blur pass, not an unsupported placeholder. Uniform values convert project-pixel extents by the current viewport fit scale, so reducing preview resolution preserves optical extent. This is a project-axis blur after layer transform, not a source-axis motion-vector estimate; that convention needs server comparison.
- Vignette: source-UV elliptical radius `d=length(2*(uv-.5))`; multiply RGB by `1-strength*smoothstep(inner,outer,d)`. Center factor1, edge factor.5 at defaults. Coordinate mapping is through source sprite, not the rotated/cropped bounding-box UV.
- Grain: source texel `(floor(u*sourceWidth),floor(v*sourceHeight))`, project frame F and seed S. `h=fract(sin(dot(pixel,[12.9898,78.233])+F+S)*43758.5453)`, additive encoded RGB delta `(h-.5)*amount`. No wall time/random calls. Same inputs repeat on the CPU; floating-point/transcendental differences can vary GL/WGSL pixels and require real-backend tolerance. Grain is zero-centered by construction, not proof of statistical mean for every finite frame.
- B&W: straight encoded RGB becomes dot(rgb,[.2126,.7152,.0722]) in all channels. This is an encoded-domain effect, distinct from linear-grade saturation0; the distinction is intentional and documented.

The81-tap spatial pass plus mask feather sampling is bounded but not benchmarked. No FPS/latency target is claimed, and large effect stacks can require controller quality reduction.

## Masks and scoped effects

Resource provider prepares actual RLE, video or luma-image textures at the core's resolved sourceTime/frameIndex. Renderer never performs SAM inference or guesses a subject. `decodeRLE(width,height,counts)` accepts safe positive dimensions up to16,777,216 pixels, requires integer nonnegative alternating zero/one runs summing exactly width*height, and emits row-major premultiplied RGBA8 binary coverage. Initial zero run may have length0. Invalid runs reject instead of fabricating a mask. Fetch/version/frame lifecycle remains provider-owned.

For media sprites, public `FilterSystem.calculateSpriteMatrix` maps filter UV back to original source UV, accounting for fitted dimensions, crop, parent rotation, scale, translation and pair nesting. Metadata selects alpha, red or Rec.709 RGB luma. Non-media masks use local filter bounds with an explicit mapping-uncertainty reason.

Feather uses25 samples: d=(i,j), i/j in[-2,2], normalized weight `exp(-dot(d,d)/2)`, offset `(i*feather/maskWidth,j*feather/maskHeight)`. It is a2-sigma truncated Gaussian with feather interpreted as sigma in mask-source pixels. Inversion happens after feather, `a=1-a`. Nonzero legacy feather still carries the core's units-agreement warning. Opaque luma masks are preferred; channel/alpha interpretation of translucent encoded images needs agreed producer metadata.

Inside scope output=`mix(original,effected,a)`; outside=`mix(original,effected,1-a)`, interpolating full premultiplied RGBA from the input of that effect stage. All scope uses effected output. Cutout is a final pass multiplying full premultiplied RGBA by a. Selection mode alone never cuts the whole layer. Missing mask resources retain the whole prior scene, or use visibly labelled base content when no prior scene exists.

## Text and shapes

The renderer consumes the exact eight-style core data without duplicating colors, sizes, fonts or UI tokens. It waits for primary and lower-third secondary `document.fonts.load`; an injected loader is available for tests. Font load failure renders an explicit system-fallback approximation. Font promise cache is bounded to128 entries. Font files/CSS registration are parent-owned.

Pixi Text handles wrapping, supplied stroke, supplied fill, font weight/style and safe-width constraint. Caption-pop uses per-word measured Text objects, rows wrap at safe width, each row is centered, all timed-active words get the core's activeWordColor. Active-state-only changes update fill without creating new Text/clip objects. Word tokens are separated by measured spaces; typography/kerning at token boundaries and long-word breaking need real glyph-reference validation. Lower-third uses primary and secondary font sizes from core; the secondary follows primary height. Background box/bar geometry uses supplied padding/radius and measured bounds. Shapes use Graphics rounded rectangles, optional stroke and explicit line endpoints.

Only core/style data supplies in-video typography colors including caption-pop yellow. Content colors do not leak into app chrome. Text bounds/selection handles/AI overlays remain parent-owned.

## Acceptance status and honest gaps

Implemented in code: retained lifecycle/diff, coherent prepared-resource gate, source ownership/refcounts, scalar/crop/shape transforms, all eight Text styles and active words, actual dual-program grade/LUT/spatial/mask passes, paired premultiplied/dip/source-over composition and resolved whip consumption. Unknown heavy effects show base content plus a reason. No known implemented feature is represented by an unsupported-kind stub.

Still unverified or outside this owner's boundary:

1. GL/WGSL compilation, actual WebGPU/WebGL rendered pixels, glyph rasterization, video upload behavior and browser/device loss recovery. Preference fallback is attempted; a canvas already bound to a failed backend may require parent replacement. Pixi's auto-detect internals can reject before exposing a failed renderer, limiting cleanup access on that failure path.
2. Server formula/alpha/space/font agreement and real reference frames. The CPU oracle is not a server comparison.
3. Provider integration for real timed masks/LUTs and accepted decoded frames; callbacks cannot manufacture exactness. Unsupported/late media retains prior state or reports an approximation.
4. Non-media mask coordinates are only local-bound approximations. Adjustment-layer backdrop scope remains undefined and explicitly approximated, consistent with core policy.
5. Hardware FPS, op-to-pixel latency, A/V sync, real browser golden frames, UI badge/overlay/fullscreen behavior and adaptive controller policy. Those are not established by mock render calls or test counts.
6. Device-loss restoration is not automatic here. Initialization/submission errors must be handled by parent; a failing draw is not labelled a successful retained GPU presentation.

Tests are CPU formula vectors, real Pixi object/binding behavior and mocked submission/metrics, plus twelve deterministic **input** scenes. No fabricated screenshot, performance number or full-phase completion claim is supplied.
