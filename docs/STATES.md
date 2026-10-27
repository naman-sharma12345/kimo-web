# Component and screen state inventory

As of 2026-10-27: **inventory authored, not all states implemented or verified**.
No Phase 10 browser/axe/screenshot suite was run; **baselines NOT CAPTURED**.
This is a source-led inventory plus execution backlog, not an all-ticked checklist.
Parent owns app fixes, integration and release acceptance. Active parallel source
changes can supersede the inspected interfaces and require re-review.

## Reading each cell

- **A**: an executable browser case was authored for this state in
  `e2e/state-matrix.ts`/screenshots/axe/keyboard. NOT RUN, not a pass.
- **R**: required scenario, still needs a dedicated fixture or manual execution.
  It may exist in application source; inventory inclusion does not certify it.
- **N1**: N/A, noninteractive display has no hover/focus/pressed/disabled action.
- **N2**: N/A, transient local control has no independent network loading/offline
  lifecycle; its parent owns request/unknown state.
- **N3**: N/A, fixed decorative/status primitive has no user-content empty/error
  lifecycle; owning screen provides those states. Semantic status still needs AT.
- **N4**: N/A, fixed icon/primitive has no text to truncate; accessible name remains required.
- **N5**: N/A, the screen itself is not pressable/disableable; its controls are separate rows.
- **N6**: N/A, static prose/gallery has no remote save/unknown lifecycle. Links remain interactive.

Columns D/H/F/P/X/L/E/Err/O/K/RM/HC/T mean default, hover, focus, pressed,
disabled, loading, empty, error, offline-or-acceptance-unknown, keyboard,
reduced motion, high contrast, long text. A screen-level A covers only the named
central case, not every descendant and every combination. For example a review
screenshot does not prove caption-toggle focus or pending approval behavior.

Source-tested evidence below points to existing test files, **not a rerun of those
files**. `UI`, `Shell`, etc. resolve to sources below. Parent verified the frozen
Phase 9 checkpoint's 900 tests/88 files; no per-state browser pass follows from
that aggregate. `none` means no specific test evidence identified here, not proof
that tests cannot exist. Captured/manual columns explicitly separate history.

## Screen and route inventory

| Surface                                            | D   | H   | F   | P   | X   | L   | E   | Err | O   | K   | RM  | HC  | T   | Source-tested evidence (not rerun)      | Captured                        | Manual                                            | Blocked / remaining                                         |
| -------------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --------------------------------------- | ------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Landing `/` composer and navigation                | A   | A   | A   | A   | A   | A   | A   | A   | R   | A   | A   | A   | A   | Landing; validation                     | Historical Phase 2 only         | Earlier navigation observed; new states NOT RUN   | cream-38 privacy conflict; upload lifecycle needs fixtures  |
| Privacy `/privacy`                                 | A   | R   | R   | N5  | N5  | N6  | N3  | R   | N6  | R   | A   | A   | R   | Parent privacy tests active             | NOT CAPTURED                    | NOT RUN                                           | Retention/provider policy needs backend confirmation        |
| Warm-up `/warmup/:id`                              | A   | R   | R   | N5  | N5  | A   | R   | A   | R   | R   | A   | A   | R   | Warmup                                  | Historical fetch error only     | Phase 8 auto-navigation observed                  | Actual timeout/retry and native transition/200% evidence    |
| Studio `/studio/:id`                               | A   | R   | R   | N5  | N5  | A   | R   | A   | R   | R   | A   | A   | R   | Shell; restore                          | Historical Phase 5 shell only   | Phase 8 edit/reload observed, not full acceptance | GPU unavailable before init; history reload loss/reconnects |
| Review dialog in Studio                            | A   | R   | R   | R   | R   | R   | R   | R   | R   | R   | A   | A   | R   | Review; approval                        | NOT CAPTURED                    | NOT RUN                                           | Poster/GPU; pending/unknown approval scenario               |
| Render `/render/:id`                               | A   | R   | R   | N5  | N5  | A   | R   | A   | R   | R   | A   | A   | R   | Render; lifecycle                       | NOT CAPTURED                    | Separate browser owner; no result imported        | Synthetic frames only; durability/backend unverified        |
| Delivery `/v/:id`                                  | A   | R   | R   | N5  | N5  | A   | R   | A   | R   | R   | A   | A   | R   | Delivery; player                        | NOT CAPTURED                    | Separate browser owner; no result imported        | Silent original pattern, not composition/audio acceptance   |
| Not-found / expired / unavailable / route boundary | A   | R   | R   | N5  | N5  | A   | R   | A   | R   | R   | A   | A   | R   | Restore; lifecycle                      | NOT CAPTURED                    | NOT RUN                                           | Route focus and actual 404/410/5xx semantics                |
| Token gallery `/dev/tokens`                        | A   | N1  | N1  | N1  | N1  | N6  | N3  | N3  | N6  | R   | A   | A   | R   | none                                    | Historical Phase 0 capture only | NOT RUN                                           | Dev route denied by public preview                          |
| Component gallery `/dev/ui`                        | A   | A   | A   | A   | A   | A   | R   | A   | N6  | A   | A   | A   | R   | UI                                      | Historical buttons/fields only  | NOT RUN                                           | Built-in forced examples, not all interaction combinations  |
| Compositor fixture `/dev/compositor`               | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Compositor fixture / compositor.spec.ts | NOT CAPTURED                    | NOT RUN                                           | GPU; all 12 existing golden cases authored not captured     |

