# Preview fidelity ledger

## Core formulas, PROPOSED server comparison not verified

Core owner section. The renderer/media owners append separate sections. These are executable preview conventions, not claims that a server has agreed or produced matching frames. No backend reference frames/audio or benchmark hardware was inspected. Timing source formulas below reflect the existing shared reducer; other formulas remain **PROPOSED** until compared against server vectors.

### Pure scene boundary and time

`PureSceneBuilder.build(project,t,options?)` (also instance build, SceneBuilder alias, buildScene function) accepts finite timeline seconds and optional explicit asset metadata/masterVolume. It returns plain data; no DOM, Pixi, store globals, IO, randomness or wall clock. Input project and key arrays are never mutated. Outputs are fresh values. `frame=floor(t*fps)` is a project-frame identifier, not proof of decoded source-frame timestamps.

Normal visibility is `start <= t < start+duration`, including overlapping clips. Explicit transition-pair members additionally appear only in their declared transition window; this does not rewrite or extend project clip timing. Audio retains normal clip visibility. Track array order is proposed bottom-to-top; same-track order is increasing start, then lexical ID independent of object insertion/locale. Hidden tracks omit visual layers, not audio. Locked tracks still play. Missing tracks give explicit approximation rather than invented z-order. Audio-only clips never create visual layers.

Established source time `s=in+(t-start)*speed`. Speed does not change timeline duration. Source trim vector: old start=10,in=3,duration=8,speed=2; trim-in to7 gives start12,in7,duration6; trim-out to11 gives duration4. Split at12 gives left duration2 and right start12,in7,duration6. Neither builder nor reducer silently clamps or repairs source timing from guessed asset durations.

Animation time `q=t-start+(animationOffsetSec??0)`, independent of speed. The split right offset is old offset+timeline split offset, preserving copied keys and word timings; repeated splits accumulate it. **Trim behavior remains legacy:** in-trim changes start without adding animation offset. No claim of animated trim equivalence. Copied transition fields are retained, not rewritten by the reducer. The pure resolver reconstructs a logical span from contiguous split fragments sharing an animation origin, continuous source map, kind/asset/speed and equivalent transition declarations. This preserves the original transition tails and zoom-punch release instead of restarting inherited transitions at internal cuts; the explicit split policy is detailed below.

### Keys and coordinates

Per property, deduplicate equal times with last input winning and sort a copy. Outside keys, hold nearest endpoint; no keys use base. Values override base. For bracketing keys a,b, `u=clamp((q-a.time)/(b.time-a.time),0,1)` and `value=a.value+(b.value-a.value)*E(u)`. Departing a controls E:

- linear E=u
- hold E=0 until the next key time, at which the new value applies
- ease_out E=1-(1-u)^3
- ease_in_out E=4u^3 if u<.5 else 1-(-2u+2)^3/2
- bezier E=By(v), where Bx(v)=u and `B(v,p1,p2)=3(1-v)^2*v*p1+3(1-v)*v^2*p2+v^3`; 40 deterministic bisection steps on [0,1]. x handles normalized, y overshoot permitted. Endpoints exact.

Recognized transform keys x,y,scale,rotation,opacity (or transform-prefixed) and volume; effect scalar path `effects.<effectId>.<param>`. Unknown paths remain visible in warnings. Opacity is clamped [0,1] after keys; scale is clamped >=0 after keys; audio gain >=0. Rotation remains degrees in scene data; renderer converts radians=degrees*pi/180. x/y are proposed project-pixel translations relative to project center. Uniform asset fit and crop interpretation must agree with server. Crop is passed unchanged, proposed source-normalized l/t/r/b before transform; combined crop >=1 is flagged, not silently replaced. No automatic subject tracking/reframe is applied: supplied AI transform and x keys are resolved once.

### Paired transitions and explicit source samples

**Supersedes the initial clip-local-only implementation.** Same-track logical butt-cut neighbors are paired whenever incoming.transitionIn (preferred) or outgoing.transitionOut supplies a non-cut, nonzero transition. Incoming declaration wins; duplicate declarations coalesce, differing kind/duration/direction emit a conflict warning rather than double-applying. Neighbor boundary tolerance1e-7s; ties use deterministic start/id order. No cross-track or gap pairing is invented.

