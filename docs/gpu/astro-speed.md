# Astro and Culm: visitor speed for the Stage 4 decision

**[After the first correction (`e96e87e`): timings, actual poster contrast and review findings](astro-speed-fix1.md).** The candidate's median poster readiness went from 9.63 s to 0.43 s on the mobile-shaped Mac. The gradual dissolve showed both contrasting contour bands by the 2.23 s sample.

**Original decision point:** The first candidate took **9.63 s** to activate over a patterned poster vs **0.41 s** for the release. Both painted the main content in **212 ms**. This led to the corrected transition in `e96e87e`; its measured results are reported separately from this baseline.

## Historical baseline (`258ea14`, before correction)

Medians of nine cold visits per variant per profile, **162 measured navigations** before the separate poster test. Times are milliseconds from navigation start. “Brotli bytes” includes the HTML and the external JS actually fetched. Dash means there is no effect to activate.

| Fixture                                      | Local LCP | Local effect ready | Mobile-shaped LCP | Mobile-shaped effect ready | Brotli bytes | Raw JS bytes |
| -------------------------------------------- | --------: | -----------------: | ----------------: | -------------------------: | -----------: | -----------: |
| Astro static                                 |        24 |                  — |               208 |                          — |        1,773 |            0 |
| Culm static                                  |        24 |                  — |               204 |                          — |        2,030 |          304 |
| Astro, hand-written trusted contour          |        24 |                 22 |               200 |                        355 |        3,049 |        2,392 |
| Culm release, trusted contour                |        24 |                 55 |               212 |                        425 |        5,950 |        7,569 |
| Culm candidate, checked contour              |        28 |                 41 |               216 |                        422 |        7,542 |       10,967 |
| Astro using the same checked renderer        |        28 |                 41 |               204 |                        420 |        7,542 |       10,967 |
| Mixed: Culm release                          |        24 |                 48 |               216 |                        437 |       11,725 |       18,093 |
| Mixed: Culm candidate                        |        28 |                 43 |               220 |                        437 |       13,316 |       21,491 |
| Mixed: Astro using the same checked renderer |        32 |                 47 |               216 |                        435 |       13,316 |       21,491 |

- **Astro comparison:** On the simple hero, Astro’s purpose-built trusted effect started about **67 ms sooner** than the candidate on the mobile-shaped profile (355 vs 422 ms). It has no limiter or custom shader support. With the _same_ candidate renderer on both, activation medians differed by just **2 ms** (420 vs 422 ms); the middle five of nine paired differences ranged from −5.7 to +2.3 ms. Small differences in paint time should not be treated as a framework ranking.
- **Budget comparison:** On the mixed page the candidate added **3,398 raw JS bytes** relative to the release but only **1,591 compressed body bytes** including the accompanying HTML change. Median LCP changed from 216 to 220 ms; median activation rounded to 437 ms for both. This does **not** change the budget result: the candidate still exceeds the approved host cap by **3,324 raw bytes** and the shared cap by **1,491**.
- **Animation:** Every solid-background animated case remained active at the end of every visit. All had a median of **60 completed draws/s** in the 0.6–2.4 s window. On the mobile-shaped simple hero, the median run’s 95th-percentile draw interval was **17.5 ms** for hand-written Astro, **17.6 ms** for Culm trusted and **17.7 ms** for Culm checked. All stayed at the initial quarter resolution (98×200 mobile; 320×200 local). These figures do not establish full-resolution, long-session or budget-phone performance.

### Poster image: time to the effect rather than the page

Three more cold visits per Culm variant on the mobile-shaped profile, each observed for 14 seconds. Both used the **same locally served patterned SVG** over the same hero. Both had **212 ms median LCP** and no measured layout shift.

| Renderer                        | Median effect ready | Range, three runs |
| ------------------------------- | ------------------: | ----------------: |
| Culm release, trusted contour   |             0.412 s |     0.410–0.428 s |
| Culm candidate, checked contour |         **9.628 s** | **9.625–9.648 s** |

The poster was visible while the original candidate waited. The difference matched its provisional **9.2-second transition** from a nonuniform background before the first custom frame was revealed. The additional wait did not come from downloading 1.6 kB more. Code review also identified brightness changes when resolution decreased, under translucent foregrounds, and when the fallback changed during startup; see the [corrective work and flash-analysis evidence](flash-analysis.md).

**Decision at that point:** Correct the display transitions and repeat the poster and solid-hero runs before revisiting the ceilings.

[Raw cold-load and frame samples](evidence/astro-speed/cold.csv) · [raw poster samples](evidence/astro-speed/poster.csv)

## What was compared

The benchmark uses local production output from **Astro 7.4.13** and Culm at `258ea14` (before correction) or `e96e87e` (after). It serves a nonflashing, slowly moving contour behind a heading and text. It does not run the flash-analysis clips. The checked renderer is the isolated **candidate**, not a feature enabled in the release.

