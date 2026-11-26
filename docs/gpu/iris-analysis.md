# Independent luminance and red-flash analysis

[EA IRIS](https://github.com/electronicarts/IRIS/tree/d96978ac1107f3463b77f69a9c1b1ec5d45291a0) is the independent analyzer used for this release decision on macOS. PEAT did not run. The original achromatic checks are retained below.

## Production host `c3f76b6df86ca585`

The production checked host `c3f76b6df86ca58552cee72159cac104fd83e25c9e7747c516d36695b9c7f06a` (worker `38d52b3f5cf4e3f7e82c937d1ce2e3be7c1781d71ed7eeadedf7bbe3b6f98348`, 9,513 host bytes including WASM `field-v1` support) regenerated all four 180-frame offline captures with byte-identical AVI `clipSha256` hashes to `host-2844a4b873444f70` (`a132dfcbb8b292ab...`, `f872ca2cba925b72...`, `3aa0e7444f3363bc...`, `bd0d25e0770d332f...`). See [summary.json](evidence/iris/host-c3f76b6df86ca585/summary.json) and [Task 7 metadata](evidence/task-7/host-c3f76b6df86ca585/).

## Checked host `2844a4b873444f70`

IRIS analyzed four six-second, 30 fps full-screen captures of the same generated host and worker. The first pair alternates black and white at 5 Hz; the second pair alternates black and saturated red (`#ff0000`) at the same cadence. Within each pair, only the positive control bypasses the limiter, in the offline harness. The red control exercises the red detector; passing the grey clip alone would not demonstrate that.

| Input (180 frames each) | Luminance                 | Red flash                 | Overall |
| ----------------------- | ------------------------- | ------------------------- | ------- |
| Black/white control     | 159 fail, 9 warn, 12 pass | 180 pass                  | FAIL    |
| Black/white limited     | 180 pass                  | 180 pass                  | PASS    |
| Black/red control       | 159 fail, 9 warn, 12 pass | 159 fail, 9 warn, 12 pass | FAIL    |
| Black/red limited       | 180 pass                  | 180 pass                  | PASS    |

**Decision:** retain the tested nominal rate of **0.25 linear-light units/channel/s**, with elapsed time capped at **33 ms**, for this renderer. Neither limited clip had warnings on either channel. This closes the independent flash-analysis check for these fixtures, not a general accessibility certification. See the [presentation and quantization bounds](flash-analysis.md#what-the-corrected-limiter-bounds).

[Input, executable, settings and report hashes](evidence/iris/host-2844a4b873444f70/summary.json) · [Four original frame reports and analyzer logs](evidence/iris/host-2844a4b873444f70/) · [Red capture metadata and frame timing](evidence/task-7/host-2844a4b873444f70/saturated-red/). The two achromatic report hashes also match the independent run on the previous build byte for byte.

## Corrected candidate `e96e87e`

Each corrected input was hashed and analyzed again with the same executable and settings. IRIS flagged the positive control (**159 failure frames**, 9 warning, 12 pass) and **passed all 180 frames** of the corrected limited clip with no luminance warnings. All 180 frames of both clips passed the red-flash check; the source contains no saturated red. The regenerated control and its analysis were byte-identical to the prior control. There is still no PEAT result.

| Variant | Input AVI SHA-256                                                  | Original uncompressed IRIS CSV SHA-256                             | Raw frame report                                            |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Control | `a132dfcbb8b292ab5f550a40a96695f2c5408b03cc3a4e6b3b0af855baf7b699` | `feafba726bc6e75bd5dd108afa3ebb688ed65bcff93a7adaa981229b8bfcdec7` | [control CSV, gzip](evidence/iris/corrected-control.csv.gz) |
| Limited | `f872ca2cba925b72649f58e36a9b3fb2c40919c0f4d45878e742abc26f39f4a7` | `a18ad70422d081fb2d3c2ca0b2fd3519cd3b7990253ad4e75150b523845048f4` | [limited CSV, gzip](evidence/iris/corrected-limited.csv.gz) |

## Original candidate, before the poster correction

| Input at Culm `258ea14`     | Frames | IRIS luminance result                  | IRIS red result | Raw frame report                                           |
| --------------------------- | -----: | -------------------------------------- | --------------- | ---------------------------------------------------------- |
| Unfiltered positive control |    180 | **FAIL**: 159 fail, 9 warning, 12 pass | 180 pass        | [control CSV, gzip](evidence/iris/original-control.csv.gz) |
| Limited                     |    180 | **PASS**: 180 pass, no warnings        | 180 pass        | [limited CSV, gzip](evidence/iris/original-limited.csv.gz) |

The control had up to 10 luminance transitions in a one-second window; the limited clip had zero threshold crossings. Both had zero red transitions. Neither input contains saturated red. The timestamps span 0 to 5.966 s. The CLI exits zero even when it finds a flash failure; the results above are from the frame classifications and overall-result log.

| Variant | Input AVI SHA-256                                                  | Original uncompressed IRIS CSV SHA-256                             |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Control | `a132dfcbb8b292ab5f550a40a96695f2c5408b03cc3a4e6b3b0af855baf7b699` | `feafba726bc6e75bd5dd108afa3ebb688ed65bcff93a7adaa981229b8bfcdec7` |
| Limited | `eb32b73410b02a0f49aea61ce645f3baeed557d2446a7d09eea0aa104e36a6c5` | `e5ae77bd833bc7430aa6a051f6798628ac3d24b7fbd341e2f1eedb9e72aec379` |

## Reproduce

The unmodified IRIS example CLI was built from upstream commit `d96978ac1107f3463b77f69a9c1b1ec5d45291a0` on macOS arm64 with Apple Clang (C++17, `-O2`), OpenCV 4.12.0, FFmpeg 7.1.1, spdlog 1.17.0, fmt 12.1.0, and nlohmann/json 3.12.0. The local executable SHA-256 was `8633460d60455f4ecf5139e7d9ee8b84c4796787b41101c86d3200c0d1235226`. Input clips were checked by SHA-256 before analysis.

1. Build `IrisApp` per upstream instructions, or on macOS use `clang++ -std=c++17 -O2 -Iinclude -Iutils/include -Isrc src/*.cpp utils/src/*.cpp example/main.cpp $(pkg-config --cflags --libs opencv4 spdlog libavformat libavcodec libavutil) -o IrisApp` with those libraries available. The local build adds an rpath to the isolated dependency prefix.
2. Give each input its own working directory. Copy the unmodified [`config/appsettings.json`](https://github.com/electronicarts/IRIS/blob/d96978ac1107f3463b77f69a9c1b1ec5d45291a0/config/appsettings.json) into it (SHA-256 `9b9bbaec85c3c0a04a16d12e1c71299fe58797c42f4b24a04f6489d69b541572`). Run `IrisApp -v /absolute/path/to/clip.avi -p false -r false` there. No playback, frame resize or spatial pattern test; default flash area is 25% (196,608 of 786,432 pixels).
3. Save the overall-result log and `Results/<input filename>/framedata.csv`. `LuminanceFrameResult` and `RedFrameResult` use `0=pass`, `1=warning`, `2=extended failure`, `3=flash failure`. The archived CSVs preserve IRIS’s original bytes, including NULs before line endings. For example, `gzip -dc original-control.csv.gz | tr -d '\000'` displays a text copy.

For the four-clip check, use the repo's capture driver and Python 3.11+ wrapper:

```sh
node --conditions=source --import tsx scripts/gpu-flash-capture.ts
node --conditions=source --import tsx scripts/gpu-flash-capture.ts --red
python3 scripts/gpu-flash/analyze-iris.py \
  --app /path/to/IrisApp --settings /path/to/IRIS/config/appsettings.json \
  --captures .superpowers/gpu-flash/host-2844a4b873444f70 \
  --output .superpowers/gpu-flash/iris-2844a4b873444f70
```

The wrapper hashes the captures, checks the control/limited worker selection, then requires the expected overall verdicts and all 180 enumerated frame classifications in each report. There is no video playback.
