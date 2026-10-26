# REST and WebSocket contracts

Source of truth: `packages/kimo-client/src/schema.ts`. All responses are parsed with Zod at the client boundary. All server requests are validated before mutation. See exported schemas for every property and variant.

REST: POST /v1/uploads; POST /v1/uploads/:assetId/complete; POST /v1/sessions; GET /v1/sessions/:id; POST /v1/sessions/:id/messages (202); POST /v1/sessions/:id/ops (409 on stale baseVersion); POST /v1/sessions/:id/approve; GET /v1/renders/:id; GET /v1/videos/:id. Base defaults http://localhost:8787; configurable NEXT_PUBLIC_KIMO_API.

Multipart Phase 3 extension: sizes >100 MiB return 16 MiB presigned parts, numbered from1. PUT returns exposed ETag. Complete POST body {parts:[{partNumber,etag}]} validates ordered matching parts before joining. Ordinary PUT body is bytes, never JSON. Asset IDs are available before bytes complete. Signed mock URLs live 15 minutes. Session snapshot additionally returns wsUrl and optional videoId for restore.

Minimal previously unspecified nested types: TextStyleId title|caption|lower_third; Effect {id,kind,params:Record<string,string|number|boolean>}; Keyframe {property,time,value,easing?:linear|ease_out|ease_in_out}; Transition {kind:cut|crossfade|dip,duration}; Marker {id,time,label}. Transform crop is nonnegative {l,t,r,b}. All Op variants have typed payloads, no any.

Version: every batch increments once. Gap causes GET and replacement. Optimistic edits send previous baseVersion; on409 refetch, reapply once and resubmit; a second conflict refetches and surfaces failure. Pause/resume/interrupt/ping are native WS client packets; malformed packets never mutate project state.
