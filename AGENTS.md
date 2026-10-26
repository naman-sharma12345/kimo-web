# Project implementation rules

    1. No improvising. If a value (color, size, radius, spacing, duration, easing, copy) is written here,
       use exactly that value. If something is not specified, pick the closest existing token from               docs/
       DESIGN.md and write a line in      docs/DECISIONS.md saying what you chose and why. Never invent
       a new color, font, font size, radius, shadow or easing curve.
    2. No extra libraries beyond the ones listed in Phase 0's stack table. If you think you need one,
       write it in docs/DECISIONS.md as a proposal and continue without it.
    3. Only tokens. Never hard-code a hex value, px font size or duration inside a component. Use
       the CSS variables / Tailwind theme tokens defined in Phase 0 (            --ink-0,    --cream-100,    --
       orange,   --dur-2,    --ease-out, etc.).
    4. Copy is exact. Every user-facing string written in quotes in these prompts is final. Use it
       character for character, including lowercase "kimo". Never write "Kimo" with a capital K in UI
       text.
    5. One orange rule. Orange (         --orange #FF5A24) means "the AI is doing this right now" or "the
       one primary action". At most ONE orange element per panel at a time. Never use orange for
       decoration.
    6. No: gradients (except the two named exceptions in DESIGN.md), glassmorphism, drop
       shadows (except the named          --shadow-pop), emoji in UI, stock illustrations, lorem ipsum,
       purple, neon, glow effects, rounded-full buttons except where named, bouncy overshoot
       springs except where named.
    7. Accessibility is not optional: every interactive element is keyboard reachable, has a visible
       focus ring (  --focus-ring), and has an accessible name. Respect              prefers-reduced-motion
       (every animation has a reduced variant listed in DESIGN.md §Motion).
    8. TypeScript strict. No       any. No   // @ts-ignore. ESLint and Prettier must pass with zero
       warnings.
    9. Finish the phase completely before stopping. At the end, run                 pnpm lint && pnpm typecheck
       && pnpm test && pnpm build. All must pass. Then fill in the "Acceptance checklist" at the end of
       this document in     docs/PHASE_LOG.md, ticking each item honestly, with a screenshot path for
       each visual item (   docs/screens/phase-XX-*.png, captured with the Playwright script from Phase
       0).

10. Do not touch the kimo engine repo or any backend code outside apps/web and packages/*
listed in Phase 0. The backend is reached only through the typed client in packages/kimo-
client. 11. Skills. The agent skills installed in Phase 0 (listed in docs/SKILLS.md) are for craft, quality and
review. Use the ones named under "Skills to load" in this phase. If a skill suggests a different
look (new fonts, colors, bolder layout), this spec wins, always. Skills never override a written
value.

                                                                                                                         1

12. If an instruction in this phase seems to conflict with an earlier phase, this phase wins for the
parts it names; everything else from earlier phases stays.

Design: [docs/DESIGN.md](docs/DESIGN.md)
Commands: `pnpm dev`, `pnpm mock`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, `pnpm shots`.