`requestedD=durationFrames/fps` when present, else legacy duration seconds. `D=min(requestedD,outgoingLogicalDuration,incomingLogicalDuration)` bounds adjacent pair windows so consecutive transitions do not overlap on a short clip; truncation is flagged. For boundary b, explicit window `[b-D/2,b+D/2)`, `u=(t-(b-D/2))/D`. At u0 both members are present with outgoing weight1; at window end the pair disappears and incoming alone is fully visible, with no lingering clip-local fade tail. Paired phases are suppressed in standalone layer resolution even outside the pair window.

SceneGraph.transitionPairs declares both clip IDs, exact window/progress, direction and compositeAtClipId=incoming ID. Both explicit member layers include transitionPairId/transitionRole/transitionSample. They must **not** also be drawn as standalone weighted sprites. Render one pair group at incoming's z slot; other tracks and same-track overlaps retain deterministic ordering. Member opacity is resolved keyed base only, never multiplied by pair weights in core.

For crossfade (and zoom_in), pair composite is `premultiplied_mix`, weights `wA=1-u,wB=u,wBlack=0`. Render each fully processed member into transparent premultiplied RGBA then evaluate `P=wA*A+wB*B+wBlack*(0,0,0,1)` and source-over P onto the underlying scene **once**. With two opaque members alpha(P)=1 throughout, avoiding the `u*(1-u)` background leak from stacking two faded sprites. With translucent members, alpha is the deliberate weighted alpha, not an invented opaque fill.

Dip uses the same single weighted composite with first-half `(wA,wB,wBlack)=(1-2u,0,2u)` and second-half `(0,2u-1,2-2u)`. This is an explicit opaque-black dip, not merely a fade exposing the underlay. At u.5 weights(0,0,1). Zoom_in additionally scales incoming by `1+.15*(1-u)`; outgoing scale unchanged. .15 is a proposed coefficient, not a PDF/server agreement.

Slide/whip pair composite is source_over, weights1/1/0, with ordinary member opacity. Direction sign=-1 for left/up,+1 for right/down; extent is W or H. Outgoing displacement=sign*u*extent; incoming=-sign*(1-u)*extent. Applied to resolved transform once. Whip also carries `blurPx=64*4u(1-u)` on both members. 64px/sample pattern is proposed; renderer owns filtering implementation.

#### Split transitions preserve original boundaries without new wire fields

The reducer still copies keys/words/transitions and adds the right animationOffsetSec, leaving source/start/duration math untouched. Pure grouping joins contiguous fragments only when they have the same kind, asset, speed, equivalent transitionIn/Out, `right.animationOffset=left.animationOffset+left.duration`, and `right.in=left.in+left.duration*speed`, all with1e-7 tolerance. Offset must be explicitly positive on the right, so ordinary butt cuts are never merged merely because they share an asset. Grouping does not merge media or layer objects or erase per-fragment transform/text/effect edits.

The logical span supplies original transition entry/exit boundaries and animation-span end for duration-based envelopes. This avoids new inherited dissolves at internal splits and prevents a short first fragment from shrinking a .3s boundary dissolve. Active pair outgoing/incoming IDs and compositeAtClipId point to the **actual current fragment** present in project.clips. Pair ID remains anchored to the logical roots; media pools still use actual fragment IDs. At a fragment boundary use [start,end) to switch the active member, without changing pair window/progress/weights. A frozen endpoint uses the logical original source boundary, even when the final fragment is shorter than one source frame; animation/masks use the shared clock at that sample.

Standalone entry/exit fallback and zoom-punch also use `animationSpanSec=logicalDuration+firstFragment.animationOffset`, not the shortened first fragment's duration. q remains each actual fragment's stable animation clock. An explicitly changed transition declaration, discontinuous source, moved fragment or changed speed breaks grouping; these are real edits, not silently treated as the original split. Same-track z-order remains the declared start/id policy, not a reconstructed backend layer-order claim. This is a deterministic frontend normalization policy PROPOSED for server comparison, not a new field or producer migration.

