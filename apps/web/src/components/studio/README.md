the footage is the hero; the chrome stays quiet; orange only marks what the AI is doing right now.

# Phase 5 shell integration checkpoint

Scope: static and functional shell only. No compositor, media playback loop, timeline editing, agent message sending, review submission or engine changes. The mock records action history for REST restore. Existing authoritative REST route redirects/errors remain intact; restore-boundary mounts StudioShell and restores the original prompt.

## Public contracts

- `StudioShell` / `StudioShellProps` from `studio-shell.tsx`: requires `sessionId` and validated `SessionSnapshot`; optional `originalPrompt`, `userKey`, `slots`, `commands`, `subscribe`.
- `StudioSlots` from `panels.tsx`: `viewer`, `transport`, `timeline`, `timelineFooter`, `inspector`, `agentChat`, `agentActions`, `composer`. Each accepts ReactNode. A provided slot replaces only its named boundary, not surrounding layout.
- Phase 6 can provide `viewer` and optional `transport`, consume `useStudio` transport intent (`playing`, `playhead`, `duration`, `loop`, `volume`, `speed`, `shuttle`, in/out points), and publish actual compositor FPS through `previewFps`. `seek` clamps seconds to the known duration. No synthetic clock advances the preview.
- Phase 7 can provide timeline/inspector slots, consume `selection`, `tool`, `snapping`, `linked`, `zoom`, `followKimo`, and supply undo/redo plus `commands.keyboard(id)` handlers. Return true when a custom keyboard command was consumed; undefined/false falls through to shell handling.
- Phase 8 can provide chat/actions/composer slots. Set `subscribe={false}` when Phase 8 takes ownership of WebSocket lifecycle. Feed parsed `ServerEvent`s to `useStudio.getState().receive(event)` and reconcile ops through the existing project store. Do not open two live subscribers.
- `StudioCommands` from `top-bar.tsx`: `pauseAgent`, `fullscreen`, optional `finish`, `undo`, `redo`. Shell supplies typed pause/resume dispatch and shell-only browser fullscreen fallbacks. Finish fallback explicitly identifies the Phase 9 boundary.
- `studioShortcuts`, `matchStudioShortcut`, `registerStudioKeyboard` in `lib/keyboard.ts` are the central help/dispatch registry. Existing landing attachment shortcut is preserved. Inputs, selects, nested contenteditable and IME composition are guarded. Only Command/Control K, Command/Control Enter and Escape work while typing.
- `useStudio`, exported state/types, `responsiveSizes`, `clampPanel`, `readPreferences` in `stores/studio.ts`. Versioned layout key: `kimo-studio:v1:<userKey>`. Until an authenticated identity is available, default is the explicit browser-profile namespace; parent should supply the real user key later.
- `timecode(seconds, fps)` from `transport.tsx` formats actual frame positions.

## Decisions for parent to copy to DECISIONS.md

- Preserve shared design tokens and all existing UI components; new exact Phase 5 geometry and specified timing exceptions are local CSS semantic variables. Unspecified acting/progress motion reuses the existing UI 1.2-second agent cadence. Specified thinking cycle is 2.4 seconds and resizer delay 150ms. Inspector overlay uses the existing shadow-pop. Body/metadata use the closest t-13/t-12 tokens; boundary annotations are t-12 cream-38.
- Snapshot schema has no title or title-update op. Inline title is explicitly device-local at `kimo-studio-title:v1:<sessionId>`; tooltip says so. It is not claimed server-persisted.
- `SessionSnapshot.actionIds?: string[]` optionally supplies server-recorded unique `agent.action.start` IDs. The mock records them when emitting starts and returns them through REST, including actions emitted without a connected subscriber. After resetting a session, Studio hydrates only `snapshot.actionIds ?? []`, then deduplicates subsequent live starts against that history. Supplied history preserves the action count and finish eligibility on reload. Legacy snapshots or an empty history retain zero actions and disabled finish until a live start arrives, regardless of project version or review status. No IDs or counts are inferred from project operations.
- FPS, latency and proxy readiness are unknown until actual measurements exist. UI says `preview fps unavailable`, `proxies unknown`, latency unavailable. Session duration in status is time in this visit, not invented server session age.
- Protocol has pause/resume commands but no acknowledgement or paused server state. Pill records the dispatched local pause intent; a later server status supersedes it. No fake backend acknowledgement.
- The spec assigns L to both shuttle and loop. The central registry gives L to shuttle; loop remains a keyboard-reachable button rather than registering a conflicting shortcut.
- Phase 6 owns actual guides/AI overlay drawing and zoom effects; shell currently holds their control state as panel-local data attributes. Phase 7 owns track contents, horizontal minimap interaction, editing and pinch zoom. Phase 8 owns message sending and attachments. All unavailable operations are disabled or labelled with their phase boundary.
- Follow-kimo toggle is state only in this phase; no invented property-touch stream. Inspector title reflects real selected project clips/assets; default project metadata is read-only.

## Verification and remaining gate

Focused tests cover optional snapshot backward compatibility, actual mock REST action history (including disconnected emission and client-op non-inference), restored finish eligibility with exact supplied IDs, legacy/empty-history safety, live replay deduplication, REST restoration, panel collapse/persistence/reset, keyboard resizer movement, title save/cancel, exact leave dialog, typed subscription/pause/resume/review pulse, transport intent, typing guards, no conflicting keyboard chords, corrupted/denied storage, action deduplication and slot replacement.

`e2e/studio-shell.spec.ts` is a prepared bounding-box test, NOT executed here. It requires `STUDIO_TEST_PATH` for an existing restored editing session, and checks all six boxes within 1px at 1920/1440/1280 plus watch mode at 390. Parent owns all browser execution and screenshots. No pixel, rendered accessibility, screenshot or visual pass is claimed. No commits/pushes performed.