## Reusable components

Each component below exists under `apps/web/src/components/ui/`; related source
coverage is `ui.test.tsx`. Gallery examples alone are not real interaction passes.
Parent screens own request states marked N2; do not conceal those states globally.

| Surface                                           | D   | H   | F   | P   | X   | L   | E   | Err | O   | K   | RM  | HC  | T   | Source-tested evidence (not rerun) | Captured     | Manual  | Blocked / remaining                                          |
| ------------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---------------------------------- | ------------ | ------- | ------------------------------------------------------------ |
| Button primary/secondary/ghost/danger (all sizes) | A   | A   | A   | A   | A   | A   | N3  | N2  | N2  | R   | A   | A   | R   | UI                                 | NOT CAPTURED | NOT RUN | Runner/manual evidence required                              |
| Icon-only Button / tooltip name                   | A   | A   | A   | A   | A   | A   | N3  | N2  | N2  | R   | A   | A   | R   | UI                                 | NOT CAPTURED | NOT RUN | Runner/manual evidence required                              |
| Input (text/number)                               | A   | A   | A   | N2  | A   | N2  | A   | A   | N2  | R   | A   | A   | R   | UI                                 | NOT CAPTURED | NOT RUN | Runner/manual evidence required                              |
| Textarea (multiline/auto rows)                    | A   | A   | A   | N2  | A   | N2  | A   | A   | N2  | R   | A   | A   | R   | UI                                 | NOT CAPTURED | NOT RUN | Runner/manual evidence required                              |
| AttachmentChip video                              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI; upload tests                   | NOT CAPTURED | NOT RUN | Upload error/retry/offline/long filename dedicated fixtures  |
| AttachmentChip image                              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI; upload tests                   | NOT CAPTURED | NOT RUN | Upload error/retry/offline/long filename dedicated fixtures  |
| AttachmentChip audio                              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI; upload tests                   | NOT CAPTURED | NOT RUN | Upload error/retry/offline/long filename dedicated fixtures  |
| AttachmentChip doc / remove / upload progress     | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI; upload tests                   | NOT CAPTURED | NOT RUN | Upload error/retry/offline/long filename dedicated fixtures  |
| Menu + checkbox/radio/submenu                     | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI; keyboard.spec.ts               | NOT CAPTURED | NOT RUN | All nested/edge/focus-return cases still required            |
| ContextMenu + keyboard trigger                    | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI; keyboard.spec.ts               | NOT CAPTURED | NOT RUN | All nested/edge/focus-return cases still required            |
| Popover + nested form                             | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI; keyboard.spec.ts               | NOT CAPTURED | NOT RUN | All nested/edge/focus-return cases still required            |
| Dialog + actions / focus restore                  | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI; keyboard.spec.ts               | NOT CAPTURED | NOT RUN | All nested/edge/focus-return cases still required            |
| Tooltip + shortcut                                | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Segmented + disabled items                        | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Tabs + disabled tab                               | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Toggle + checked/disabled                         | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Slider single/range/vertical                      | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Section collapsible                               | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| ScrollArea keyboard viewport                      | R   | R   | R   | R   | R   | N2  | N3  | N3  | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Keyboard/state-specific screenshots not all authored         |
| Toast info/action                                 | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Live announcements, pause timers, long text and action focus |
| Toast success                                     | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Live announcements, pause timers, long text and action focus |
| Toast error / dismissal                           | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Live announcements, pause timers, long text and action focus |
| Panel / flush Panel                               | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Row / dense Row                                   | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Progress determinate / 0 / 100                    | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Progress indeterminate / running                  | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Skeleton all radii                                | R   | N1  | N1  | N1  | N1  | R   | N3  | N3  | N2  | R   | R   | R   | N4  | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Spinner / accessible loading label                | R   | N1  | N1  | N1  | N1  | R   | N3  | N3  | N2  | R   | R   | R   | N4  | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Avatar user / agent / active                      | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Pill default / live idle / active                 | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |
| Kbd shortcut label                                | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | UI                                 | NOT CAPTURED | NOT RUN | Display semantics, motion and contrast need real render/AT   |

