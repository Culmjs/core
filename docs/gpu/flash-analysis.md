# Task 7: offline flash-analysis handoff

**Exit gate: OPEN.** The checked-renderer candidate exceeds the approved byte budgets. The release still renders only the framework `contours` effect; other definitions keep their authored fallback. The two local clips below are from the **candidate**, not a claim about released custom rendering. No independent analyzer ran. No final rate is approved.

| PEAT 1.6 result       | Positive control | Limited      |
| --------------------- | ---------------- | ------------ |
| General flash         | Not measured     | Not measured |
| Red flash             | Not measured     | Not measured |
| Warnings / raw report | Unavailable      | Unavailable  |

## Inputs for a Windows operator

Use the two local **files**, without playing them in a browser. Paths are relative to the worktree. Neither the AVIs nor their numbered PNG sources are distributed.

| Local input                               | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `.superpowers/gpu-flash/control/clip.avi` | `a132dfcbb8b292ab5f550a40a96695f2c5408b03cc3a4e6b3b0af855baf7b699` |
| `.superpowers/gpu-flash/limited/clip.avi` | `eb32b73410b02a0f49aea61ce645f3baeed557d2446a7d09eea0aa104e36a6c5` |

1. Verify both SHA-256 values (on Windows: `Get-FileHash -Algorithm SHA256 .\clip.avi` in each directory).
2. In Trace Center [PEAT 1.6, 2017-02-15 release](https://trace.umd.edu/peat/), use **Open video clip**, then **Analyze**, for each AVI. [Input and analysis instructions](https://trace.umd.edu/photosensitive-epilepsy-analysis-tool-peat-user-guide/).
3. Save the two original reports with the input hashes, tool build, settings and any warnings. Record **both** general-flash and red-flash findings. Require detection of the 5 Hz control and a below-general-flash result on the limited clip. A missing report, missed control, analysis error or limited general-flash finding keeps this gate open.

PEAT is not installed on this macOS host; neither `wine` nor `wine64` was on PATH. FFmpeg is used for lossless encoding, probing and pixel verification only. Even a successful PEAT pair would cover this achromatic fixture, **not saturated-red safety or WCAG certification**. A different enabled artifact, rate or presentation path needs its own verification.

## Reproduce locally

Use the repo's installed dependencies, an installed Chromium (`CULM_CHROME` can select it), `ffmpeg` and `ffprobe`. From the root:

```sh
node --conditions=source --import tsx scripts/gpu-flash-price.ts
node --conditions=source --import tsx scripts/gpu-flash-capture.ts
shasum -a 256 .superpowers/gpu-flash/{control,limited}/clip.avi
```

The second command recreates both sequences `000.png` … `179.png`, both AVIs, `summary.json` and `frames.json` under `.superpowers/gpu-flash/{control,limited}/`. Allow about 1 GB of disk space. The temporary HTML contains no executable scripts. Nothing listens on a network port; no clip is uploaded. Equivalent encoding in each sequence directory:

```sh
ffmpeg -y -framerate 30 -start_number 0 -i %03d.png -frames:v 180 -an -c:v rawvideo -pix_fmt bgr24 clip.avi
ffprobe -v error -count_frames -show_streams clip.avi
```

**Recorded inputs (2026-11-25):** 1024×768, DPR 1, light, forced sRGB, no zoom or scroll, one full-viewport opaque region. Each clip is 424,683,286 bytes, uncompressed BGR24 AVI, 180 unique consecutive PTS at 30/1 fps, six seconds. Chromium `156.0.8078.4`; WebGL2 / OpenGL ES 3.0, ANGLE Vulkan SwiftShader; FFmpeg and ffprobe `9.0.2`. See [control summary](evidence/task-7/control-summary.json), [limited summary](evidence/task-7/limited-summary.json) and the per-frame [control](evidence/task-7/control-frames.csv) / [limited](evidence/task-7/limited-frames.csv) logs (clock, submission, ACK, compositor opportunity, capture, codes and PNG hash).

**Clock and presentation.** A separate offline compiler build uses the candidate's real generated module; it does not change the release or suppress its budget findings. CDP starts the candidate host on compiled content. Geometry, initialization from black, OffscreenCanvas transfer, program compilation, draw acknowledgement, reveal and scale-up use that host. Before capture, 123 completed setup draws at fixed simulation time zero acquire the full-size buffer. The driver then conceals the foreground witness for the required unobstructed field, freezes host scheduling and reuses its last good message, changing **only time** on the same worker/surface. This isolates the 30 Hz rendering test: the normal host deliberately falls back after eight consecutive intervals over 25 ms at minimum scale and cannot provide six seconds of uninterrupted 30 Hz output. No production quality threshold was relaxed.

For frame `n`, time is `n/30` seconds; `floor(n/3) % 2` requests black or white. Both runs wait for that frame's worker ACK and two native compositor opportunities before the full screenshot. Wall time includes software rendering and capture overhead; it is not the AVI presentation time. Fixture-only instrumentation observes the renderer. The driver verifies the exact embedded worker source before optionally substituting `b` for `a+clamp(b-a,-D,D)` **only for the control**. There is no runtime bypass switch for authored effects.

**Pixel evidence, not analyzer output.** Every decoded frame hash was checked against a uniform 1024×768 raster and the requested control or quantized oracle code. No dropped/duplicate PTS. Control codes started `0,0,0,255,255,255,0,0,0`; 120 adjacent identical pictures by design. Limited codes started `0,0,0,22,34,43,34,21,0,22,34,43`; two adjacent identical pictures. The candidate rate is **0.25 linear-light units/channel/s**, delta capped at **33 ms**. Peak limited `|ΔY|` was `0.00849726` vs the pre-quantization cap `0.00825`; over codes 0–43, the largest upper half-code interval is `0.00051149`. The prior spike's higher-grey 30 Hz peak was `0.0098276` with a half-code error up to `0.001669` in that range ([limits](limits.md#luminance-and-independent-analysis)). Neither range is a universal quantization tolerance.

## Release decision

Raw minified ES2017 UTF-8; the worker is **included** in the host. Same real Stage 3 mixed page, 12,023 joined inline bytes in both cases:

| Build                    | Worker inside host | Complete host / 6,144 | Mixed / 20,000 | Available host / mixed |
| ------------------------ | -----------------: | --------------------: | -------------: | ---------------------: |
| Release, trusted-only    |              1,343 |                 6,070 |         18,093 |             74 / 1,907 |
| Checked-shader candidate |              3,476 |                 9,468 |         21,491 |        −3,324 / −1,491 |

The candidate is independently runnable at local checkpoint `e74b2d2911753c098e32b18239b6a805182f18c1` (`review/culm-stage-4-task-7-candidate`). The default generator selects the trusted-only program. `scripts/gpu-flash/compiler.ts` selects the complete candidate module **only in an isolated developer build**, so the consolidated browser tests and captures remain runnable without installing an over-budget host. Both costs include all executable host/worker bytes. A budget decision and an independent analysis are separate open gates.
