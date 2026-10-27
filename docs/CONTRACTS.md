# REST and WebSocket contracts

Source of truth: `packages/kimo-client/src/schema.ts`. All responses are parsed with Zod at the client boundary. All server requests are validated before mutation. See exported schemas for every property and variant.

REST: POST /v1/uploads; POST /v1/uploads/:assetId/complete; POST /v1/sessions; GET /v1/sessions/:id; POST /v1/sessions/:id/messages (202); POST /v1/sessions/:id/ops (409 on stale baseVersion); POST /v1/sessions/:id/approve; GET /v1/renders/:id; GET /v1/videos/:id. Base defaults http://localhost:8787; configurable NEXT_PUBLIC_KIMO_API.

Multipart Phase 3 extension: sizes >100 MiB return 16 MiB presigned parts, numbered from1. PUT returns exposed ETag. Complete POST body {parts:[{partNumber,etag}]} validates ordered matching parts before joining. Ordinary PUT body is bytes, never JSON. Asset IDs are available before bytes complete. Signed mock URLs live 15 minutes. Session snapshot additionally returns wsUrl and optional videoId for restore.

Minimal previously unspecified nested types: TextStyleId title|caption|lower_third; Effect {id,kind,params:Record<string,string|number|boolean>}; Keyframe {property,time,value,easing?:linear|ease_out|ease_in_out}; Transition {kind:cut|crossfade|dip,duration}; Marker {id,time,label}. Transform crop is nonnegative {l,t,r,b}. All Op variants have typed payloads, no any.

Version: every batch increments once. Gap causes GET and replacement. Optimistic edits send previous baseVersion; on409 refetch, reapply once and resubmit; a second conflict refetches and surfaces failure. Pause/resume/interrupt/ping are native WS client packets; malformed packets never mutate project state.

## Optional session action history (Phase 5 restore)

`SessionSnapshot.actionIds?: string[]` contains unique server-recorded `agent.action.start.id` values for that session. IDs are nonempty strings using the existing ID schema. This is recorded action history, not a count or IDs inferred from `project.version`, `project.ops.actionId`, review status, or project contents. Servers supplying the field must record each unique start ID when emitting the event, including when no client is connected; the mock stores it in its in-memory session snapshot and includes it in GET /v1/sessions/:id. This does not add disk persistence across mock restarts. Client-originated op batches do not add IDs.

The field is optional for backward compatibility: older snapshots still validate without it, and omission is not converted into fabricated history. Studio resets session state, hydrates `snapshot.actionIds ?? []`, and deduplicates incoming live starts against those IDs. A nonempty supplied history preserves action count and finish eligibility on reload; an omitted or empty history leaves finish disabled until an actual start arrives. No event replay or new endpoint is required.