| Case                          | What the browser actually runs                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro static / Culm static    | Same visible HTML and CSS; no shader. Astro ships zero page JS. Culm ships its normal base script and policy.                                                                                                                                     |
| Astro authored effect         | An Astro page with one hand-written, trusted WebGL2 effect. Same contour source, speed, hero, starting resolution and quality thresholds. It runs on the main thread, without support for arbitrary shaders, review rules, or flash limiting.     |
| Culm trusted / Culm checked   | One above-the-fold hero on the current release or the candidate. The release uses the built-in contour; the candidate receives a custom, **unreviewed** declaration with the identical shader and parameters, forcing the additional render pass. |
| Astro + checked Culm renderer | A real Astro production build using the same rendered markup, CSS, client scripts and SRI-bound external asset as the Culm candidate. This holds client behavior constant; Astro does **not** supply these shader facilities itself.              |
| Mixed pages                   | The same hero prepended to Culm’s existing mixed fixture (states, base extensions, timeline). The probe compares the release and candidate and includes a behavior-matched Astro build.                                                           |

## Method and interpretation

- Browser: full Chrome for Testing 156.0.8078.4, headless, on Apple M4 Max. Reported WebGL renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)`. Playwright 1.65.1 controlled the browser; Node v26.13.1 built the fixtures.
- Local profile: 1280×800, DPR 1, unthrottled loopback. Mobile-shaped profile: 392×800, DPR 1, Chrome CDP 4× CPU slowdown, 150 ms network latency, 1.6 Mbps down and 750 kbps up. The latter still has the Mac GPU; it is **not** a physical phone.
- Serve every page and asset with identical loopback HTTP/1.1 and Brotli quality 5. Each visit has a fresh browser context, empty origin storage, disabled HTTP cache and `Cache-Control: no-store`. The browser process and installed browser/driver caches are warm. No external images, fonts, analytics, CDN, hydration framework or third-party scripts.
- Run one excluded warm-up for every case/profile. Alternate profile order; rotate/reverse page order between rounds. One page at a time. No synthetic frame timestamps. Use the same out-of-band performance observers for every page. Navigation-to-LCP is the browser’s observed **Largest Contentful Paint** in the observation window. **Effect ready** is when the host marks the first region active after a completed GPU draw, not proof of a perceptible first colour change.
- Count genuine completed draws (`gl.finish()` for the small authored Astro example, worker draw acknowledgements for Culm). These are not screen-present events. Also record page rAF cadence, 95th-percentile draw interval per visit, canvas resolution changes and whether the effect remained active. Body bytes are browser-reported compressed HTTP bodies, excluding headers. The acceptance ceilings use **uncompressed JS**, not transfer bytes.
- This is a controlled, one-page **visitor** comparison. It is not a comparison of cold CLI startup, build throughput, hosted TTFB, battery life, or field Core Web Vitals. On a matched page, identical static output and identical client code should perform alike, whichever tool built them.

## Reproduce

From the Stage 4 worktree, install benchmark tools in an ignored directory. No application package or lockfile change is required.

```sh
npm install --prefix .superpowers/astro-speed --no-audit --no-fund --save-exact astro@7.4.13 playwright-core@1.65.1
export CULM_CHROME="/path/to/Chrome for Testing"
node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
BENCH_VARIANTS=culm-trusted-poster,culm-checked-poster BENCH_PROFILES=mobile BENCH_ROUNDS=3 BENCH_WINDOW_MS=14000 BENCH_OUTPUT=.superpowers/astro-speed/poster.json node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
```

[Benchmark source](../../scripts/benchmark-astro-speed.mjs) · [independent flash-analysis handoff](flash-analysis.md) · [approved production limits](limits.md)

### Repeat on a physical Android phone

Use one unlocked, USB-connected Android phone with Chrome open and USB debugging authorized. Keep it in portrait, with the display awake and the benchmark tab in the foreground; note device model and power-saving / reduced-motion settings. The runner attaches to Chrome via `adb -d`, uses new test tabs and fresh loopback origins, and removes its own forwards when finished. The `handset` profile uses the actual screen, DPR, CPU and GPU; it shapes only the network to the mobile profile above. A missing device stops the run. This lane has no handset results yet.

```sh
BENCH_ANDROID=1 node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
BENCH_ANDROID=1 BENCH_VARIANTS=culm-trusted-poster,culm-checked-poster BENCH_ROUNDS=3 BENCH_WINDOW_MS=14000 BENCH_OUTPUT=.superpowers/astro-speed/handset-poster.json node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
```

For a separate visual diagnostic, install `pngjs@7.0.0` in the same benchmark prefix and repeat the poster command with `BENCH_POSTER_PIXELS=1` and a separate `BENCH_OUTPUT`. It takes occasional lossless compositor screenshots of one row below the text, then records the capture interval and 10th/90th percentile green codes. The grey poster ranges from 153 to 156; `p10 ≤ 150` **and** `p90 ≥ 159` witnesses both light and dark contour bands, which a uniform fade to black cannot do. The first qualifying sample is an upper bound on visible contour onset, not the exact first moving pixel. Do not pool these instrumented timings with the speed runs.
