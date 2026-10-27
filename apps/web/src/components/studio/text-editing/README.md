# Phase 7 text surfaces

Source-only, isolated text UI. All components use the parent's **one** `EditingAPI`.
No socket, store, player, renderer, upload service, keyboard manager, font registry,
or dependency is created here. This directory does not integrate itself into Shell.

## Public imports

```tsx
import {
  ViewerTextEditor,
  TimelineTextEditor,
  InspectorTextField,
  CaptionsEditor,
  CaptionsEditorDialog,
  TextSuggestion,
  TEXT_STYLE_IDS,
  TEXT_ANIMATIONS,
  type TextStyleFields,
  type ViewerTextLayout,
} from '@/components/studio/text-editing';
```

`types.ts` is the actual prop contract. `index.ts` exports actual implementations,
not declarations or placeholders. `caption-commands.ts` exports pure caption
classification, replace, style, retime, split and join operations.

### Timeline and inspector

```tsx
<TimelineTextEditor
  editing={editing}
  clip={clip}
  onFinish={() => closeInlineEditor()}
/>
<InspectorTextField editing={editing} clip={clip} />
<InspectorTextField
  editing={editing}
  clip={clip}
  field="secondaryContent"
  label="secondary text"
/>
```

Mount timeline editor only while editing a text clip. It defaults to select all
and focus without scrolling, suitable for the parent's E/double-click intent.
Fields stop keystrokes from reaching clip shortcuts while leaving native caret
movement and textarea undo alone. Timeline Enter commits. Viewer title Enter
inserts a newline; viewer caption Enter commits. IME Enter/Escape are ignored.
Inspector titles retain native textarea newlines.

Inspector owns style/size/alignment/content color/animation controls. The shared
`TextStyleFields` is a `Pick` of the real core `Clip.text` contract, including
style, fontSize, alignment, color, animation and position. Eight canonical style
IDs and all five exact animation names are exported. No frozen style default is
changed here, and no entire inspector is duplicated.

### Viewer integration requirements

Parent activates on text double-click and mounts `ViewerTextEditor` **inside the
existing fullscreen host**. Do not portal it to document.body. Parent supplies:

- `layout.status: 'ready'` only after the correct font is loaded and matching Pixi
  measurements are available. Non-ready status keeps persisted preview visible,
  displays an explicit pending/unavailable status and creates no editing draft.
- Scene dimensions, viewer displayScale and letterbox offset in host CSS pixels.
- Resolved clip transform, including animation-time transform if relevant.
- Primary and optional secondary **separately measured** regions. Coordinates are
  local, before clip transform, relative to scene center, matching Phase 6's
  measured text overlay convention. A combined lower-third block must not be
  passed as if it were two individually measured fields.
- Resolved loaded-font styles. Font size, line height, letter spacing and stroke
  are already in content coordinates including text.scale, not displayScale.
- `onTransientHide(id, hidden)` hides **only persisted text pixels in preview**,
  not clip data, words, scene metadata, track.hidden or opacity. Preserve the
  measurements while hidden. It fires once on activation and once on restoration.
- Optional parent focus target and optional move/scale/rotate pointer intent hook.
  That hook only forwards intent; this component implements no duplicate drag
  system. Parent must supply keyboard transform equivalents if exposing the tools.

The editor never measures fonts using DOM boxes, canvas or approximations. CSS
editing geometry is derived only from injected measurement/style/transform data.
This is not evidence of DOM/Pixi glyph parity. Fit, fullscreen, wrapping, font
loading, rotated text and actual GPU pixels still require parent's browser/GPU
acceptance. Parent's fullscreen and keyboard handlers must respect consumed
Escape/composition events and include the editable textbox in focus trapping.
Focus uses preventScroll and preserves ancestor scrollback; commit/cancel and
unmount restore the supplied or previous focus target.

### One shared pending value and one authority

`getTextEditModel(editing, clipId)` is weak-keyed by the real editing authority.
Every field for that clip subscribes to the **same** pending primary/secondary
value. There are no independently uncommitted inspector/timeline/viewer copies.
Unfocused fields accept external core updates. A focused draft remains a core
soft lock; core removal/selection/toast callbacks own AI-delete handling.

- Input updates shared text immediately.
- Preview replaces the core draft after 150 ms, never server version authority.
- An 800 ms idle period ends a logical typing group, with one text.update carrying
  both primary/secondary plus words. It never sends one group per keystroke.
- If focus remains, an empty core draft renews the soft lock. Blur cancels that
  empty lock without a persisted group; further typing starts the next group.
- Escape cancels the current unsent draft, not groups already persisted by an
  earlier idle boundary. User undo for those groups remains with the parent/core.
- Focusout and outside click share idempotent commit cleanup. Composition pauses
  preview and idle timers; compositionend flushes any deferred focusout.
- Pending AI suggestions cannot silently expire through the idle timer. Exact
  hint/action copy renders inline, resolves via core, flushes pending local text
  before keep mine, and restores focus after either explicit choice.
- Session replacement/disposal, clip removal and last-subscriber unmount clear
  timers and cancel the current unsent draft. Already sent HTTP groups remain
  governed by core cancellation/delivery semantics, not replayed by this UI.

### Captions and timing policy

`CaptionsEditor` subscribes to the authority projection. Its optional `project`
prop is accepted for parent structural integration but never overrides that
source of truth. Caption classification recognizes caption-clean, caption-pop,
caption-box and legacy caption, excluding title/quote/lower-third/label clips
regardless of track name. `trackId` narrows that classification further.

List width is fluid. `CaptionsEditorDialog` uses the existing Dialog primitives,
with full viewport width at narrow sizes. Rows have the requested local 150 px
minimum, timing uses mono t-11, text t-13, active player row orange, trash 16 px.
The actual seek button calls required parent `onSeek(start)`; clicking a text
field preserves its caret and does not unexpectedly seek. There is no new clock.

Find/replace is literal, not regex, and emits one atomic group. Style offers only
three caption styles; position is bottom/middle/top. Retime delegates to the core
trim validator and its frame/source/lock rules. Split uses core splitClips and
adds left/right text.update in the same batch. The user supplies both playhead
and an interior word boundary; no automatic acoustic alignment is claimed. Join
requires adjacent same-track/same-style caption segments, extends the left,
removes the right in the same batch, and maps independent right word timestamps
onto the left animation clock. All helpers validate at the core boundary.

Word text follows core `textUpdate`: Unicode whitespace separates tokens,
whitespace is not a word, punctuation stays attached to its whitespace-delimited
token, CJK without whitespace is one token. Equal counts retain each original
`t`/`d` by index; changed counts distribute uniformly from animationOffsetSec
through animationOffsetSec+duration, not global timeline/source time. Empty text
produces words=[]. Split/join normalize boundary whitespace to single spaces;
they preserve known timings instead of inventing word alignment.

## Focused checks

Use installed executables when global Corepack cache is not writable:

```sh
NODE_ENV=test node node_modules/vitest/vitest.mjs run apps/web/src/components/studio/text-editing
node node_modules/eslint/bin/eslint.js apps/web/src/components/studio/text-editing --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check apps/web/src/components/studio/text-editing
```

Scoped TypeScript was also checked through an external scratch config extending
root tsconfig and including only this directory plus next-env.d.ts. No global
lint/test/build, service, engine, browser, manifest or push operation was run.
Full integration gates and hardware acceptance are explicitly left to parent.
