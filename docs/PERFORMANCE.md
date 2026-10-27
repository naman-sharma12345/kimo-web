# JS budgets: PASS

Build: IK2U9ZYn_I2G930stt-S8; Node v24.22.1; zlib 1.3.2.1-motley-285e94b.
decimal KB; independent gzip level 9; modern effective initial JS including all framework/runtime/shared and required automatic imports; conditional nomodule polyfills separately reported; external JS only

| Route               | Initial gzip bytes | With conditional polyfills | Limit bytes | Status |
| ------------------- | -----------------: | -------------------------: | ----------: | ------ |
| /                   |             115339 |                     154859 |      120000 | PASS   |
| /studio/[sessionId] |             366034 |                     405554 |      450000 | PASS   |

## Required automatic imports charged to effective initial JS

- /studio/[sessionId]: non-public-interactive-providers; app/providers.tsx -> ./interactive-providers; additional 2438 gzip bytes (static/chunks/4005.fdb9698157a52b49.js).

## Actual independently gzipped files

| File                                                               | Raw bytes | Gzip bytes |
| ------------------------------------------------------------------ | --------: | ---------: |
| static/chunks/1349-0091f8632134397a.js                             |    174607 |      46454 |
| static/chunks/1542-e03453c0e8735fc8.js                             |     19143 |       5725 |
| static/chunks/1586-ccf6d90d32b6e2c6.js                             |      5055 |       2242 |
| static/chunks/259.d08cec65f5e37ed4.js                              |       226 |        185 |
| static/chunks/3082.9bc7717d705fb84a.js                             |    932581 |     276551 |
| static/chunks/3192-2378f438083c20c4.js                             |     18682 |       6808 |
| static/chunks/3266-a152aac1ab706d9b.js                             |     15135 |       5726 |
| static/chunks/3461-e929cc39055d2d86.js                             |     14287 |       4549 |
| static/chunks/3700-1e43c2c7ba866773.js                             |      7983 |       3379 |
| static/chunks/3701-23859b543accb523.js                             |     18551 |       6705 |
| static/chunks/3798.e42f1452e31e35ba.js                             |     30054 |      10359 |
| static/chunks/3897-04c034bd59171160.js                             |     93673 |      28952 |
| static/chunks/3948.c6ba6c7cb5063f8e.js                             |     12173 |       4740 |
| static/chunks/3988-5bc2b3c9b51acb8b.js                             |     19390 |       6844 |
| static/chunks/4005.fdb9698157a52b49.js                             |      5164 |       2438 |
| static/chunks/4445-0aa4baca2ef3870e.js                             |      8560 |       3405 |
| static/chunks/4485-2e6990bccfd03921.js                             |     22151 |       6913 |
| static/chunks/4503-73dc63f5f706c6d7.js                             |     36086 |      11855 |
| static/chunks/4959-11ccb12ca147e17e.js                             |     58764 |      20358 |
| static/chunks/5107.642f139269d92639.js                             |       393 |        255 |
| static/chunks/5856-a29f50d2d2b8eb31.js                             |     16782 |       5896 |
| static/chunks/592-72a7deeea26cfa43.js                              |    131763 |      43646 |
| static/chunks/6386.fcbe780fde00b271.js                             |      3944 |       1904 |
| static/chunks/6579-c53d2c46e0a3d6fb.js                             |     57388 |      12986 |
| static/chunks/7816-db32f146903ab93f.js                             |     19854 |       6839 |
| static/chunks/8776-17d4efa318d1ad5c.js                             |    241633 |      73824 |
| static/chunks/9825-18fd9a6b0cb58dc3.js                             |     16308 |       5824 |
| static/chunks/app/error-057a300219d42689.js                        |       629 |        420 |
| static/chunks/app/layout-1906bd5e5f76097a.js                       |      2242 |       1113 |
| static/chunks/app/not-found-5d8df438177a3b68.js                    |       195 |        169 |
| static/chunks/app/page-571fda56b7845b68.js                         |     18395 |       6640 |
| static/chunks/app/studio/[sessionId]/error-7bbd9e7b9f52ef43.js     |       382 |        284 |
| static/chunks/app/studio/[sessionId]/not-found-b013140a66ce6a06.js |       316 |        198 |
| static/chunks/app/studio/[sessionId]/page-b44f80a8f642c5e7.js      |      2083 |       1069 |
| static/chunks/b9a823c8-2459e67bea1682bc.js                         |    173023 |      54247 |
| static/chunks/main-app-ef238f61b7bfc597.js                         |       572 |        236 |
| static/chunks/polyfills-42372ed130431b0a.js                        |    112594 |      39520 |
| static/chunks/webpack-e63364b57835924c.js                          |      5485 |       2655 |

Deferred candidate inventory: 299719 gzip bytes.

- Manifest estimate, not a navigation trace or source-freshness proof.
- Boundary assets conservatively included; conditional nomodule polyfills reported separately, not fetched by the specified modern browser matrix; inline HTML/RSC, CSS, fonts and media outside gate.
- Deferred inventory is loadable-manifest candidates, not proof of all Webpack async requests or warmup preload.
- JS budgets do not establish LCP, INP, CLS, FPS, memory, browser or AT acceptance.

## Scope and reproduction

Measured 2026-10-27 from the completed local production build after stable lint, strict TypeScript and 1,114 unit tests; one live contract test was skipped. Run `pnpm build`, then `pnpm budgets` or `node scripts/budget-check.mjs --build-dir apps/web/.next --json quality-reports/budget.json --markdown quality-reports/budget.md`. Run `pnpm test:budgets` for the 43 accounting/negative tests. CI builds the current source and fails on missing manifests, malformed mappings or over-budget totals.

The landing reduction is from 236,384 to 115,339 modern effective initial gzip bytes. Full landing interaction loads only after a real gesture, not idle/mount; input, selection, files and composition are preserved. This shifts real work to interaction rather than proving its latency. No network trace, LCP, INP, CLS, GPU FPS, memory or device acceptance was captured. The required analyzer/size-limit packages conflict with the no-additional-dependencies rule; this report uses existing Node/zlib and actual Next manifests instead and does not claim those named tools ran.
