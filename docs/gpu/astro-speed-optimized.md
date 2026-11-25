# Visitor speed after the size optimization

**The optimized checked renderer transferred less and ran at about the same speed as before.** On the 19,997-byte fully interactive page, mobile-shaped median LCP was **220 ms**, the effect was ready in **454 ms**, and the renderer completed **60 draws/s**. Astro serving the same renderer measured **224 ms / 458 ms / 60 draws/s**. The clearest visible difference was still the deliberate poster transition.

## Cold results

Medians of nine fresh browser contexts per fixture per profile. Times in milliseconds from navigation start; “ready” is the host's post-draw activation marker. Body bytes are the compressed HTML and fetched assets, excluding HTTP headers. A dash denotes no effect.

| Page                                                | Local LCP / ready | Mobile-shaped LCP / ready | Brotli bytes |
| --------------------------------------------------- | ----------------: | ------------------------: | -----------: |
| Astro static                                        |            24 / — |                   212 / — |        1,773 |
| Culm static                                         |            24 / — |                   212 / — |        2,030 |
| Astro, one hand-written trusted contour             |           20 / 18 |                 220 / 361 |        3,049 |
| Culm, single trusted contour                        |           28 / 58 |                 212 / 430 |        5,943 |
| Culm, single checked contour                        |           20 / 54 |                 212 / 440 |        7,700 |
| Astro, same single checked renderer                 |           28 / 55 |                 220 / 438 |        7,702 |
| Standard mixed, checked **before**                  |           36 / 58 |                 224 / 457 |       14,045 |
| Standard mixed, trusted release                     |           36 / 56 |                 220 / 450 |       10,361 |
| Standard mixed, optimized checked                   |           32 / 63 |                 224 / 455 |       12,126 |
| Standard mixed, Astro with same checked renderer    |           36 / 67 |                 220 / 456 |       12,126 |
| Fully interactive, checked **before**               |           32 / 60 |                 216 / 457 |       14,141 |
| Fully interactive, trusted release                  |           24 / 54 |                 220 / 449 |       11,729 |
| Fully interactive, optimized checked                |           28 / 58 |                 220 / 454 |       13,486 |
| Fully interactive, Astro with same checked renderer |           36 / 61 |                 224 / 458 |       13,486 |

The standard mixed page saved **1,919 compressed bytes (13.7%)** versus the previous checked build; the fully interactive page saved **655 bytes (4.6%)**. On the mobile-shaped full page the median _paired_ ready-time difference (optimized minus before, same round) was **−3.0 ms**; the middle five of nine ranged from **−10.7 to +2.3 ms**. This supports a transfer-size improvement, not a reliable perceptible startup improvement. The hand-written Astro effect starts about 79 ms earlier than the single checked Culm effect, but does not check arbitrary shaders or apply the limiter.

All **216 animated cold visits** ended active. Every animated variant had a median of 60 completed draws/s during the 0.6–2.4 s window; all 252 cold visits had zero recorded layout shift. The mobile-shaped full checked page's median 95th-percentile draw interval was 17.7 ms. These short observations are not a sustained thermal or battery test.

## Pointer response and poster

After recording each full page's cold metrics, four trusted Chromium mouse moves alternated across its visible pointer-controlled text. Timing ran from the browser event timestamp to the first animation-frame callback observing a different **computed scale**. This measures a real style change, not display scanout or field INP.

| Mobile-shaped full page (36 moves each) | Median response | 95th percentile |
| --------------------------------------- | --------------: | --------------: |
| Checked before optimization             |         12.9 ms |         36.6 ms |
| Trusted release                         |         12.0 ms |         39.2 ms |
| Optimized checked                       |     **13.1 ms** |     **36.9 ms** |
| Astro with same checked renderer        |         12.1 ms |         35.9 ms |

Over the patterned poster, uninstrumented median readiness was **422 ms checked / 429 ms trusted**; LCP was **220 / 216 ms**. In separate screenshot visits the checked poster had started changing by the ~0.84 s sample, and both light and dark bands were confirmed by **2.24 s** (median). The trusted contour already met that threshold at the first **0.53 s** sample. These are upper bounds from discrete captures, not exact perceptual onset times.

## Method and evidence

- Culm `01b2e04`, optimized host `2844a4b873444f705f173749aa722da0d6a0cb1c9e653a7f38ae58e6d8d8e597`. The pre-optimization control was compiled from Git `6850661` and measured in the **same rotating run**, with the same fixtures, Chrome process and installed build tools. Its host hash matched `859a937afe74f61dca59cf53f851db1df94fe5f99f6ddbe227d1b3a032dd4b24`. The fully interactive fixture exposes its pointer meter and runs the exact 19,997 raw executable bytes of the budget case.
- Production Astro 7.4.13, Playwright 1.65.1, Chrome 156.0.8078.4, Apple M4 Max ANGLE Metal. Local: 1280×800, DPR 1, unthrottled. Mobile-shaped: 392×800, DPR 1, 4× CPU slowdown, 150 ms network latency, 1.6 Mbps down / 750 kbps up; still the Mac GPU and a fine pointer. **No physical handset was attached.**
- 14 fixtures × 2 profiles × 9 measured cold visits = **252**. Plus three cold poster visits per renderer and three separate screenshot visits per renderer = **264** recorded navigations, excluding warm-ups. Same loopback server, Brotli quality 5, fresh context per visit and disabled HTTP cache. See [definitions and caveats](astro-speed.md#method-and-interpretation).

[Cold visits](evidence/astro-speed/optimized-cold.csv) · [288 pointer samples](evidence/astro-speed/optimized-pointer.csv) · [Poster timings](evidence/astro-speed/optimized-poster.csv) · [Poster pixels](evidence/astro-speed/optimized-pixels.csv)

With the [pinned benchmark tools and Chrome](astro-speed.md#reproduce), run:

```sh
BENCH_BEFORE=1 BENCH_POINTER=1 BENCH_OUTPUT=.superpowers/astro-speed/final-opt-cold.json node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
BENCH_VARIANTS=culm-trusted-poster,culm-checked-poster BENCH_PROFILES=mobile BENCH_ROUNDS=3 BENCH_WINDOW_MS=14000 BENCH_OUTPUT=.superpowers/astro-speed/final-opt-poster.json node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
BENCH_POSTER_PIXELS=1 BENCH_VARIANTS=culm-trusted-poster,culm-checked-poster BENCH_PROFILES=mobile BENCH_ROUNDS=3 BENCH_WINDOW_MS=14000 BENCH_OUTPUT=.superpowers/astro-speed/final-opt-pixels.json node --conditions=source --import tsx scripts/benchmark-astro-speed.mjs
node scripts/benchmark-astro-report.mjs .superpowers/astro-speed/final-opt-cold.json --pointer
```
