# Supplemental luminance and red-flash analysis

[EA IRIS](https://github.com/electronicarts/IRIS/tree/d96978ac1107f3463b77f69a9c1b1ec5d45291a0) analyzed the two offline, achromatic 30 fps clips. This is evidence about these captured pixels; it does not establish saturated-red safety or replace the selected [PEAT 1.6 exit check](flash-analysis.md).

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
