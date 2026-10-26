# Design bible

Extracted verbatim from the supplied Phase 0 PDF, including layout line breaks.

0.1 What kimo web is (product summary — memorise it)


kimo web lives at app.getkimo.tech (the marketing site stays at getkimo.tech). A user:

    1. Lands on a calm, beautiful page with one headline, one line of subtext and one big chatbox.
       They type what video they want and can attach videos, images, audio, PDFs and other files.
    2. Presses send. A warm-up screen with small, precise animations plays while uploads finish and
       the AI director (Muse Spark 1.3 on Meta Model API) studies the footage.
    3. The Studio opens: a live editor with a preview viewer, a multi-track timeline, tool panels, an
       inspector and the agent panel. Every move the AI makes (cut, trim, caption, colour grade, SAM
       3.1 subject mask, reframe, image found on the web, music, transition) appears instantly in
       the viewer and timeline. There is no "render to see" step: the preview is composited live in
       the browser from the project state.
    4. The user can, at any time: type into the agent chat to interrupt and redirect the AI; edit any
       text themselves (every caption, title, lower third, every word); scrub, play and pause the
       preview; undo.
    5. When the AI thinks it is done, it says so and asks the user to play it. The user either asks for
       changes or approves.
    6. On approval, a render screen animates while the server renders the final 1080p MP4 with the
       kimo engine.
    7. A delivery page shows the finished video in a player with a download button, plus share and
       "make another" actions.

There is no Muse Image (not available in India). Images the user does not provide are found by the AI
through web image search and shown in an "Images found" tray with source attribution.




0.5 Design tokens (put in                                  src/styles/tokens.css inside                      @theme, exactly)

Colour


 Token           Value                                                                 Use

  --ink-0              #080809                                                                    app canvas, viewer surround,
                                                                                                           landing background

  --ink-1              #0E0E0F                                                                    panels

  --ink-2              #151516                                                                    raised rows, inputs, clip
                                                                                                           bodies, chatbox body

  --ink-3              #1D1D1E                                                                    hover on ink-2, selected row

  --ink-4              #262627                                                                    pressed, active segmented
                                                                                                           item

  --line               rgb(245 241 231 / 0.07)                                             hairlines

  --line-              rgb(245 241 231 / 0.12)                                             input borders, focus-adjacent
 strong                                                                                                    borders

  --cream-100          #F5F1E7                                                                    primary text, active icons

  --cream-60           rgb(245 241 231 / 0.60)                                             secondary text

  --cream-38           rgb(245 241 231 / 0.38)                                             labels, placeholders, tertiary

  --cream-16           rgb(245 241 231 / 0.16)                                             disabled text, ruler minor
                                                                                                           ticks

  --orange             #FF5A24                                                                    NOW / primary action only

  --orange-            #FF6D3D                                                                    hover on orange buttons
 hover

  --orange-            #E84E1B                                                                    pressed
 press

  --orange-12          rgb(255 90 36 / 0.12)                                                wash behind the running
                                                                                                           agent action

  --orange-24          rgb(255 90 36 / 0.24)                                                SAM mask fill in viewer

  --on-orange          #140A05                                                                    text on orange buttons

  --success            #3DD68C                                                                    upload done tick, render
                                                                                                           complete tick only

  --warning            #F5B14C                                                                    file too large, slow network

  --error              #E5484D                                                                    failed action rule, error text

  --focus-             0 0 0 2px var(--ink-0), 0 0 0 4px rgb(245 241 231 /                                 every focus-visible
 ring                 0.55)

 Track tints                                                                                       clip bodies; never orange





                                                                                                                                                  5
 Token           Value                                                                 Use

                   video   #3A3833, broll   #34383A, image     #36343A, music
                    #33382F, voice    #3A3530, sfx    #38353A, text    #2F3036, fx
                    #383338

Two allowed gradients only: (a) the landing "horizon" glow (§Phase 2), (b) the render progress
sheen (§Phase 9). Nothing else.

