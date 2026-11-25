# Fitting the checked renderer into the existing budgets

The limits are **6,144 raw minified UTF-8 bytes for the GPU host, worker included**, and **20,000 for the page's shared JS**, including joins and lazy assets. The starting checkpoint `6850661` cost **11,570 / 23,593** on the mixed fixture; its release cost **6,070 / 18,093**. Pricing an isolated candidate does not enable it in production.

## What the page pays for

The compiler now inspects the **emitted** timeline scenes, including shared roots and expanded instances. If every timeline is a stationary load or entrance with no pin, SVG draw, native fallback or interactive clock, it selects playback code without those unused branches. Text splitting, font readiness, remounting, reduced motion and animation restoration still run. A single scene needing the full timeline selects it for the whole page. Both variants come from the same source; there is no late download. The page policy grants the hash of the exact joined bytes.

On the mixed fixture the playback timeline costs **5,294 bytes**, down from 8,177; the full timeline for a richer page costs **7,941** (limit 8,192). Sharing observer teardown in the lazy loader brings its cost including the join from **1,195 to 1,052**. The mixed fixture therefore pays **8,997** inline JS bytes, vs 12,023 before. Its states, text entrance, email and open-layer features are still present.

The timeline and checked GPU build also share repeated literal DOM property names as ordinary lexical variables. An access such as `element[key]()` stays bound to `element`; every key and all executable code remain in the artifact. No runtime decoder or additional resource is involved.

## Reproduce

```sh
node --conditions=source --import tsx scripts/gpu-flash-price.ts --unreviewed
node --conditions=source --import tsx scripts/gpu-flash-price.ts --unreviewed --interactive
```

The second command adds a real pointer-controlled timeline to the mixed fixture so the fully interactive build is priced as well. Add `--require-fit` to make any compiler budget finding fail the command. Both cases check actual emitted code lengths; the checked custom attachment must still exist and have the requested review status. The [compositor and analyzer evidence](flash-analysis.md) is versioned separately.
