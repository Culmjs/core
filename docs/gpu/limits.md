# Stage 4 GPU spike: measurements for the owner

**Decision: approved, 2026-11-24.** After review of the mixed fixture (**16,023 of 20,000 shared JS bytes**), the owner approved the host and WASM ceilings below and the [shader cost caps](#shader-cost-inputs) for production. The existing 20,000-byte page ceiling still applies. The [flash-limiter rate](#luminance-and-independent-analysis) remains provisional pending independent analysis.

| Approved ceiling                                    | Measured fixture | Basis                                                                                                                                                         |
| --------------------------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6,144 bytes for the lazy host, including its worker |            4,806 | 1,338 bytes of host growth for the missing behavior below. At this ceiling, the measured mixed inline script plus the host would leave 2,639 shared JS bytes. |
| 512 raw WASM bytes per used module                  |              382 | 130 bytes above the assembled, bounded ripple field.                                                                                                          |
| 684 UTF-8 bytes of base64 per used module           |              512 | `4 × ceil(512 / 3)` at the approved raw ceiling. Report both sizes; they describe the same module.                                                            |

## Reproduce

Measured on 2026-11-24 against compiler commit `78bd14834b542a59095300b77215873ea8cb0b75`; `git log -1 --format=%H -- scripts/gpu-spike/worker.ts` identifies the spike revision. Apple M4 Max, arm64, macOS 27.2.1 (26B131), Node 26.13.1, esbuild 0.28.2. Local `HeadlessChrome/156.0.8078.4` reported WebGL 2.0 / OpenGL ES 3.0 Chromium, ANGLE Vulkan 1.3.0, **SwiftShader** (LLVM 10.0.0). This is a real GL implementation in software, not an Apple GPU timing benchmark.

```sh
npm ci
node --conditions=source --import tsx --test scripts/__tests__/gpu-spike.spec.ts
node --conditions=source --import tsx scripts/gpu-spike.ts
```

Use an installed Chrome/Chromium; set `CULM_CHROME` to select an executable. The last command starts a loopback server and headless browser with a fresh temporary profile and DevTools pipe, checks the actual pages, and closes both. Missing WebGL2 or an unavailable browser fails the run. Set `CULM_GPU_FRAMES=.superpowers/gpu-frames` to retain its composited PNG samples. No assembler is needed to run the checked-in fixture. To verify the module independently:

```sh
npm install --prefix .superpowers/gpu-build --ignore-scripts --no-save --no-package-lock wabt@1.0.37
.superpowers/gpu-build/node_modules/.bin/wat2wasm scripts/gpu-spike/ripple.wat -o .superpowers/gpu-build/verify.wasm
cmp scripts/gpu-spike/ripple.wasm .superpowers/gpu-build/verify.wasm
```

## What a page pays

All columns are **bytes**, uncompressed. Shared JS = UTF-8 of actual inline parts joined with `;` + every distinct lazy JS asset that can load. The 388-byte loader (observer, fixed host path, SRI and invocation) costs **389** with its join. The host is one ES2017 minified IIFE, including its worker as a quoted minified IIFE, Blob bootstrap, vertex shader, fragment wrapper, limiter and WASM glue. No separate worker price or hidden executable in the JSON. Host SHA-256: `cad57a6f982b752fe12815f38665df5a91ea8dde6f255ce31126ccdba877a857`.

| Compiled page + spike attachments                          | Compiled inline before | Inline with loader | Lazy host JS | Shared JS | JS left | WASM raw / encoded | Shade GLSL | Inert JSON | Added HTML |
| ---------------------------------------------------------- | ---------------------: | -----------------: | -----------: | --------: | ------: | -----------------: | ---------: | ---------: | ---------: |
| Control: two starter heroes, no GPU                        |                    304 |                304 |            0 |       304 |  19,696 |              0 / 0 |          0 |          0 |          0 |
| Shader: contours + custom mist                             |                    304 |                693 |        4,806 |     5,499 |  14,501 |              0 / 0 |        259 |        310 |      1,210 |
| WASM: ripple on both heroes                                |                    304 |                693 |        4,806 |     5,499 |  14,501 |          382 / 512 |         91 |        649 |      1,561 |
| Worst measured mix: Stage 3 mixed + contours, ripple, mist |                 10,828 |             11,217 |        4,806 |    16,023 |   3,977 |          382 / 512 |        350 |        946 |      1,872 |

The Stage 3 mixed scripts were recompiled, not estimated: 686 base (open + email), 1,963 states, 8,177 timeline, two separators = **10,828**. Of the former **9,172** bytes, GPU now takes **5,195**. The control made zero host requests; the uninstrumented mixed page made one and displayed a frame.

Shade GLSL counts unique effect bodies; inert JSON is the actual HTML-writer-escaped body including the GLSL, keys and any base64. Added HTML is the difference from the same compiled fixture before GPU lowering and includes the loader/join, JSON tag and data, region attributes, plane CSS and static SVG poster. These overlapping columns must not be summed. For example, the extra mixed transfer is **1,872 + 4,806 = 6,678** raw bytes, not that amount plus the decoded module. CDP, synthetic clock, readbacks, screenshot decoding and tests run separately and are not delivered by the priced artifacts.

### CSS, elements and depth after GPU attachment

| Fixture | Final CSS bytes / 16,000 | Build body elements / 2,000 | Active body elements / 2,000 | Logical depth / 12 | Raw DOM depth (browser) |
| ------- | -----------------------: | --------------------------: | ---------------------------: | -----------------: | ----------------------: |
| Control |                    7,517 |                          41 |                           41 |                  6 |                      12 |
| Shader  |                    7,920 |                          42 |                           43 |                  6 |                      12 |
| WASM    |                    7,920 |                          42 |                           43 |                  6 |                      12 |
| Mixed   |                    8,416 |                          58 |                           59 |                  6 |                      12 |

The spike parses the **final emitted HTML**. Following `compile/page.ts`, CSS is the UTF-8 size of stylesheet text, excluding `<style>` tags and inline attributes. The GPU stylesheet adds **403 bytes** to the compiled 7,517 (shader/WASM) or 8,013 (mixed). Build elements count descendants of `<body>`, including SVG elements, the joined script and the added inert data script; the head stylesheet adds no body element.

The CLI counts the uninstrumented live body in Chrome at the initial viewport, after GPU activation where applicable. Each active GPU page adds **one canvas**; the lazy script in `<head>` is outside the count. The **12-level hard limit** uses the compiler's maximum expanded page/header/footer content-tree depth, root = 1. The HTML additions do not change those trees. Chrome’s 12 raw DOM levels (`<html>` = 1) include wrappers and SVG descendants and are diagnostic only. The mixed fixture has **7,584 CSS bytes, 1,941 active body elements and 6 logical levels of headroom** at this observation.

## Shader cost inputs

The approved caps are **4,096 UTF-8 bytes per shader** and, per pixel, **64 loop passes, 16 texture reads and 512 weighted operations**. They bound work counted from source, not frame time.

| Executed `shade` body                  | Source bytes (UTF-8) | Loop passes | Texture reads | Weighted ops/pixel |
| -------------------------------------- | -------------------: | ----------: | ------------: | -----------------: |
| `contours` (two sine waves, speed = 1) |                  123 |           0 |             0 |                 20 |
| `ripple_field` (private R8 sampler)    |                   91 |           0 |             1 |                 14 |
| `mist` (custom, 3 literal iterations)  |                  136 |           3 |             0 |                 49 |

Hand ledger for these exact sources: literals/variable references/return cost 0; selection, constructor, arithmetic, comparison, initialization, assignment and increment cost 1 each; `sin` costs 4; `texture` costs 8 and one read. Count operands, charge loop init once, test `N+1` times and increment `N` times. Contours = 16 for `ridge` + 4 return; ripple = 10 for `h` + 4 return; mist = 1 initial value + 8 loop control + 3 × 12 body + 4 return. Scores apply to effect code, not the fixed host pass (two additional texture reads per pixel) or the WASM simulation. These small fixtures establish that useful effects fit; they do not exercise the boundary, reject bad GLSL, or validate a device at the caps.

### Production custom-shader cost table

`checkShader(source, settings)` in `@culmjs/core/document` (also exported from `@culmjs/core`) prices one invocation of `vec4 shade(vec2)`. Source bytes include whitespace and comments as authored, before line-ending normalization; the host prelude and wrapper are excluded. The caps above are inclusive. The checker also limits settings to **16** and nested syntax to **32** levels.

The table gives **additional** cost, independent of vector width. Add every operand or argument exactly once. In the signatures, `F` is `float` or a floating vector (`vec2`, `vec3`, `vec4`); `T` is `F` or `int`. Repeating a type letter means the same type throughout that signature.

| Source construct / signature                                                                                           | Additional weighted ops |    Additional reads |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------: | ------------------: |
| Literal, variable/input reference, parentheses, block, declaration without initializer, expression statement, `return` |                       0 |                   0 |
| Initializer, simple assignment `=`, vector component selection (including a write selection)                           |                  1 each |                   0 |
| Unary `+ - !`; binary `+ - * / % < <= > >= == != && \|\|` (charge both operands, even for logical operators)           |                  1 each |                   0 |
| Constructor `bool`, `int`, `float`, `vec2`, `vec3`, `vec4`                                                             |                       1 |                   0 |
| `abs(T)`; `min(T,T)`, `max(T,T)` (also vector/float bound)                                                             |                       1 |                   0 |
| `clamp(T,T,T)` (also two float bounds on a vector)                                                                     |                       2 |                   0 |
| `mix(F,F,F)` (also float factor on vectors)                                                                            |                       3 |                   0 |
| `sin(F)`, `cos(F)`, `dot(F,F)`                                                                                         |                       4 |                   0 |
| `length(F)`                                                                                                            |                       5 |                   0 |
| `smoothstep(F,F,F)` (also two float edges on a vector)                                                                 |                       6 |                   0 |
| `texture(u_noise, vec2)` → `vec4`                                                                                      |                       8 |                   1 |
| Typed helper call                                                                                                      |   1 + called body's ops | Called body's reads |

For **each** metric (`passes`, `reads`, `ops`):

- Sum statements in source order, conservatively including statements following a return. A helper call adds its arguments, call cost, and the complete body summary **each time**, including all its loop passes. Only completed, previously defined helpers can be called; no overloads, forward declarations or recursion. Unused definitions are checked but do not contribute per-pixel work.
- For `if`/`else` and `?:`, add the condition's cost to the **componentwise maximum** of the two arms (missing `else` = zero). There is no additional branch charge. Different arms can supply the maximum for different metrics.
- For `for(int i=0;i<N;i++)` (decimal nonnegative int literal `N`), add **`N` passes**, multiply **all** body metrics by `N`, and add **`1 + (N+1) + N` ops** for initialization, tests and increments. Thus an empty zero-trip loop costs two ops; nested iterations count the outer passes as well as the inner ones.
- Cache the three counters once per function and saturate intermediate results at the respective cap + 1. No call-tree expansion, GPU timing, device query or optimization assumptions enter a score. A work refusal points to the first top-level statement in `shade` that takes cumulative work over a cap (passes, reads, ops in that order).

The language has `bool`/`int`/`float` and float vectors, explicit scalar conversions, vector splat/packing, and swizzles within one of `xyzw`, `rgba`, `stpq`. Types must match for initialization, assignment, helper arguments and returns. Variables are local or value parameters (`in` is optional); assignments can target writable locals/parameters or their distinct components. Counters cannot be shadowed or written in the body. Inputs are read-only: `u_time` and `u_scroll` are `float`; `u_resolution` and `u_pointer` are `vec2`; `u_noise` is the only `sampler2D`. `u_set_<key>` is `float` for a finite number setting or `vec3` for a `#rrggbb` colour. Keys match `[a-z][a-z0-9_]{0,31}`, excluding unsafe fields and GLSL's reserved double underscore. The spike's `u_field` is private to a future trusted built-in.

### WebGL 2 lexical rule

The [WebGL 2.0 specification](https://registry.khronos.org/webgl/specs/2.0.0/) (“Maximum GLSL Token Size”) allows tokens of up to **1,024 characters** in both ESSL 1 and ESSL 3 shaders; longer tokens must fail to compile. The checker enforces this for each token, including identifiers and numeric literals. All tokens in the subset are ASCII. Comments and whitespace are not tokens, but still count toward the separate 4,096-byte source cap. A `shader.token` refusal gives the token's authored line, actual character count and limit of 1,024. Token length adds no per-pixel cost.

## Browser evidence

- **Composition.** `insertBlock('hero','plain',…)` and `compilePage` produced the heading, art and link. Two 1,280 × 400 hero regions occupied y=0–400 and 400–800 in a 1,280 × 900 viewport at DPR 1. Both `.s-site` and `main` kept their opaque `rgb(246,243,232)` backgrounds. One transferred 320 × 225 canvas, one worker context, separate raw and previous/next RGBA8 targets per region. The negative-z, pointer-transparent canvas is inside an isolated `main`, above its background, below the content.
- **Actual screen pixels.** At (202,16) / (202,416) the static grey codes were 112/112; after ten synthetic 60 Hz ticks they were 102/123; one further 33 ms frame yielded 102/125. At (8,850), RGB stayed (246,243,232). The foreground link interior including its label had identical RGBA SHA-256 before/after: `4205f61a80bcfa8c1748d4355163171ac427fc1339c9875e23593ee915f26613`. It won point hit-testing, Tab focused it and Enter navigated to `#w-plate`.
- **WASM → GPU → screen.** `ripple.wat` advances a damped 32 × 32 finite-difference wave, fixed 60 Hz, zero boundaries, one 64 KiB memory page (min=max), no imports. SHA-256 of raw WASM: `9c670ad9c22f68c14e778bcb41c1f947c84e862fae4cd4e98bac65724f97ee11`. Five frames sampled field byte 198 after `step(dt)` on actual R8 uploads: **128, 97, 128, 255, 128**. At that texel the raw fragment values were **134, 111, 134, 230, 134**; after the previous-displayed-frame pass: **113, 112, 113, 114, 115**. Both heroes' composited samples ended at (115,115,115). The module is stored once even when applied twice.
- **Background compile and static return.** Worker creation through first drawn-frame acknowledgement took **59.1 ms** on one instrumented run (compile, link, setup, draw and IPC included). A deliberately non-answering worker was terminated by the main-thread 1,500 ms watchdog after **1,501.8 ms**. The SVG poster stays visible until acknowledgement. Reduced motion did not request the host.
- **Slow-frame profile.** Same viewport/DPR, light scheme, normal motion. After the first frame and four 60 Hz timestamps, advance display opportunities by exactly 120 ms six consecutive times. The first five submit capped 33 ms simulation intervals; the sixth removes the canvas. This is injected display timing, not six measured GPU stalls. The complete slow-return, compile-timeout and reduced-motion screenshot PNGs were byte-identical (`93baa0d8fef170d850f227ed622fbaaaf2fe0e413d077c6f672bbd8dcc543e74` in this run).

## Luminance and independent analysis

**Proposed nominal rate: 0.25 linear-light units/channel/s, elapsed capped at 33 ms.** The limiter samples quantized **displayed** sRGB history, decodes, clamps each requested channel difference, encodes, then stores and blits the same result. An ideal unquantized 0.10 luminance excursion would take at least 400 ms at this rate. That motivates testing the candidate against general flash; it does not establish conformance.

For the observed grey 123 → 125 in 33 ms, `ΔY=0.0070094` or **0.21241/s**. A separate white-to-black target reversal at 30 Hz gave displayed grey codes `114,117,119,116,113,110,107,104`; peak `|ΔY|=0.0098276`, or **0.29483/s**. The latter exceeds the nominal rate: the pre-quantization per-frame cap is `0.25 × .033 = .00825`, with up to `.001669` half-code rounding error over this sample range. These are composited PNG measurements using sRGB decoding (R=G=B), not a claim about every pixel or saturated red.

**Independent gate: open; PEAT is not installed on this macOS machine. No general-flash or red-flash result.** Select Trace Center [PEAT 1.6, 2017-02-15 release](https://trace.umd.edu/peat/) on a compatible Windows machine; use its **Open video clip** and **Analyze** functions. [Input requirements](https://trace.umd.edu/photosensitive-epilepsy-analysis-tool-peat-user-guide/): full-screen 1024 × 768, AVI, 25 or 30 fps, <2 GB.

Frozen **Task 7 capture specification** (the spike PNGs above are not analyzer inputs):

1. Isolated headless profile, light, sRGB, DPR 1, no zoom/scroll/overlays; one opaque 1,024 × 768 region filling the viewport. Use the shipped presentation path and one deterministic clock; advance once per output frame at `n × 1000/30` ms. Reset history to the same static starting colour for both runs. Wait for the matching worker frame and compositor paint before saving the full viewport. Log frame index, requested/displayed time, dropped/duplicated frames, browser, renderer and build.
2. Capture 180 consecutive frames (6 s). Input: black for `floor(n/3) % 2 == 0`, white otherwise, RGB channels equal, alpha 1. Positive control: test-only bypass of the last-pass clamp. Limited capture: identical input, resolution, cadence, region and clock with the real limiter. The 5 Hz control must be detected. Keep these offline; no autoplay demo.
3. Store lossless numbered PNGs starting at `000.png` and encode each sequence with `ffmpeg -framerate 30 -start_number 0 -i %03d.png -frames:v 180 -an -c:v rawvideo -pix_fmt bgr24 clip.avi` (uncompressed RGB, no resizing, blending or dropped frames). Verify 180 frames, CFR 30, 1024 × 768 with `ffprobe -v error -count_frames -show_streams clip.avi`; record SHA-256 for both clips.
4. Save both PEAT reports, including raw general-flash and red-flash findings/warnings. Missing analysis, a missed control, or general-flash failure in the limited clip keeps the gate open. Even a successful pair covers only this luminance fixture, not saturated-red safety or WCAG certification.

## What the estimate leaves out

The spike attaches fixed trusted data after real compilation. It does not price a completed host: moving/overlapping/clipped owners, forms and sticky layers, visibility/context-loss recovery, device memory of “too slow”, adaptive scale-up/down, and arbitrary-poster/history initialization remain. It returns to the poster on scroll/resize; history is seeded with the poster's base grey, not its pattern. It has no complete nonfinite-output handling, source parser, plug-in/module trust checks, site-wide generated policy, dev/measure routing or published authoring operation. The watchdog proves a silent-worker deadline, not cancellation of every possible driver stall. Remeasure the real mixed artifact before accepting it against any owner-approved ceilings.