Type

     • Families:   --font-sans: "Geist", ui-sans-serif, system-ui;                  --font-mono: "Geist Mono", ui-
       monospace;     --font-display: "Instrument Serif", Georgia, serif (italic only).
     • Scale (size / line-height / letter-spacing / weight):
             ◦  --t-11: 11px / 16px / +0.06em / 500, uppercase — labels
             ◦  --t-12: 12px / 16px / 0 / 400 — secondary
             ◦  --t-13: 13px / 20px / 0 / 400 — body in app
             ◦  --t-15: 15px / 22px / -0.005em / 500 — panel titles, buttons-lg
             ◦  --t-17: 17px / 26px / -0.01em / 400 — landing subtext, chatbox input
             ◦  --t-20: 20px / 28px / -0.01em / 500 — mono timecode, dialog titles
             ◦  --t-28: 28px / 34px / -0.02em / 500 — delivery title (sans)
             ◦  --t-display:     clamp(44px, 6.2vw, 88px) / 0.98 / -0.035em / 400 — landing headline
               (sans part)
     • Numbers in the app always           font-variant-numeric: tabular-nums.
     • Weights allowed: 400, 500. (600 nowhere. Bold nowhere.)

Space, size, radius

     • Spacing scale (px): 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128. Nothing else.
     • Radii:   --r-4 4 (tags),    --r-6 6 (clips),     --r-8 8 (rows, small buttons, inputs),          --r-12 12
       (panels, cards, menus),        --r-20 20 (chatbox),       --r-pill 999 (pills, LIVE badge, attachment
       chips only).
     • Control heights: 24 (xs), 28 (sm), 32 (md, default in app), 40 (lg), 48 (chatbox send button).
     • Icon sizes: 14, 16, 20.

Elevation

     • No shadows except         --shadow-pop: 0 12px 32px -8px rgb(0 0 0 / 0.6), 0 0 0 1px var(--line-
       strong) for popovers, menus, dialogs, toasts.
     • Viewer frame:      inset 0 0 0 1px rgb(245 241 231 / 0.06).

Motion (in       src/lib/motion.ts, export these and use nothing else)


 Name              Value

 --dur-1            90ms (hover, press colour)

 --dur-2            140ms (small moves, value tween)

 --dur-3            220ms (panels, popovers, chips enter)

 --dur-4            360ms (page sections, dialogs)

 --dur-5            640ms (screen transitions)




                                                                                                                               6
 Name              Value

 --ease-out          cubic-bezier(0.22, 1, 0.36, 1)

 --ease-in-out       cubic-bezier(0.65, 0, 0.35, 1)

 --ease-in           cubic-bezier(0.55, 0, 1, 0.45) (exits only)

 spring.snappy       { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } (clips sliding, chips)

 spring.soft         { type: "spring", stiffness: 260, damping: 32 } (panels)

Reduced motion: all translate/scale animations become opacity-only fades of               --dur-2; looping
animations stop on their first frame; the warm-up and render scenes switch to their static variants
(described in those phases).


0.6 The kimo mark


Create  public/brand/kimo-mark.svg: a 24×24 viewBox mark made of four vertical fully-rounded
bars (widths 3px, gaps 2.5px, heights 10, 16, 12, 7, bottom-aligned at y=19), colour               currentColor,
plus a 1.5px vertical playhead line crossing the third bar at x=15, with a 4px downward
triangle on top at y=3. The mark is used ONLY: top-left of the landing nav (20px), studio top bar
(16px), favicon, delivery page footer (14px). Never as a watermark, never repeated.

Wordmark: the word      kimo in Geist Sans 500, letter-spacing -0.02em, lowercase, cream-100.




One orange rule: Orange (--orange #FF5A24) means "the AI is doing this right now" or "the one primary action". At most ONE orange element per panel at a time. Never use orange for decoration.
