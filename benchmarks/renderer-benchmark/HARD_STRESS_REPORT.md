# Hard main-thread stress benchmark

Date: 2026-07-29  
Device: Samsung SM-E146B, Android 15, locked to 60 Hz  
Accepted runs: 12, three fresh processes per backend

## Hard preset

- 3,200 deterministic logical objects
- 6,400 fill/stroke renderer nodes plus background
- 15 ms of controlled main-thread work on every Choreographer callback
- 5-second warmup
- 15-second measured window
- Release, Hermes, Fabric, arm64-v8a
- Every accepted run started at or below 36°C skin temperature and remained thermal status NONE

The 15 ms pressure deliberately leaves only about 1.67 ms of a 60 Hz frame budget for commits, renderer integration, and platform work. It is identical for every backend and exists specifically to expose main-thread headroom.

## Results

Values are medians across three accepted runs.

| Backend | Main-thread FPS | Main p99 | Main missed frames | JS update FPS | Process CPU | Peak PSS |
|---|---:|---:|---:|---:|---:|---:|
| Tgfx GPU | **59.31** | 33.23 ms | **14** | 9.74 | 303.0% | 231.6 MiB |
| Thor GPU | **57.59** | 33.23 ms | **39** | 41.13 | 224.9% | 241.3 MiB |
| Skia Graphite | **54.55** | 83.06 ms | **89** | 3.85 | 209.6% | 337.0 MiB |
| Thor CPU | **48.44** | 33.26 ms | **176** | 39.71 | 204.1% | 175.0 MiB |

### Main-thread FPS raw values

| Backend | Run 1 | Run 2 | Run 3 | Range |
|---|---:|---:|---:|---:|
| Tgfx GPU | 59.31 | 59.36 | 58.84 | 58.84–59.36 |
| Thor GPU | 57.50 | 57.59 | 58.61 | 57.50–58.61 |
| Skia Graphite | 55.04 | 54.55 | 54.29 | 54.29–55.04 |
| Thor CPU | 48.44 | 46.89 | 48.63 | 46.89–48.63 |

## Finding

The hard test now exposes a repeatable main-thread ranking:

1. Tgfx keeps the most main-loop headroom.
2. Thor GPU is about 1.7 FPS behind Tgfx.
3. Skia Graphite is about 4.8 FPS behind Tgfx and has rare, much longer main-thread stalls.
4. Thor CPU is the most main-thread-bound, about 10.9 FPS behind Tgfx and missing roughly 176 display frames per measured window.

Thor CPU rasterizes through `SwCanvas` on the Android main thread, so it degrades most when the remaining per-vsync budget is extremely small. Thor GPU moves raster work to `GLThread`, and Tgfx draws on `TgfxRender`, leaving the Android main looper more responsive.

Skia Graphite has a different failure shape: its median main FPS is better than Thor CPU, but its 83 ms p99 indicates rarer multi-frame stalls. Its JS update rate falls to about 3.85 FPS because rebuilding 6,400 Skia draw nodes is extremely expensive in this structural-churn workload.

Tgfx wins only the main-thread-FPS comparison. Its JS update rate is 9.74 FPS and total process CPU reaches about three cores, so it is not the overall throughput or CPU-efficiency winner.

## Interpretation

- Main-thread FPS is the Android main-looper Choreographer callback rate, not final display presentation FPS.
- The 15 ms pressure is synthetic and intentionally dominates one core. Process CPU includes this common load.
- The test answers: “Which integration preserves main-loop responsiveness when almost the entire 60 Hz main-thread budget is already occupied?”
- It does not replace the original unbiased 400-object benchmark in `BENCHMARK_REPORT.md`.

## Artifacts

- `artifacts/hard-raw-runs.json`: all 12 accepted trials
- `artifacts/hard-results-summary.json`: medians, IQRs, ranges, and raw values
- `artifacts/hard-calibration.json`: 12 ms calibration
- `artifacts/hard-calibration-15ms.json`: 15 ms calibration
- `scripts/run-hard-campaign.mjs`: repeatable thermal-gated campaign
- `scripts/analyze-hard-results.mjs`: aggregation

## Verification

- Unit tests, TypeScript checking, linting, and the Android release build passed
- APK SHA-256: `7c97401a2f4e7eac293b138ad78a8b0bf21faf9ec4bfbb2bf5527ba23e2fb9a1`
