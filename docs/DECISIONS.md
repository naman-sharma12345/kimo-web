# Decisions and conflicts

- Phase 0 says four sample assets but enumerates five. Ship three videos, one audio, one image. Pexels/Pixabay are not assumed CC0. Deterministic original synthetic fixtures are generated locally with FFmpeg instead; no unverified external copyright claims.
- Missing nested contract fields receive minimal explicit schemas, documented in CONTRACTS.md.
- No public preview hosting or tunnel is authorized. Browser-only acceptance is blocked until an authorized reachable URL exists. Local Playwright browsers are not installed/launched. Scripts are supplied for the owner’s environment.
- Phase 1 numeric exceptions (10px padding,22px pill, animation timing) extend named CSS tokens; components never contain raw typography/colors/timings.
- Future studio/render/delivery are honest integration placeholders, not invented product screens.

- Generated CC0 mock media are excluded from Git and recreated by `postinstall` using FFmpeg. This avoids publishing approximately 24 MB of reproducible binary test data. The generator and provenance remain versioned; FFmpeg is a system prerequisite.
- Phase 1 extra named tokens: hairline 1px, stroke 1.5px, small icon 14px, pill 22px, inset 10px, attachment name 160px, dialogs 440/560px, toast 420px, kbd 18px, toggle 28x16px. Derived colors mix existing palette tokens only. Functional overlay/floating/toast layers are 40/50/60. Gallery max-width is 1200px. Operational tooltip and toast timings are centralized in ui/tokens.ts. These are implementation defaults, not newly inferred user preferences.
- `NEXT_PUBLIC_SITE_URL` sets metadataBase. Local development defaults to http://localhost:3000; no production hostname or deployment is invented.
- Test entry point forces NODE_ENV=test because this build machine defaults to production. This is necessary for React's test act API and does not weaken assertions or change production builds.
- Global upload browser listeners and toast provider live above routes, so navigating from the landing page to warm-up does not detach offline/resume notifications or cancel transfers.
