# Phase 8 Owner B: read-only agent presentation

Public integration contract: `.openclaw/tmp/kimo-phase8-ui-api.md`.

- `ChatStream` owns the vertical scroll viewport; give it a constrained height. Do not put a second vertical scrolling panel around it. It follows new content at distances <=80px, otherwise offers `new activity ↓`. Stream mutations are observed only within rich text; elapsed-clock DOM updates cannot create false new activity.
- `ActionsTable` owns search, the four audit filters and argument expansion. It consumes frozen model selectors, retains exact snake_case tool names and searches actual project clip display names as well as IDs and labels.
- Pass `active={false}` to hidden tabs to stop elapsed and word timers and running spinner motion. Unmounting also cleans timers/observer. The caller owns announcements through C's single live announcer, avoiding duplicate live regions.
- Shared `orangeOwner` is `running | review | none`. A running foreground action gets one composite rule/wash/spinner treatment. Only the latest review row receives orange when review owns the panel. Parent must arbitrate the composer/header as well, and should mount only the currently visible tab or set hidden content inactive.
- `onRevert` receives the selected completed actual action ID. The header select defaults to the latest completed step; it never returns a synthetic group ID. Parent owns history eligibility, operation outcomes and confirmed system lines.
- `onShow`, `onViewMask(clipId, maskAssetId)`, play, composer focus, render, exact-choice send, asset-ID feedback and action-ID retry are injected boundaries, not transport or editing implementations. They do not assert remote completion.
- Actual assets can be supplied as an ID-keyed map over the model's assets. Clip display names are a separate ID-keyed map. No action correlation, filename subject, licence or mask is inferred. Only `luma_image` mask metadata uses the actual mask resource URL as a still; video/RLE masks explicitly have no decoded preview here.
- Rich text is plain React text plus 500-weight emphasis, code and protocol-checked links. HTML is never interpreted. Resource URLs accept HTTP(S), same-origin absolute paths and blob URLs; data, javascript, protocol-relative and backslash-obfuscated URLs are rejected. Actual web page links require HTTP(S). Missing source/licence information remains unavailable/unknown.
- Web preview uses the already-installed Radix Popover primitive for dismissal/focus behavior; no dependency was added. Actual image-load failure becomes `preview unavailable`. The mask background uses a token-colored checkerboard grid, not a fabricated mask or gradient.

## Local design choices

Explicit spec dimensions (10px inset, 72px tile, 240px preview, 54px mask height, 28px rows, 14/16px icons) are scoped semantic CSS variables, not shared token edits. Standard spacing/type/radius/color/focus/motion tokens are reused. Emphasis uses allowed weight 500. Hover-only controls are also exposed on focus and non-hover devices. Local dates/times represent model reception times, not invented server timestamps.

## Tests

Run `node scripts/test.mjs apps/web/src/components/studio/agent/presentation.test.tsx` from the repository root. Use the repository runner (sets NODE_ENV=test), not a production-env direct Vitest invocation. No browser/visual or transport acceptance is claimed by this component suite.