#### Source handles, freeze boundaries, no naive clip extension

Normal source formula remains `s=in+(t-start)*speed`. Pair sampling uses this desired source timestamp only when valid. Video preroll with desired s>=0 is available through its existing source-in handle. Video postroll is used only when asset.durationSec explicitly proves desired s<duration. An absent duration does not invent postroll. Metadata is injected in options.assets, never fetched. All actual pair media requests must use **layer.sourceTime**, not derive visibility/source time again from the unchanged project clip.

Missing incoming preroll (desired s<0) freezes the actual first source timestamp clip.in. Missing/unknown outgoing postroll freezes the last clip boundary frame: `max(in,(ceil((in+duration*speed)*sourceFps-1e-9)-1)/sourceFps)`, further capped to the final source frame allowed by known asset duration, and never negative. Invalid source bounds are explicitly warned. This samples the preceding source frame even for fractional/speed-scaled endpoints; it does not seek a clip/asset's exclusive end. options.sourceFps[assetId] supplies a positive finite source frame rate; project fps is only a provisional freeze quantum when source fps is unavailable. Missing handles always emit an approximation; **adequate source metadata and handles do not get a generic paired-transition approximation**. Decoder/presentation accuracy is still a media concern, not proven by metadata.

Frozen members evaluate transform/effects/text/animation and temporal mask at `sampleTimelineTime=start+(actualSourceTime-in)/speed`, so the boundary content freezes coherently instead of animating a held pixel independently. transitionSample stores requestedSourceTime, actual sampleTimelineTime, mode handle/boundary and optional start/end boundary. Pair transforms/weights still progress on scene time. Static nonvideo media does not require a decoder handle. Mask source time/frame index follows the actual sampled source timestamp.

A first/last clip, gap or otherwise unpaired transition retains the bounded clip-local fallback with an explicit approximation. This fallback is **not** the implementation/acceptance claim for a butt-cut crossfade. Cut/zero durations do nothing. Source handles, color-space/font/pixel match and these centered-window choices remain PROPOSED pending server reference comparison; nevertheless the core now resolves actual neighbor layers and an executable, leak-free pair blend contract rather than always approximating the known feature.

### Effects, masks, shapes

Effects preserve input chain order and carry resolved scalar-key params and explicit normalized scope. Renderer performs actual pixel operations; core must not preapply colour math and make renderer apply it twice. Known families: grade/colour_grade, blur/gaussian_blur, vignette, grain/film_grain, sharpen, black_white/black_and_white/bw, zoom_punch (alias zoom_punch_in), lut. Unknown kinds stay in chain with approximation reason. Legacy generic ducking remains unknown rather than rewriting its undocumented params.

Zoom-punch transform proposal: `scale *= max(0,1+amount*min(clamp(q/attack),clamp((animationSpanSec-q)/release)))`; amount defaults0, attack/release default.300s. Zero attack/release uses1 for its envelope side. Negative durations normalize0. animationSpanSec is the logical split-preserving span defined above. This envelope has already been applied to scene.transform.scale; renderer must not apply it again.

Mask metadata is injected by asset ID. `mask.sourceTime=s`, dynamic `frameIndex=floor((s-(timeOrigin??0))*maskFps)`. Static luma_image has no frameIndex. Negative/missing frames are unavailable; metadata alone proves no decoded frame. RLE version1 is zero/one alternating row-major runs starting with zero, exact width*height coverage, no implicit missing-frame hold. Feather units in old payloads are unknown; nonzero legacy feather produces approximation. Proposed mask alpha: declared channel sample, Gaussian feather in source pixels only after server confirms units, inversion after feather. Selection mode does not cut out the whole layer; cutout mode multiplies layer alpha. Missing legacy mode defaults selection with warning. Scoped effect result inside=`mix(original,effected,a)`; outside=`mix(original,effected,1-a)`; all=effected. Renderer must retain the original chain-stage input for scope mixing.

