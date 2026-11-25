# Task 7: offline flash-analysis handoff

**Exit gate: OPEN — no PEAT result.** Use the inputs for host **`2844a4b873444f70`** below. Its bundle exceeds the approved host limit and is isolated; the release renders only framework `contours`. On this pair of hashes the [supplemental EA IRIS analysis](iris-analysis.md) flagged the control (159 luminance-failure frames) and passed all 180 limited frames without luminance warnings. Both greyscale clips had no red-flash findings. No final rate is approved.

| PEAT 1.6 result       | Positive control | Limited      |
| --------------------- | ---------------- | ------------ |
| General flash         | Not measured     | Not measured |
| Red flash             | Not measured     | Not measured |
| Warnings / raw report | Unavailable      | Unavailable  |

## Inputs for a Windows operator

Use the two local **files**, without playing them in a browser. Paths are relative to the worktree. Neither the AVIs nor their numbered PNG sources are distributed.

| Local input                                                     | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `.superpowers/gpu-flash/host-2844a4b873444f70/control/clip.avi` | `a132dfcbb8b292ab5f550a40a96695f2c5408b03cc3a4e6b3b0af855baf7b699` |
| `.superpowers/gpu-flash/host-2844a4b873444f70/limited/clip.avi` | `f872ca2cba925b72649f58e36a9b3fb2c40919c0f4d45878e742abc26f39f4a7` |

Both inputs were regenerated after restoring the edge-to-visible wakeup. Each AVI is byte-identical to its [size-1](evidence/task-7/size-1/limited-summary.json), [fix-2](evidence/task-7/fix-2/limited-summary.json) and [fix-1](evidence/task-7/fix-1/limited-summary.json) counterpart; the IRIS findings above are from the earlier run on those exact hashes. The original pre-fix-1 limited AVI (`eb32b73410b02a0f49aea61ce645f3baeed557d2446a7d09eea0aa104e36a6c5`) and its [records](evidence/task-7/limited-summary.json) remain separate.

