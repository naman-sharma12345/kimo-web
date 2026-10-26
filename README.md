# kimo web

Phases 0 through 4 of the supplied specification. Future Studio, rendering UI and delivery UI are intentionally not implemented.

## Run

Node 22+, pnpm 9.x and FFmpeg on PATH for synthetic mock fixtures. `corepack prepare pnpm@9.15.9 --activate`, `pnpm install`, `pnpm mock` (8787), and in another terminal `pnpm dev` (3000). Copy `.env.example` to `apps/web/.env.local` if needed. `pnpm mock:demo` prints a real scripted WebSocket session.

## Check

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`. `pnpm e2e` and `pnpm shots` require a user-authorized browser-test environment and Playwright installation. Set `PLAYWRIGHT_BASE_URL` for a reachable preview. Browser checks have not run in the implementation environment. See docs/PHASE_LOG.md.

## Mock

`MOCK_SPEED=2 pnpm mock`, `MOCK_FAIL=upload|ws|render pnpm mock`. Upload bytes stay on disk in ignored `.mock-data`. Deterministic original fixtures generate on install when FFmpeg is available. No engine repository is accessed.
