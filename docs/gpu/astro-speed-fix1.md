# Astro comparison after the first poster correction

**Culm `e96e87e` removed the 9.2 s black pre-roll.** On the mobile-shaped Mac, the corrected poster renderer acknowledged readiness in **429 ms**, vs **431 ms** for the release and **9,628 ms** for the earlier candidate. The contour built contrast gradually, not instantaneously. On a separate set of screenshot visits both contour bands were confirmed by **2.23 s** for the candidate and **0.53 s** for the release.

## Matched cold visits

Astro 7.4.13, full Chrome 156, Apple M4 Max Metal GPU, [same fixtures and settings](astro-speed.md#method-and-interpretation) as before. Nine cold contexts per variant per profile: 162 measured visits excluding warm-ups. Times are median milliseconds from navigation. “Ready” is a completed-draw readiness marker, not first perceptible motion. Mobile-shaped uses 4× CPU slowdown, 150 ms latency and 1.6 Mbps down; **no phone was attached**.

| Fixture                                  | Local LCP / ready | Mobile-shaped LCP / ready | Compressed body bytes | Raw JS bytes |
| ---------------------------------------- | ----------------: | ------------------------: | --------------------: | -----------: |
| Astro static                             |            20 / — |                   216 / — |                 1,773 |            0 |
| Culm static                              |            24 / — |                   216 / — |                 2,030 |          304 |
| Astro, hand-written trusted effect       |           28 / 21 |                 216 / 355 |                 3,049 |        2,392 |
| Culm release, trusted effect             |           28 / 56 |                 216 / 430 |                 5,950 |        7,569 |
| Culm, corrected checked effect           |           28 / 57 |                 216 / 440 |                 8,075 |       12,534 |
| Astro, **same corrected checked effect** |           28 / 55 |                 216 / 442 |                 8,075 |       12,534 |
| Mixed: Culm release                      |           32 / 62 |                 220 / 452 |                11,725 |       18,093 |
| Mixed: Culm corrected                    |           36 / 63 |                 220 / 461 |                13,858 |       23,058 |
| Mixed: Astro, same checked renderer      |           32 / 65 |                 220 / 463 |                13,859 |       23,058 |

All **126 animated solid-hero visits** ended active; every animation case had a median of 60 completed draws/s. No visit recorded layout shift. On the mobile-shaped simple hero the corrected and trusted Culm renderers each had a median 95th-percentile draw interval of 17.6 ms. Both used a 98×200 work grid; the corrected renderer presented at 392×800 to preserve per-screen-pixel history.

- Matched-engine Culm minus Astro: median **paired** activation difference −4.8 ms (middle five of nine, −10.3 to +11.5 ms). The purpose-built Astro effect was quicker but does not support checked custom shaders.
- Mixed corrected minus release: **+2,133 compressed bytes**; **+4,965 raw JS bytes**. Median paired activation difference +10.8 ms (middle five, +2.8 to +14.8 ms). The two checked mixed pages have the same executable code; their compressed HTML bodies differ by one byte.

## What became visible over the poster

Six additional cold visits (three per renderer, 14 s) gave the 429 / 431 ms readiness medians above. Corrected / release LCP was **224 / 216 ms**; both had 60 completed draws/s. All six remained active.

Another **six** cold visits used compositor screenshots, kept separate from the speed measurements. Below the text, the unaltered poster ranges from green code 153 to 156. Both contrasting bands counted as present when at least the lower tenth of the row reached 150 or below and the upper tenth reached 159 or above. The corrected row had already started changing by ~0.83 s (151 / 155). At ~1.28 s it was 149 / 157; at ~2.23 s it was 145 / 161 in every visit. The trusted effect passed the threshold at the first ~0.53 s sample. These are **confirmation times**, not exact onset times. At ~12.53 s the corrected bands still had less contrast than the release (median 117 / 187 vs 105 / 202).

**Decision implication:** This checkpoint’s transfer cost had a small measured impact on this Mac, but its 11,035-byte host and 23,058-byte mixed page exceed the approved raw limits by 4,891 and 3,058 bytes. Independent review also identified a covered ancestor change resetting displayed history, a nested negative stacking order changing foreground paint, and region membership changes masking sustained slow frames. Keep the trusted release and the approved budgets. The [supplemental IRIS results](iris-analysis.md) cover the achromatic test clips only.

[Cold-visit data](evidence/astro-speed/fix1-cold.csv) · [Poster timings](evidence/astro-speed/fix1-poster.csv) · [Compositor samples](evidence/astro-speed/fix1-pixels.csv). To validate and export another run, use `node scripts/benchmark-astro-report.mjs path/to/results.json > samples.csv`.
