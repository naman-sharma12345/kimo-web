# Temporary synthetic frontend preview

This is a disposable frontend test environment, not a deployment or engine test.
The parent owns review, the full four project gates, publishing source, and dispatch.
No commit, push, or workflow dispatch is performed by the preview implementation.

## Run and find the URL

After reviewed source is published, open **Actions > Temporary synthetic frontend
preview > Run workflow** and select the reviewed ref. There are no push, pull
request, scheduled, or recurring triggers. The workflow requests only
`contents: read`, and checkout does not persist its token.

The start step launches the supervisor under `nohup`, with stdin closed and both
output streams redirected to a runner-local `preview.log`. It polls readiness for
at most five minutes. After local frontend HTTP, public mock/frontend HTTP and DNS
checks pass, the supervisor atomically writes a validated `url.json`:

```json
{
  "url": "https://<new-host>.trycloudflare.com",
  "expiresAt": "<ISO timestamp>"
}
```

The next step uploads **only `url.json`** as artifact **`kimo-test-preview-url`**,
with one-day retention, **before the bounded hold step**. Retrieve that artifact
from the active workflow run using GitHub's artifact list/download operations.
Upload-artifact v4 makes it available as soon as the upload step completes; do not
wait for the job to finish. No logs, environment, PID files, or binary are uploaded.
The host must be a single valid lowercase nonce label on exactly
`trycloudflare.com`, HTTPS only, with no port, credentials, path, query, fragment,
or whitespace. The local readiness file is checked again before upload.

The machine marker `KIMO_TEST_PREVIEW_URL=https://...` is also emitted by the
start step after validation, and the URL is appended to the summary as secondary diagnostics;
neither log APIs nor a completed-job summary are required for live retrieval.
The hold step polls the wrapper's exit-code file because the service is not its
shell child. Every loop is bounded; failure/cancellation traps and an `always()`
cleanup step terminate the supervisor. All background descriptors are redirected,
so the start step does not retain a live stdout pipe.

The gateway stops no later than 15 minutes after it starts, including warmup.
Startup has a separate five-minute deadline, and the entire job has a 30-minute
hard limit. Normal expiry exits successfully. Canceling the job sends termination;
the supervisor closes sockets and sends TERM, then KILL to all child process
groups. Temporary data is removed. Runner teardown is the final cleanup boundary
if a supervisor is forcibly killed. Dispatch again for a new URL and fresh data.

## Scope and security

- Ubuntu runner, Node 22, pnpm 9.15.9, frozen lockfile, dev dependencies, FFmpeg,
  and the existing postinstall-generated synthetic fixtures. No dependency change.
- Official cloudflared 2026.10.4 Linux amd64 download, verified against
  `ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42`.
  The executable stays in runner temporary storage. No tunnel account or token.
- Only the gateway at loopback 3105 is tunneled. Next binds loopback 3106; the
  synthetic mock binds loopback 8790. The gateway forwards to fixed local ports,
  never a caller-provided destination. Child environments are explicitly
  allowlisted, and Next environment files cause startup to be refused.
- Known frontend pages, required public assets and Next static assets only.
  Hidden paths, encoded/traversal paths (except encoded dynamic-route brackets
  in public Next static assets), workspace/source paths, arbitrary `/api`,
  dev pages and Next image fetching are denied. Exact synthetic REST methods and
  session websocket paths are allowlisted. No engine, providers, external backend,
  Eden gateway, credentials or inherited application configuration.
- Mock JSON and websocket payload URLs are rewritten to the public same-origin
  `/mock-api` namespace. HTTP authentication/cookie and proxy headers are not
  forwarded. The parent-owned `KIMO_API_INTERNAL_URL` support is used with
  `http://127.0.0.1:3105/mock-api`, not the raw mock, so SSR uses local networking
  while returned media and websocket URLs remain public. No edit to `api.ts` is
  owned by this implementation. If that coordinated change is not merged, SSR
  falls back to the public base; readiness checks DNS first, but SSR would again
  depend on public DNS and tunnel availability.
- Request bodies are capped at 32 MiB, including chunked uploads. Oversized
  Content-Length is rejected before contacting an upstream; streaming overrun
  returns HTTP 413 and destroys the upstream without forwarding above the cap.
  This permits 16 MiB mock upload parts and the synthetic fixtures.
- The URL is public and unauthenticated. Use only synthetic media and prompts.
  Shared mock sessions/uploads are temporary but not private or user-isolated.
  This is not a security sandbox for arbitrary untrusted traffic or real files.

## Evidence and limits

Focused tests cover route allowlisting/denials, method restrictions, URL rewriting,
clean environment keys, strict artifact URL validation including injection attempts,
local HTTP denial, real synthetic session creation and websocket bridging. Importing the supervisor starts no processes or listeners;
only its CLI entrypoint starts the preview. The workflow executes these tests
before serving. Local tests do not establish GitHub runner provisioning, release
availability, tunnel uptime, browser navigation, SSR restoration, or a real engine
render. The parent must verify the four full gates and run managed-browser checks
against the new readiness-marked URL. No local browser or Playwright is used here.

Synthetic file responses support single byte ranges, suffix ranges and HEAD for
seekable fixture/upload playback. Multiple or unsatisfiable ranges return 416.
The public host still exposes only the exact synthetic fixture filename list,
including the original ellipse luma mask and identity LUT; it does not accept
caller-selected file paths. These are test fixtures, not SAM inference output.
