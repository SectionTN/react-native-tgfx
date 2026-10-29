# tgfx vs react-native-skia 3.8.1, measured independently

Samsung SM-E146B (Exynos 1330, Mali-G68), Android 15, 90 Hz (peak and min refresh
locked at 90). Release builds, Hermes, new architecture, arm64, portrait.
`react-native-tgfx@0.0.2-alpha.12` and `react-native-skia@3.8.1` from npm, unpatched.

Measured with a separate app and runner written outside this repo, not with
`bench/run.mjs`, so the published numbers are checked rather than repeated:

- The `doc*` scenes re-implement this app's scenes (`App.tsx`): the same counts,
  spacing, palette, SkSL, 14 pt font and a full turn every 4 s. The others are neutral
  layouts.
- Both canvases are opaque `SurfaceView`s.
- Present FPS from `dumpsys SurfaceFlinger --latency` present timestamps of the canvas
  layer (not `atrace`). UI FPS from a Reanimated frame callback, JS FPS from
  `requestAnimationFrame`.
- Every run is a cold start, 5 s warm-up, 12 s measured. Engines alternate per scene and
  swap order on the second repeat. 20 s idle between runs, and a wait before each until
  no CPU cluster is frequency-capped.
- Android thermal status was 0–1 throughout, and the GPU clock cap stayed at 949 MHz.
- A frozen-pose capture of every scene on both engines confirmed both drew the same thing.

Present FPS is the mean of 2 runs; the range is min–max.

| engine · scene | Present FPS | range | UI FPS | JS FPS | p95 frame ms | GPU busy | GPU MHz | busiest thread |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| tgfx · docShapes | 60.5 | 60.1–60.9 | 90 | 90 | 22.2 | 81% | 876 | TgfxRender 97% |
| skia · docShapes | 25.8 | 25.8–25.9 | 90 | 90 | 55.4 | 100% | 949 | RNSkia Present 24% |
| tgfx · docImages | 90.3 | 90.2–90.3 | 90 | 90 | 11.2 | 67% | 427 | TgfxRender 50% |
| skia · docImages | 66.1 | 63.9–68.4 | 90 | 90 | 22.3 | 72% | 583 | RNSkia Present 33% |
| tgfx · docShader | 15.0 | 15.0–15.0 | 90 | 90 | 66.6 | 99% | 949 | UI 13% |
| skia · docShader | 9.3 | 9.2–9.3 | 90 | 90 | 144.1 | 100% | 949 | UI 15% |
| tgfx · docPattern | 90.3 | 90.3–90.3 | 90 | 90 | 11.2 | 37% | 208 | TgfxRender 17% |
| skia · docPattern | 84.8 | 84.3–85.2 | 90 | 90 | 22.1 | 72% | 213 | RNSkia Present 24% |
| tgfx · docPaths | 90.3 | 90.3–90.3 | 90 | 90 | 11.2 | 66% | 433 | TgfxRender 57% |
| skia · docPaths | 17.6 | 17.3–17.9 | 90 | 90 | 77.6 | 99% | 949 | UI 13% |
| tgfx · docText | 68.3 | 67.1–69.4 | 90 | 90 | 22.2 | 79% | 755 | TgfxRender 97% |
| skia · docText | 34.4 | 33.7–35.1 | 90 | 90 | 44.3 | 75% | 935 | RNSkia Render 72% |
| tgfx · shapes (overlapping) | 17.4 | 17.4–17.5 | 90 | 89 | 66.5 | 99% | 949 | TgfxRender 27% |
| skia · shapes (overlapping) | 3.7 | 3.6–3.7 | 90 | 90 | 282.6 | 100% | 949 | UI 12% |
| tgfx · images (4 PNGs) | 38.3 | 37.2–39.5 | 90 | 90 | 33.4 | 51% | 208 | TgfxRender 97% |
| skia · images (4 PNGs) | 81.8 | 80.9–82.8 | 90 | 90 | 22.2 | 84% | 911 | RNSkia Present 48% |
| tgfx · shader (value noise) | 10.4 | 10.4–10.4 | 90 | 90 | 99.8 | 100% | 949 | UI 13% |
| skia · shader (value noise) | 6.5 | 6.5–6.5 | 90 | 90 | 199.5 | 100% | 949 | UI 15% |
| tgfx · pattern (PNG) | 90.3 | 90.2–90.3 | 90 | 90 | 11.2 | 38% | 208 | TgfxRender 18% |
| skia · pattern (PNG) | 84.7 | 84.4–85.0 | 90 | 90 | 22.1 | 75% | 208 | RNSkia Present 25% |
| tgfx · text (dense) | 73.1 | 71.8–74.5 | 90 | 90 | 22.2 | 71% | 355 | TgfxRender 97% |
| skia · text (dense) | 34.0 | 33.9–34.0 | 90 | 90 | 44.4 | 56% | 427 | RNSkia Render 97% |

## Reading it

- **Docs layouts:** tgfx leads every scene. Shapes and text hold the published ratios.
  Images, shader, pattern and paths changed with Skia 3.8.1: this app's 3.0.0 table had
  Skia at 42–45 / 15.0 / 89.9 / 82.5–86.1 there, and 3.8.1 measures 66.1 / 9.3 / 84.8 / 17.6.
- **Threads:** neither engine drops the UI or JS thread below 90 on any scene. Skia 3.8.1
  records on its own threads, so the earlier finding that Skia drags UI and JS down (e.g.
  30/30 on the shader) no longer holds.
- **GPU-bound scenes** (shader, Skia's paths and shapes) run at 99–100% GPU busy at the full
  949 MHz on both engines; the difference there is the GPU work each engine generates.
- `docPattern`: Skia's `ImageShader` defaults to nearest sampling and tgfx's to linear, so
  tgfx does slightly more filtering work there; the scene keeps both defaults as written.

## Cross-check with this app's own runner

The two Skia results furthest from the 3.0.0 table were re-measured with this app
(upgraded to 3.8.1) and `bench/run.mjs` (`atrace` present counter), engines alternating,
1 rep, 20 s gap: paths tgfx 90.1 / skia 17.8, shader tgfx 15.1 / skia 9.3
(`results-2026-10-29-samsung-90hz-skia381-crosscheck.md`). Both match the independent harness.
