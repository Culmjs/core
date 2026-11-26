# Stage 3 motion: owner comparison

**Owner accepted the Stage 3 motion comparison on 2026-11-24.** After receiving the desktop and phone file paths, the owner approved all three reproductions: the 500 px entrance, the pinned scroll panel, and the masked-letter entry. All frozen trajectory samples passed at both widths. This closes the motion comparison; the Stage 3c blind recreate rerun and the matched [Astro & GSAP benchmark](../comparison/README.md) are recorded and closed.

| Field plate        | 1280 × 900                                                 | 390 × 900                                                 |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| Once-only traverse | [Frames](frames/box-1280.png) · [values](#traverse)        | [Frames](frames/box-390.png) · [values](#traverse)        |
| Pinned waterline   | [Frames](frames/codepen-1280.png) · [values](#waterline)   | [Frames](frames/codepen-390.png) · [values](#waterline)   |
| Masked letters     | [Frames](frames/codrops-1280.png) · [values](#reed-ledger) | [Frames](frames/codrops-390.png) · [values](#reed-ledger) |

Left: **actual local reference captures**. GreenSock's docs snippet and orange Pen excerpt ran in the frozen reconstruction on GSAP/ScrollTrigger 3.15.0 (`13e2b79`); Codrops' _On-Scroll Typography Animations_, effect 11, ran from its pinned distribution (`af28d61`, bundled 3.11.4, fallback font). These are not captures of the deployed sites. Right: rendered [Fen Survey documents](../../packages/tools/__tests__/fixtures/motion-scenes.ts), with original Culm text, gauge and notched staff. Compact `write` inserts the marker and updates the heading; full `apply` sets motion on the panel. No injected scene CSS, replacement host, fonts or external requests.

Headless Chrome **158.0.8127.37**, 900 CSS px tall, DPR 1; phone is a viewport, not a device. Each image uses **one fixed vertical band and the full viewport width**, identical on both sides at every stop. [Frozen observations, credits and tolerances](references.md) · [executable replay, capture and preview](replay.md) · [browser assertions](../../packages/tools/__browser__/motion-references.spec.ts).

### Traverse

`Δx / viewport left`, in CSS px. Values are **reference → Culm**. At both widths the 360 × 48 staff first intersects at `scrollY=900`. The photos are at `scrollY=1200`, with the actual animation paused and sought to local time.

| Checkpoint             | Desktop               | Phone                 |
| ---------------------- | --------------------- | --------------------- |
| Before crossing; 0 ms  | 0 / 24 → 0 / 24       | 0 / −240 → 0 / −240   |
| 250 ms                 | 375 / 399 → 375 / 399 | 375 / 135 → 375 / 135 |
| 500 ms                 | 500 / 524 → 500 / 524 | 500 / 260 → 500 / 260 |
| Back to 0, cross again | 500 / 524 → 500 / 524 | 500 / 260 → 500 / 260 |

### Waterline

`panel top / painted line width`, CSS px, **reference → Culm**. After each jump, wait for rendered frames. The line's left edge stays at 240 (desktop) or 39 (phone); its height is 8. In order, measured progress on both sides is `0, .5, 1, 1, .5, 0`.

| ScrollY / direction | Desktop               | Phone                 |
| ------------------- | --------------------- | --------------------- |
| 1800 ↓ pin          | 0 / 0 → 0 / 0         | 0 / 0 → 0 / 0         |
| 2250 ↓              | 0 / 400 → 0 / 400     | 0 / 156 → 0 / 156     |
| 2700 ↓              | 0 / 800 → 0 / 800     | 0 / 312 → 0 / 312     |
| 2732 ↓ release      | −32 / 800 → −32 / 800 | −32 / 312 → −32 / 312 |
| 2250 ↑              | 0 / 400 → 0 / 400     | 0 / 156 → 0 / 156     |
| 1800 ↑              | 0 / 0 → 0 / 0         | 0 / 0 → 0 / 0         |

### Reed Ledger

Horizontal displacement / own glyph width, letters `0, 1, 2, 3; 9` in DOM order. Reference reads the transform; Culm reads the glyph's left edge relative to its mask. Both keep ten independent masks, one line and the space. Read at trigger start + 10 px (reference `10577 / 8166`, Culm `910 / 910`); **only for the photos**, center the heading and seek again (reference `11219 / 8715`, Culm `1424 / 1379`).

| Local time | Desktop reference                      | Phone reference                        | Culm desktop and phone (each measured) |
| ---------- | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| 0 ms       | 1.05 for all                           | 1.05 for all                           | 1.05 for all                           |
| 100 ms     | .52500, .70241, .93978, 1.05; 1.05     | .52500, .70241, .93977, 1.05; 1.05     | .52689, .70455, .94530, 1.05; 1.05     |
| 500 ms     | .03281, .04390, .05874, .07858; .45075 | .03281, .04390, .05874, .07859; .45075 | .03281, .04414, .05902, .07865; .45172 |
| 1378 ms    | 0 for all ten                          | 0 for all ten                          | 0 for all ten                          |

At 60 Hz the first-moving frames were **1, 3, 6, 8, 11, 13, 16, 18, 21, 23** in all four readings. Largest sampled normalized completion difference: **0.0053** (allowed 0.05). Reference and Culm lettering and paint differ. This compares the timed entry: Culm's `enter-view` holds after the first entry; the upstream excerpt also configures a backward-exit reset. It is not a port of Codrops' full trigger-action sequence.

### Shipped cost and fallback

The byte table below is the 2026-11-24 measurement; [docs/gpu/exit.md](../gpu/exit.md) holds the current figures (timeline 7,214, states 1,654), and the base script is 304 bytes ([docs/gpu/limits.md](../gpu/limits.md)).

Raw UTF-8. Base includes the joins; the test also counts the complete inline script directly in the shipped HTML. Elements are compile counts, before any optional text split.

| Live page                                     |  Base | States | Timeline |  Total JS |   CSS | Elements / depth |
| --------------------------------------------- | ----: | -----: | -------: | --------: | ----: | ---------------: |
| Traverse                                      |   305 |      0 |     8186 |      8491 |  5826 |           17 / 4 |
| Waterline                                     |   305 |      0 |     8186 |      8491 |  5961 |           22 / 5 |
| Reed Ledger                                   |   305 |      0 |     8186 |      8491 |  5946 |           15 / 4 |
| Plain control                                 |   304 |      0 |        0 |       304 |  5656 |           15 / 4 |
| CSS-only scroll                               |   304 |      0 |        0 |       304 |  5888 |           15 / 4 |
| Mixed (open + mail + states + CSS + timeline) |   688 |   2031 |     8186 |     10905 |  6152 |           18 / 4 |
| Independent ceilings                          | 10000 |   6193 | **8192** | **20000** | 16000 |        2000 / 12 |

**6 bytes remain on the timeline; 9,095 on the mixed-page aggregate** (updated after the three integration-review fixes: `host: true` on detached tier-2 load presets, ancestor `scale: 0` release via `getClientRects` on standard tracks, and `ops/plan.ts` target-move blame). Exact limits and one-byte overages are exercised by [the budget tests](../../packages/core/__tests__/compile/budgets.spec.ts). The full MCP `describe` reports the approved limits. On a valid timeline document with 350 distinct swatch styles, compilation reported `RESOURCE_LIMIT_EXCEEDED` at `css`; the actual `measure` tool returned the class 1 `invalid` finding **“css is 29851, the ceiling is 16000”**.

- Control live HTML (6,645 bytes) and whole site result matched SHA-256 baselines from the pre-motion compiler `a1ca779`. Separately, **48/48** earlier live/edit/measure/site outputs matched that revision.
- At both widths, with scripts disabled and separately with reduced motion enabled, all plates kept their headings, jump link and native disclosure in keyboard order. The link navigated and the note opened. No timeline ran, the gauge stayed full and the heading remained unsplit.
- On the CSS-only plate at half passage, native `view()` gave opacity **0.700127**. Chrome **114.0.5735.90** lacks `view()` and left the text static at **1**. For eligible unpinned scroll, opt into `scrollFallback:'timeline'` only when older engines need the scrub too; this ships the host even where native wins. The [genuine two-engine lane](../../packages/tools/__browser__/motion-inputs.spec.ts) exercises that option forward and backward.

Final review run (2026-11-24, `4195730`): **1,972 unit tests passed**, three optional/environment skips; **174 browser tests passed**, zero skipped, including the genuine 114 fallback lane. Clean install, generator drift check, types, lint, format, layers, terminology and all three package tarballs passed. All 30 trajectory diagnostic lines at the two widths matched the comparison run exactly.

Stage base: `a1ca779`. The original comparison used implementation `5d82e04` (1,966 unit and 171 browser tests passed). Comparison sheets and evidence accepted: `14e745b`; decision recorded at `1743b34`. The owner’s decision on these sheets was “yes approved move forward.” The independent 3c benchmark and matched Astro/GSAP comparison are recorded separately.

### Integration review (resolved)

All three follow-up integration cases identified during the `bb49ba0` review are now resolved and covered by regression tests:

| Case                                                                          | Resolution                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Detach a tier-2 component with a timed `load` preset while it is offscreen    | `detach` (`ops/components.ts`) emits `host: true` for tier-2 `load` presets on sequence motions; `compile/motion.ts` keeps them on tier 2. |
| Reveal an already-active state animation by releasing an ancestor’s `scale:0` | `motionHost.ts` checks `getClientRects().length` instead of non-zero rect area for non-pin/non-parts tracks so `scale: 0 → 1` activates.   |
| Move a motion target outside its owner's subtree in a compact batch           | `ops/plan.ts` tracks moved/removed targets per tree and blames `ops[1]` (`move`) with `nodeId`, `path`, and `op` when vetoed.              |