1. Verify both SHA-256 values (on Windows: `Get-FileHash -Algorithm SHA256 .\clip.avi` in each directory).
2. In Trace Center [PEAT 1.6, 2017-02-15 release](https://trace.umd.edu/peat/), use **Open video clip**, then **Analyze**, for each AVI. [Input and analysis instructions](https://trace.umd.edu/photosensitive-epilepsy-analysis-tool-peat-user-guide/).
3. Save the two original reports with the input hashes, tool build, settings and any warnings. Record **both** general-flash and red-flash findings. Require detection of the 5 Hz control and a below-general-flash result on the limited clip. A missing report, missed control, analysis error or limited general-flash finding keeps this gate open.

**Offline handoff prepared.** This worktree has a local-only `.superpowers/peat-operator/host-2844a4b873444f70-inputs.zip` (833,414 bytes). Both AVI streams were SHA-256 verified after compression. They are named `control-input.avi` and `limited-input.avi` so the reports can be distinguished. The archive also contains a checksum list, a PowerShell verifier and operator instructions. The [official portable PEAT 1.6 ZIP](https://trace.umd.edu/wp-content/uploads/2021/01/peat_2017-02-15.zip) was downloaded separately to `.superpowers/peat-operator/peat_2017-02-15.zip` (SHA-256 `7aaf9d22ae496d18f2917464965df595bdcf0aca751a810daf9d27bcd4ef8d5c`). On Windows use **File → Save HTML Report** for each input. Analyze updates PEAT’s video preview, so use a nonvisible VM display or cover the preview.

No Windows guest is registered in the local Parallels installation, Docker is running Linux, and no Windows runner was supplied. PEAT has not run. FFmpeg is used for lossless encoding, probing and pixel verification only. Even a successful PEAT pair would cover this achromatic fixture, **not saturated-red safety or WCAG certification**. A different enabled artifact, rate or presentation path needs its own verification.

## Reproduce locally

Use the repo's installed dependencies, an installed Chromium (`CULM_CHROME` can select it), `ffmpeg` and `ffprobe`. From the root:

```sh
node --conditions=source --import tsx scripts/gpu-flash-price.ts
node --conditions=source --import tsx scripts/gpu-flash-capture.ts
shasum -a 256 .superpowers/gpu-flash/host-2844a4b873444f70/{control,limited}/clip.avi
```

The second command recreates both sequences `000.png` … `179.png`, both AVIs, `summary.json` and `frames.json` under `.superpowers/gpu-flash/host-<first 16 hex digits of the host SHA-256>/{control,limited}/`. Allow about 1 GB of disk space. The temporary HTML contains no executable scripts. Nothing listens on a network port; no clip is uploaded. Equivalent encoding in each sequence directory:

```sh
ffmpeg -y -framerate 30 -start_number 0 -i %03d.png -frames:v 180 -an -c:v rawvideo -pix_fmt bgr24 clip.avi
ffprobe -v error -count_frames -show_streams clip.avi
```

**Recorded inputs (2026-11-25):** 1024×768, DPR 1, light, forced sRGB, no zoom or scroll, one full-viewport opaque region. Each clip is 424,683,286 bytes, uncompressed BGR24 AVI, 180 unique consecutive PTS at 30/1 fps, six seconds. Chromium `156.0.8078.4`; WebGL2 / OpenGL ES 3.0, ANGLE Vulkan SwiftShader; FFmpeg and ffprobe `9.0.2`. See [control summary](evidence/task-7/host-2844a4b873444f70/control-summary.json), [limited summary](evidence/task-7/host-2844a4b873444f70/limited-summary.json) and the per-frame [control](evidence/task-7/host-2844a4b873444f70/control-frames.csv) / [limited](evidence/task-7/host-2844a4b873444f70/limited-frames.csv) logs (clock, submission, ACK, compositor opportunity, capture, codes and PNG hash).

**Clock and presentation.** A separate offline compiler build uses the candidate's real generated module; it does not change the release or suppress its budget findings. CDP starts the candidate host on compiled content. Geometry, initialization from black, OffscreenCanvas transfer, program compilation, draw acknowledgement, reveal and scale-up use that host. Before capture, 123 completed setup draws at fixed simulation time zero acquire the full-size buffer. The driver then conceals the foreground witness for the required unobstructed field, freezes host scheduling and reuses its last good message, changing **only time** on the same worker/surface. This isolates the 30 Hz rendering test: the normal host deliberately falls back after eight consecutive intervals over 25 ms at minimum scale and cannot provide six seconds of uninterrupted 30 Hz output. No production quality threshold was relaxed.

For frame `n`, time is `n/30` seconds; `floor(n/3) % 2` requests black or white. Both runs wait for that frame's worker ACK and two native compositor opportunities before the full screenshot. Wall time includes software rendering and capture overhead; it is not the AVI presentation time. The driver verifies the embedded worker source and forces the final pass to return the raw opaque target **only in the offline control body**. Each summary separately hashes the generated candidate worker body, the body actually selected for that fixture, and the complete executed Blob (renderer-observation prefix + selected body).

**Pixel evidence, not analyzer output.** Every decoded frame hash matched a uniform 1024×768 raster and its control or quantized oracle code. No dropped/duplicate PTS. Control codes started `0,0,0,255,255,255,0,0,0`; 120 adjacent identical pictures. Limited codes started `0,0,0,1,2,3,2,1,0,1,2,3`; maximum 6, peak `|ΔY|=0.000303527`, 16 adjacent identical pictures. These low-grey values are not a tolerance for bright pixels.

## What the corrected limiter bounds

The candidate keeps the **presentation/history grid fixed** for a stationary viewport, independently of the shader work resolution. The real owner background stays painted below the plane; ordinary in-flow content paints above it. For a solid opaque fallback the first sample is its checked CSS colour. Otherwise the first real shader sample starts at **zero framework coverage** over the original poster. On an earned step the pass can change coverage or move the straight colour toward the live shader, never both. Up to one in four steps can track a changing colour during the dissolve. No poster texture is fetched and no DOM or GL pixels are read by the renderer.

The provisional target remains **0.25 linear-light units/channel/s**, elapsed capped at **33 ms**. The maximum derivative of sRGB decoding is `L = 2.4 / 1.055`. Each owner earns `255 × 0.25 / L = 28.0234375` encoded codes per capped second. Carrying fractional credit permits progression at 30, 60 and 120 Hz without granting a free rounding step every frame. A coverage step over any stationary background or a colour step at fixed coverage changes the ideal encoded blend by at most one code. Stationary ordinary source-over foregrounds, including partially covered glyph pixels, attenuate that change. The bound concerns the background's contribution to SDR sRGB output with that composition; it does not bound independently changing content, forced teardown, monitor transforms or arbitrary CSS blend/filter effects.

A single frame may spend credit earned earlier: one code at white (`254→255`) is **0.00889790 linear**, about **0.006815 more** than one unquantized 120 Hz allowance. In a stationary interval the step count is at most the earned total plus one carried code. This quantization is material. Chromium tests checked at most **one displayed code per sampled channel per step**, with genuine movement at all three rates, through a half-white foreground and at antialiased text edges. A work downshift over alternating neighbouring colours produced `0,255,0,255 → 0,254,1,255`. Complex or overlapping foregrounds and unsafe placement can remain static.

On the survey SVG fixture in a 392×800 viewport, the first valid seed ACK preceded the marker. Of 40 sampled poster pixels, 12 had changed by the third synthetic 60 Hz opportunity; motion was toward the checked contour in both light and dark schemes. A separate owner's dark/light bands remained distinct during the transition. These are functional screenshot checks, not cold-load, hardware or phone timings.

Fix-2 separates the seed check before exposure from continuity of an already displayed region. Changing `main` behind an opaque owner no longer restores its poster. The candidate declines authored descendant z-order that it cannot preserve, including a positioned `z:-1` grandchild; authored stacking states take precedence over foreground promotion. A single drawable neighbour is enough to keep tracking the device's frame intervals. A slow flag is written only for a still-eligible effect that participated in every completed draw of the terminal slow window. If there is no such effect, the page still returns to static without persisting a label.

## Release decision

Before size optimization (`6850661`), raw minified ES2017 UTF-8; the worker is **included** in the host. Same real Stage 3 mixed page, 12,023 joined inline bytes in both cases:

| Build                          | Worker inside host | Complete host / 6,144 | Mixed / 20,000 | Available host / mixed |
| ------------------------------ | -----------------: | --------------------: | -------------: | ---------------------: |
| Release, trusted-only          |              1,343 |                 6,070 |         18,093 |             74 / 1,907 |
| Fix-2 checked-shader candidate |              3,858 |                11,570 |         23,593 |        −5,426 / −3,593 |

The default generator and public `hostGpu` boot still deliver the trusted-only host (`737ca3bd752c31af3ffd8ff11b76ccb226b9dce5d135411fe134a7b00bd90fe0`). `scripts/gpu-flash/compiler.ts` selects the optimized candidate (`2844a4b873444f705f173749aa722da0d6a0cb1c9e653a7f38ae58e6d8d8e597`) **only in an isolated developer build**. The [optimization and speed work](size-work.md) is complete. The [conditional host-limit increase](limits.md) is pending this analysis and rate decision.