## Workflow controls and detailed surfaces

Required scenarios below are intentionally not all executable yet. Inspect each
surface in its actual owning screen. Never apply a display component's N/A to its
interactive descendants. “Unknown” means acceptance/save outcome unknown, not
merely a disconnected icon. Do not auto-replay uncertain mutations to make a test
advance. These requirements include long filenames/unbroken text, empty selections,
locked clips, multi-selection and unavailable media as appropriate.

| Surface                                                               | D   | H   | F   | P   | X   | L   | E   | Err | O   | K   | RM  | HC  | T   | Source-tested evidence (not rerun) | Captured     | Manual  | Blocked / remaining             |
| --------------------------------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---------------------------------- | ------------ | ------- | ------------------------------- |
| File picker / drag-drop / attachment removal                          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Landing                            | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Aspect and duration desktop menus / mobile settings sheet             | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Landing                            | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Example prompt chips                                                  | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Landing                            | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Sign-in placeholder / backend quota dialog boundary                   | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Landing                            | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Privacy warning and privacy link                                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Landing                            | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Reel thumbnails / file labels / waveform                              | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Warmup                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Step progress / typed noticed label / delayed warning                 | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Warmup                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Cancel / keep going / confirmed cancellation                          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Warmup                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| FullScreenError upload retry / session retry / start over             | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Warmup                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Project title local edit / Enter / Escape / blur                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Save badge saved / pending / offline / unsaved / unknown              | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Agent status / pause / resume                                         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Undo / redo / finish eligibility                                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Agent / inspector / timeline resize / collapse / restore              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Mobile watch chat / timeline / edit tabs                              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Shortcuts help / central typing and IME guard                         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Status bar connection / proxy unknown / preview FPS unavailable       | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Shell                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Viewer transport play / pause / previous / next frame                 | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Playhead seek / speed / loop / in-out / shuttle                       | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Volume / mute / real output meter                                     | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Viewer fit / zoom / guides / AI overlay                               | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Fullscreen / Escape / renderer-unavailable fallback                   | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Overlay selection / transform handles / crop                          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| SAM target outline / mask edge controls                               | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Inline viewer title / secondary text edit / metrics pending           | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Compositor                         | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Tools select / razor / text / snapping / link                         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Track headers mute / solo / visibility / lock                         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Clip selection / keyboard move / trim / split                         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Clip drag / duplicate / ripple delete / soft locks                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Ruler / minimap / follow / scroll / zoom                              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Waveforms / filmstrips / pending media / failed decode                | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Assets drawer search / tabs / upload / replacement                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Text editor / caption lane / word timing split / merge                | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Timeline                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Project metadata / notes / background / dimensions                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Transform X / Y / scale / rotation / opacity / crop                   | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Colour grade / LUT / scope / reset                                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Effects ordered stack / enabled / numeric / keyframes                 | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Media source / trim / speed / replacement / detach audio              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Audio gain / fades / duck / keep-pitch unavailable / meter            | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Text style / font / alignment / color / animation / position          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Empty / multi-selection / locked / unknown metadata                   | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Inspector                          | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| User message / file attachments                                       | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Agent say / streaming / rich links                                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Tool action running / done / failed / duration / target               | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| SAM result / correlated target / unavailable metadata                 | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Images found / source attribution                                     | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Ask-choice / buttons / actual answer                                  | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Ask-review / finish affordance                                        | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Error message / retry boundary                                        | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Notice / summary / revert selected actual action                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Actions table filters / search / expanded JSON / scroll pinning       | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Mention textbox / clips listbox / arrow / Enter / Escape              | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Commands / plain message / pending / read / failed interrupt          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Hard pause / resume / live announcer throttling                       | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Notification permission / hidden title / native notification          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Agent                              | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Finish while acting / pause acknowledgement                           | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Review                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Poster loading / stale / unavailable / actual readback                | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Review                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Render settings / caption toggle unavailable without captions         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Review                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Keep editing / render pending / unknown approval reconciliation       | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Review                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Frame waiting / latest JPEG / bounded filmstrip                       | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Render                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Progress / timecodes / chunk sheen / reduced completion               | R   | N1  | N1  | N1  | N1  | R   | R   | R   | R   | R   | R   | R   | R   | Render                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Cancel dialog / keep rendering / unknown status check                 | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Render                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Failed job / reviewed retry / no blind reapprove                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Render                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Copy link / denied clipboard / close-tab process boundary             | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Render                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Video player buffering / seeking / ended / media error                | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Player play / volume / fullscreen / keyboard                          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Download actual filename / expired URL / missing URL                  | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Copy link / native share cancel / fallback / denied                   | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Public read-only edit / verified-owner requirement / expired edit     | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| History details / models absent / metadata unknown                    | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Delivery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| WS drop mid-edit / authoritative GET before WS                        | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Recovery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Queued unsent edits / reload / ordered flush                          | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Recovery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Acceptance-unknown ACK / failed group blocks later send               | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Recovery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| IndexedDB denied / quota / blocked / migration / second-tab ownership | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Recovery                           | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Command palette actions / clips / recent prompts                      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Cuts dropdown / immutable read-only preview / restore capability      | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Compare synchronized sources / keyboard split slider                  | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Actual beat metadata / snap toggle / unavailable detection            | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| First-visit coach marks / next / dismiss / persistence denial         | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Export 720p / webm / dual 9:16 capability boundaries                  | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |
| Actual captions SRT download / absent captions                        | R   | R   | R   | R   | R   | N2  | R   | R   | N2  | R   | R   | R   | R   | Extras                             | NOT CAPTURED | NOT RUN | Runner/manual evidence required |