LUT metadata declares 64-cube in 8x8 tiles, encoded sRGB. For integer r,g,b in0..63: tile=(b%8,floor(b/8)), texel=(tile.x*64+r,tile.y*64+g), normalized coordinate=(texel+.5)/512, image top-left row origin. Trilinear interpolation of eight neighbors, not nearest slice. Absence of metadata is explicitly approximate. Renderer owns sampling implementation and comparison vectors.

Shape rect supplied geometry is local centered width/height; line uses explicit local endpoints. Transform positions it. RGBA is normalized [0,1]; unspecified radius/strokeWidth zero. No dimensions or bar are inferred from clip kind. Missing geometry reports `Shape geometry unavailable`.

### Exact typography data versus proposed placement

The eight style IDs, families and sizes come directly from §6.5: caption-clean Geist500/56 white with2px black stroke alpha.25; caption-pop Anton400/72 uppercase and active #FFD84D; caption-box Geist500/48 on black alpha.70 rounded box; title-serif Instrument Serif400 italic/120; title-bold Anton400/140; lower-third Geist500/40 plus Geist400/28; label-mono Geist Mono400/32; quote DM Serif Display400/64. White/black/yellow are content-only colors in text-styles, not UI styling. Aliases title/caption/lower_third normalize to title-serif/caption-clean/lower-third.

Proposed missing placement choices, using existing DESIGN tokens: box/bar radius8 and padding16 reference px, black alpha.7 lower-third bar; otherwise default white. Actual font measurement/wrap/rasterization is renderer-owned, not invented by pure core. Font readiness and font-file matching must be separately verified. These defaults are recorded here because this owner's allowed scope does not include DECISIONS.md; parent should copy this choice ledger into its decisions log.

Title-safe rectangle `(x=.05W,y=.05H,width=.9W,height=.9H)`, content uniform scale `min(W/1920,H/1080)`; portrait1080x1920 => .5625. Anchors: centered title/quote `(W/2,H/2)`; captions `(W/2,.95H)`; label/lower-third `(.05W,.95H)` with bottom-left semantic anchor. Primary content unchanged except caption-pop uppercase. Secondary defaults empty. Words retain source order, t/d on q clock, active when `t<=q<t+d`. Overlaps keep multiple active descriptors, zero-duration words never active. These descriptors are not a claim of glyph-exact line breaks or highlight bounds.

### Audio proposal

Audio descriptors emitted for active audio/video clips, even hidden visual tracks. Source offset is s, playbackRate is clip.speed (controller transport rate multiplies externally). Gain=`max(0,keyframedVolumeOrBase)*masterVolume*trackGate*duckGain`; base defaults1, keys override; master defaults1 and must be finite >=0. trackGate0 for muted, or non-solo when any track solo exists. Mute wins over solo; locked has no playback effect. Roles default other, never guessed. Consumers of resolved gain must not reapply master/duck/gates.

Voice policy is typed voice clip timeline intersections that pass track gates, regardless of names or undocumented amplitude thresholds. Music target gain `10^(-12/20)=.251188643150958`. Other roles remain1. Attack/release are continuous linear gain ramps of .300s from the gain at a target change to the new target. Union voice intervals; overlap starts/ends do not restart a ramp while target is unchanged. Interrupted ramps start from the instantaneous interpolated gain. Deterministic seek recomputes event history, never wall-clock state. This is a scheduling target, not a browser audio-output/sync measurement or guarantee of speed/pitch parity with server. Volume fades are the shared keyframe interpolation, not a second envelope.

### Core verification boundary

Focused tests cover interval endpoints, source/trim/split speed, repeated animation and word split preservation, copy-sorted keys, key endpoints/easing/bezier, portrait/crop/rotation, ordering/overlap/visibility, transition directions/durations/overlaps, typed mask times/inversion/scopes, missing geometry/LUT/effect warnings, exact typography, role/solo/fades and interrupted ducking. Parent owns full gates, scripted synthetic fixtures, renderer/media tests, browser goldens, latency/A-V sync and real hardware benchmarks. No 111-frame synthetic throughput number is represented as an FPS benchmark. Server comparison remains **not verified**.
