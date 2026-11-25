# Fitting the checked renderer into the existing budgets

The limits are **6,144 raw minified UTF-8 bytes for the GPU host, worker included**, and **20,000 for the page's shared JS**, including joins and lazy assets. The starting checkpoint `6850661` cost **11,570 / 23,593** on the mixed fixture; its release cost **6,070 / 18,093**. Pricing an isolated candidate does not enable it in production.

**Status: optimization pass and visitor-speed benchmark complete.** Both checked mixed pages fit the aggregate; at the original ceilings the only compiler refusal was the GPU-host limit. The table shows the [actual compiler outputs at that point](evidence/size-work/final-bytes.json), including the SRI-bound lazy asset. See the subsequent [flash-analysis result](flash-analysis.md) and [production limit decision](limits.md).

[Visitor speed after optimization](astro-speed-optimized.md) compares these builds with the pre-optimization renderer and matched Astro pages in the same run.

| Final raw JS                                  | Trusted release | Checked candidate | Ceiling | Candidate headroom |
| --------------------------------------------- | --------------: | ----------------: | ------: | -----------------: |
| GPU host, including worker                    |           6,070 |         **9,012** |   6,144 |         **−2,868** |
| Standard mixed page                           |          14,542 |        **17,484** |  20,000 |             +2,516 |
| Mixed page with a pointer-controlled timeline |          17,055 |        **19,997** |  20,000 |                 +3 |

## What the page pays for

The compiler now inspects the **emitted** timeline scenes, including shared roots and expanded instances. If every timeline is a stationary load or entrance with no pin, SVG draw, native fallback or interactive clock, it selects playback code without those unused branches. Text splitting, font readiness, remounting, reduced motion and animation restoration still run. A single scene needing the full timeline selects it for the whole page. Both variants come from the same source; there is no late download. The page policy grants the hash of the exact joined bytes.

On the mixed fixture the playback timeline costs **4,769 bytes**, down from 8,177; the full timeline for a richer page costs **7,282** (limit 8,192). Sharing observer teardown in the lazy loader brings its cost including the join from **1,195 to 1,052**. The standard mixed fixture now pays **8,472** inline JS bytes, vs 12,023 before. The pointer-controlled fixture pays **10,985** inline bytes. The states, text entrance, email and open-layer features are still present.

| Mixed fixture: release, raw JS |        Before |         After |
| ------------------------------ | ------------: | ------------: |
| Base / states                  |   688 / 1,963 |   688 / 1,963 |
| Timeline / GPU loader          | 8,177 / 1,195 | 4,769 / 1,052 |
| GPU host (worker included)     |         6,070 |         6,070 |
| Page total                     |        18,093 |    **14,542** |

The timeline and checked GPU build also share repeated literal DOM property names as ordinary lexical variables. An access such as `element[key]()` stays bound to `element`; every key and all executable code remain in the artifact. No runtime decoder or additional resource is involved.

## Checked renderer

At interim GPU checkpoint `dddaa47`, the host and worker measured **8,963** and **2,972** bytes, down from **11,570** and **3,858**. The page results above include the final timeline compaction (`5195403`) and scroll fix.

Review found a real wakeup regression: merely touching an intersection edge can count as intersecting, so moving into view need not trigger another observer callback. `396f76e` restored coalesced scroll and viewport resize wakeups (including nested scroll capture) at a cost of **49 bytes**. The host is now **9,012 bytes**: **2,979** for the quoted worker including delimiters and escaping, **6,033** for the rest. It still exceeds the **6,144** host ceiling by **2,868** and remains isolated.

The runtime now inspects eligible geometry and background in one pass, keeps one acknowledgment per owner, and accounts for slow frames using completed draws. Compilation normalizes scalar and colour settings once; the worker uses fixed texture units and a common draw path for the raw shader and the display pass. The checked host and worker still execute in their original realms. The integrated GPU browser run passed **57/57**, including real SRI activation, timed fallback, packed consumers and composited pixels. Both regenerated 180-frame [offline clips](flash-analysis.md) were byte-identical to their independently analyzed predecessors.

In a separate [Metal GPU smoke test](evidence/size-work/metal-poster-pixels.csv), both checked poster visits remained active at 392×800 presentation resolution. Each showed the same 10th/90th percentile contour codes as the previous checked build at the corresponding samples (149/157 near 1.28 s and 145/161 near 2.23 s). Both trusted controls also remained active. These four screenshot visits verify hardware output, not phone performance.

## Why the background-layer shortcut was rejected

A two-owner Chromium prototype moved each owner's background to a negative-z `::before` layer behind the one shared canvas. It matched the reference on an ordinary patterned poster, but exposed an ancestor's border on **4,352 seed-frame pixels**, and an inset shadow on **9,216**, before the shader moved. Both layouts had working active effects in the reference. A live background override also left **43,049 pixels** stale until the next inspection. The same paint-order error reproduces without JavaScript: a negative-z pseudo-element replaces the normally painted background of an article inside a parent with an inset shadow. The parent's shadow becomes visible over it.

The prototype was **6,688 host bytes with the previous reference worker**, before the full placement checks, watchdog and slow-device handling. It was not adopted. Keeping the real poster in its authored paint layer preserves the behavior being optimized.

## Reproduce

```sh
node --conditions=source --import tsx scripts/gpu-flash-price.ts --unreviewed
node --conditions=source --import tsx scripts/gpu-flash-price.ts --unreviewed --interactive
```

The second command adds a real pointer-controlled timeline to the mixed fixture so the fully interactive build is priced as well. Add `--require-fit` to make any compiler budget finding fail the command. Both cases check actual emitted code lengths; the checked custom attachment must still exist and have the requested review status. The [compositor and analyzer evidence](flash-analysis.md) is versioned separately.

`scripts/__tests__/gpu-page-budget.spec.ts` guards the full interactive fixture's 3-byte margin. Both price checks still report `gpuHostScript`, as they should. Full verification: 2,080 unit passes and 230 browser passes, six pre-existing skips across the two suites, zero failures; the new page-budget regression also passed separately. Typecheck, lint, formatting, layer and vocabulary checks passed.
