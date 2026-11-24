# Motion reference and byte-budget proposal

**Owner decision requested:** the three excerpts and tolerances below, a **3,800-byte timeline ceiling**, and whether motion work may start given the outstanding Stage 3c decision. None is signed off. Record the owner's accepted values or replacements before Task 2 or any tuning.

## How to read the checkpoints

Measured 2026-11-23 (Eastern time), **before** implementing Culm motion. Fresh headless Chrome 158.0.8127.37 pages, `1280 × 900` desktop and `390 × 900` phone-sized CSS viewports, DPR 1, zoom 100%, LTR, no reduced motion. “Phone” is viewport emulation, not a physical device. The readings are DOM properties of the **reference code**, not screenshots, human preference scores, or results from the byte spike. Normal tests should compare Culm with the recorded numbers offline, never load these sites or use Culm to generate its own expectations.

For timed samples, cross the trigger by scrolling down, leave scroll still, and sample at a known local animation time. Reference time was set on the upstream tween (`animation.pause().time(seconds)`); use a controlled clock in Culm. Frame `n` means `n / 60` seconds from onset. For scroll samples, jump without smooth scrolling, update the trigger, then wait two animation frames for layout. Use fresh pages for each scene and viewport.

**Proposed tolerances:** ±2 CSS px for positions and lengths, ±0.05 for normalized progress, ±1 captured frame (16.67 ms at 60 Hz) for onset. Compare the eased position at the specified time, not a frame taken at an unknown time near it. Re-entry behavior, release direction, masking, reading order and completed text must agree. **Accepted tolerances: pending.**

### 1. Box: enter once, travel 500 px