## Source evidence index

Paths are relative to `apps/web/src/` unless otherwise stated. These are existing
source/test seams inspected for inventory, not reports of newly executed tests.

| Key                | Source and existing test evidence                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI                 | `components/ui/*.tsx`, `components/ui/ui.test.tsx`; gallery `app/dev/ui/page.tsx`                                                                          |
| Landing            | `components/landing/landing-page.tsx`, `.test.tsx`; `lib/uploads/landing-validation*`; `e2e/landing.spec.ts`                                               |
| Warmup             | `components/warmup/warmup-screen.tsx`, `warmup-screen.test.tsx`, `state.test.ts`; `e2e/warmup.spec.ts`                                                     |
| Shell / restore    | `components/studio/studio-shell.test.tsx`, `studio-state.test.ts`, `controls.test.tsx`; `app/studio/[sessionId]/page.test.tsx`; `e2e/studio-shell.spec.ts` |
| Compositor         | `components/studio/compositor-*.test.*`, `viewer-*.test.*`; `packages/compositor`; `e2e/compositor.spec.ts`                                                |
| Timeline           | `components/studio/timeline/timeline.test.tsx`, `gesture.test.ts`, `media-cache.test.ts`; keyboard commands under `lib/editing`                            |
| Inspector          | `components/studio/inspector/inspector.test.tsx`, numeric/transaction helpers and text-editing source/tests                                                |
| Agent              | `components/studio/agent/*test*`, `composer`, `chat-stream`, `actions-table`, `live-announcer`; `lib/agent` tests                                          |
| Review / approval  | `components/studio/review/review.test.tsx`, `lib/studio-approval.test.ts` and parent approval integration tests                                            |
| Render / lifecycle | `components/render/render-screen.test.tsx`; `lib/render/*test*`                                                                                            |
| Delivery / player  | `components/delivery/delivery-screen.test.tsx`, `video-player.test.tsx`; `lib/delivery/*test*`                                                             |
| Recovery           | `lib/editing/session*`, persistence and recovery tests; `lib/session-recovery.test.ts` active parallel owner                                               |
| Extras             | Phase 10 parallel owner; no accepted source/test result imported into this ledger                                                                          |

## Required execution, not inferred completion

- For **every** row: verify applicable state behavior, exact lowercase copy, accessible
  name and focus indication, disabled reason, one-orange-per-panel, reduced motion,
  high contrast, long content and native 200% zoom. Check tooltips expose full names
  from both pointer and keyboard. A row with N2 still needs its parent error state.
- Browser matrix is Chrome, Edge, actual Safari 18+, latest Firefox at 1920×1080,
  1440×900, 1280×800, iPad 1180×820, iPhone 390×844. Actual devices/AT remain distinct
  from viewport emulation. See [A11Y](A11Y.md) for every NOT RUN row and platform gaps.
- `state-matrix.ts` is a bounded executable subset, not an exhaustive row-to-state
  mapping. It covers default/forced gallery, landing input states, warmup failures,
  static Studio/drop/restore/review, render and delivery failures. Schema fixtures
  do not implement an engine, live mutation recovery, authentication or quota.
- Screenshot assertions are real `toHaveScreenshot` calls with project-specific
  baseline paths and updates off by default. No Phase 10 baseline was captured or
  generated. Existing compositor golden assertions remain authored only.
- Exact screen-reader output, focused dialog states, caption/timeline editing,
  transient errors, storage failures, unknown ACKs, live recovery and every extra
  remain required/blocked, not all green because a source test exists.
- Historical screenshots and bounded Phase 8 manual observations are limited
  evidence, not current regression baselines. Chat/action rehydration and repeated
  reconnects remain known observations to retest. Parent alone changes PHASE_LOG
  and acceptance. Do not use this inventory as a release certificate.