[GSAP ScrollTrigger, Simple example](https://gsap.com/docs/v3/Plugins/ScrollTrigger/#simple-example), v3.15 docs: `.box` is its own trigger, `x: 500`, no explicit duration or ease. The source is a snippet, not a recorded page; the docs expose no immutable page revision. Ran that snippet against [GSAP and ScrollTrigger 3.15.0, revision `13e2b79`](https://github.com/greensock/GSAP/tree/13e2b790546426a1a2e0e9b409f3f8dc6d6611f2/dist). The [defaults](https://github.com/greensock/GSAP/blob/13e2b790546426a1a2e0e9b409f3f8dc6d6611f2/src/gsap-core.js#L1092) matter: half **time** is 75% of the trip, not 250 px.

Capture layout, also proposed for Culm: a `360 × 48` block at document `y = 2H` (`H` = viewport height), no body margins, more than one viewport of content after it, horizontal overflow clipped. Draw original reed notches on the block. Start its left edge at `24px` on desktop and `−240px` on phone so part of the long marker remains visible throughout the 500 px trip. Trigger = block top crossing viewport bottom; from above, jump to `scrollY = H + 300`. Read the x translation and `getBoundingClientRect().left`.

| Reference reading (CSS px)                     | 1280 × 900: Δx / left | 390 × 900: Δx / left |
| ---------------------------------------------- | --------------------- | -------------------- |
| Before crossing / at tween time 0              | 0 / 24                | 0 / −240             |
| 250 ms (frame 15)                              | 375 / 399             | 375 / 135            |
| 500 ms (frame 30)                              | 500 / 524             | 500 / 260            |
| Resume settled tween, scroll to 0, cross again | 500 / 524             | 500 / 260            |

At both widths the trigger started at `scrollY = 900` and the tween lasted `0.5 s`. On re-entry we read the settled translation after two frames; a restart would be near the start and fails. The 500 px and entry instruction come from the docs; the marker artwork/layout is Culm's choice.

### 2. Pinned panel: scrub, release, reverse

[GreenSock, Scrub animations, Pen `WNvVOWw`](https://codepen.io/GreenSock/pen/WNvVOWw). Use **orange panel `.orange`, `.line-2` only**. The [Pen JS](https://codepen.io/GreenSock/pen/WNvVOWw.js) sets `scrub: true, pin: true, start: "top top", end: "+=100%"`; the line grows from `scaleX: 0`, left-center origin, `ease: "none"`. The [CSS](https://codepen.io/GreenSock/pen/WNvVOWw.css) caps its width at 800 px. Pen ID is stable but editable; no immutable revision or verified deployed GSAP version was available. Fingerprint of the observed `gsap.from(".line-2", …);` block (UTF-8, remove whitespace, SHA-256): `ac99678e1dd992d3f6f19a7b3b9bdb81e4f6ae2a24076dd5431d5d7a13736d38`.

**Observed in a reconstruction:** the full public Pen page returned a challenge. Ran the orange JS excerpt against the same pinned 3.15.0 runtime as scene 1, on a marginless page with two `100vh` spacers, a centered line in a `100vh` panel, then two `100vh` spacers. Use original Culm text (“Waterline”) and a straight gauge, `height: 8px; width: min(80vw, 800px)`. That line width is fixture geometry; it is not a claim about the live Pen's paragraph or global CSS. Let `S = 2H`; scroll in the order shown:

| Checkpoint              | 1280 × 900: scrollY / panel top / line width | 390 × 900: scrollY / panel top / line width | Line progress |
| ----------------------- | -------------------------------------------- | ------------------------------------------- | ------------- |
| Start `S`               | 1800 / 0 / 0                                 | 1800 / 0 / 0                                | 0             |
| Half `S + H/2`          | 2250 / 0 / 400                               | 2250 / 0 / 156                              | 0.5           |
| End `S + H`             | 2700 / 0 / 800                               | 2700 / 0 / 312                              | 1             |
| Beyond end `S + H + 32` | 2732 / −32 / 800                             | 2732 / −32 / 312                            | 1             |
| Back to half            | 2250 / 0 / 400                               | 2250 / 0 / 156                              | 0.5           |
| Back to start           | 1800 / 0 / 0                                 | 1800 / 0 / 0                                | 0             |

Panel top and line width are directly read bounding rectangles (CSS px). The line's viewport left stayed `240 / 39` at **every** stop. Progress is calculated as measured width divided by the settled width. Checking both rectangles catches an animation that grows correctly but never pins, releases, or holds its left edge.

### 3. Masked type: enter from the right in reading order

[Codrops, On-Scroll Typography Animations](https://tympanus.net/Development/OnScrollTypographyAnimations/), first demo, [`h2[data-effect11]`, “The Routine”](https://github.com/codrops/OnScrollTypographyAnimations/blob/af28d61d1f8d3d117f5d1e9b09d5209e20a1a212/src/index.html#L200). Pinned [animation source](https://github.com/codrops/OnScrollTypographyAnimations/blob/af28d61d1f8d3d117f5d1e9b09d5209e20a1a212/src/js/index.js#L359-L382) and [mask CSS](https://github.com/codrops/OnScrollTypographyAnimations/blob/af28d61d1f8d3d117f5d1e9b09d5209e20a1a212/src/css/base.css#L492-L496), revision `af28d61` (2024-01-18). Each masked letter moves from **+105% of its own width to 0**, **42 ms apart**, over **1 s per letter**, `expo` ease. It is a timed reveal, not a scrub. Trigger range is `top bottom` to `top top+=10%`, actions `play resume resume reset`.

**Observed in the pinned distribution:** the public site returned a challenge; no deployed revision or live font capture. Loaded that revision's [`dist/index.html`, CSS and ES module](https://github.com/codrops/OnScrollTypographyAnimations/tree/af28d61d1f8d3d117f5d1e9b09d5209e20a1a212/dist) locally. Skipped external fonts, analytics and ads; signaled the WebFont `active` callback using the fallback font. For readout only, exposed the module's GSAP (`mi`) and ScrollTrigger (`ha`), both `3.11.4`. Refresh triggers; select the trigger whose element matches `[data-effect11]`; scroll to `trigger.start + 10`. The measured start/end were `10567 / 11377` (desktop) and `8156 / 8966` (phone). Those document offsets depend on the preceding content; use the **relative crossing**, not these offsets, for Culm.

Use original heading **“Reed Ledger”** on one line at both widths: ten moving letters and one space, as in the reference. Keep the space, clip each letter separately (`overflow: hidden`), maintain left-to-right DOM order. Measure `d = DOMMatrixReadOnly(computedTransform).m41 / glyphRect.width` (identity means zero); normalized completion is `1 − d/1.05`. This compares motion across fonts and widths without requiring Codrops artwork. Sample the first four non-space glyphs in order and the last glyph:

| Local time             | 1280 × 900: d₀, d₁, d₂, d₃; d₉         | 390 × 900: d₀, d₁, d₂, d₃; d₉          |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| 0 ms                   | 1.05, 1.05, 1.05, 1.05; 1.05           | 1.05, 1.05, 1.05, 1.05; 1.05           |
| 100 ms (frame 6)       | .52500, .70241, .93978, 1.05; 1.05     | .52500, .70241, .93977, 1.05; 1.05     |
| 500 ms (frame 30)      | .03281, .04390, .05874, .07858; .45075 | .03281, .04390, .05874, .07859; .45075 |
| 1,378 ms (all settled) | 0 for all ten; whole heading readable  | 0 for all ten; whole heading readable  |

Measured first-moving frame (`d < 1.049`, sample `n/60`, `n = 0…25`) at **both widths**: `1, 3, 6, 8, 11, 13, 16, 18, 21, 23`. Source onset times are calculated as `i × 42 ms`, starting at 0; the last ends at `9 × 42 + 1000 = 1378 ms`, also the observed tween duration. All ten wrap elements clipped their glyphs via the source mask class. Do not treat a static, fully legible final frame as evidence for the stagger.

To re-read a frame from that dist build, append `window.ScrollTrigger = ha` to the served `index.e9a2d1b4.js` for inspection and run this after font activation and trigger setup. The local module's SHA-256 **before** inspection was `97a8d5fe831ce05451fdc0f3993fb14c5f7fc3339c062d298301ffaaf00c47b4`.

```js
const t = ScrollTrigger.getAll().find(t => t.trigger.matches('[data-effect11]'))
function frame(ms) {
  t.animation.pause().time(ms / 1000)
  return [...t.trigger.querySelectorAll('.char')].map(el => {
    const matrix = getComputedStyle(el).transform
    const dx = matrix === 'none' ? 0 : new DOMMatrixReadOnly(matrix).m41
    return dx / el.getBoundingClientRect().width
  })
}
```

## Raw script budget

Run in the repository root with the lockfile install:

```sh
node --conditions=source --import tsx --test scripts/__tests__/motion-spike.spec.ts
node --conditions=source --import tsx scripts/motion-spike.ts
```

```json
{
  "baseMax": 686,
  "states": 1963,
  "joins": 2,
  "timelinePrototype": 1057,
  "total": 3708,
  "headroom": 16292
}
```

These are **measured raw UTF-8 bytes** of script text, including the host invocation. At `a1ca779` the pattern script (304), initially-open popover appendix (105) and hidden-email appendix (277) sum to 686; the two appendices already include their leading `;`. States is 1,963. Baseline mixed page: `686 + 1 + 1963 = 2650`. Worst current feature mix with spike: `base+open+email ; states ; timeline` → `686 + 1963 + 2 + 1057 = 3708`. Headroom is relative to `sharedScripts = 20000`. No gzip, tag markup, CSS, per-element motion data or source maps in this metric.

The throwaway host is minified by esbuild 0.28.2 with the generator's TS loader, `minify: true`, `target: 'es2017'`, and the same `(function…)(document,window)` invocation. It splits a plain-text heading into masked glyphs, builds delayed tracks for them and two marks, maps the document's scroll range onto their timeline, seeks backward and forward, reseeks on resize, removes its listeners and restores the fixture on `pagehide`. This is a byte sample, not an implementation of the reference scenes.

**Propose 3,800 bytes for the full timeline script alone.** This allows **2,743 bytes above the measured slice**. Allocation below is an engineering estimate in minified bytes, not four measurements:

| Production work absent from the slice                                                                                                                 | Allowance |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| Decode steps and targets; property tracks, transform composition, SVG path drawing, eases, relative timing and a shared playback clock                |       900 |
| View/media, pointer, state and keyboard inputs; pin/scroll fallback, frame scheduling, reduced motion, duplicate-install prevention and abort cleanup |       850 |
| General text splitting, accessibility, bounded growth, reflow and restoring original DOM                                                              |       750 |
| Integration margin across those pieces                                                                                                                |       243 |

At the proposed cap and today's generated base/states, the worst mixed page is **6,451 bytes** (`686 + 2 + 1963 + 3800`), leaving **13,549**. The [compiler charges separators to base](../../packages/core/src/compile/page.ts#L378-L385): the unjoined 686 needs both joins added, but the 10,000-byte base ceiling already includes them. At all three accounted maxima the total is **19,993** (`10,000 + 6,193 + 3,800`), leaving **7**. The largest compatible timeline ceiling is **3,807** (`20,000 − 10,000 − 6,193`). Keep the 20,000 shared limit and remeasure the real host as each feature lands; if it cannot fit the proposed 3,800 bytes, return the numbers and feature tradeoff to the owner.
