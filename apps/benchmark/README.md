# TgfxSkiaBench

react-native-tgfx vs `react-native-skia` 3.8.1 (Graphite on Vulkan), one scene at a
time, on a release build. Two engines: `tgfx` and `skia`; since 3.8 skia has a single
`Canvas`, on Graphite (3.0's separate `GraphiteCanvas` is gone). The app runs a scene matrix by itself and prints one
`[bench] tick engine=… scene=… js=… ui=…` line per second to logcat;
`bench/run.mjs` on the host pairs those with CPU (`/proc/<pid>/stat`), PSS
(`dumpsys meminfo`) and the presented frame rate (SurfaceFlinger), and writes a
table to `bench/results-<timestamp>.md`.

Scenes: 20,000 shapes, 3,600 images, a 40-octave full-screen shader, a
repeating image pattern, 900 cubic paths (half stroked) and 6,000 texts — each
under one animated rotation driven by a shared value.

## Run

```sh
bun install                                   # from the repo root
cd apps/benchmark/android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
cd .. && ANDROID_SERIAL=<serial> node bench/run.mjs
```

Benchmark **release** builds only — a debug build measures the debug overhead,
not the engines. Leave the phone alone while it runs: a touch backgrounds the
app and the rows stop.

`run.mjs` flags:

| flag | default | |
|---|---|---|
| `--engines` | `tgfx,skia` | engine order; `skia,tgfx` runs skia first |
| `--scenes` | all six | subset, e.g. `paths,text` |
| `--order` | `sequential` | `alternate` runs every engine per scene |
| `--reps` | `1` | repeat the matrix; present FPS is the median across reps |
| `--gap` | `0` | seconds idle between combos, no canvas mounted, so heat from one run is not carried into the next |
| `--present` | `atrace` | `latency` on Android ≤ 13, where `atrace gfx` has no SurfaceFlinger `queueBuffer` events |
| `--package` | `com.tgfxskiabench` | |

The plan reaches the app through the launch intent
(`bench://run?engines=…&scenes=…&order=…&reps=…`), so any launcher can drive it.

## Reading the numbers

- **Present FPS** is what the canvas actually put on screen, counted at
  SurfaceFlinger. Thread FPS says the threads are healthy, nothing more: tgfx's
  render loop coalesces off-thread, so UI can read 120 while the canvas
  presents 8.
- **CPU %** is the whole process, 100 = one core, timed on the device clock.
  The second table splits it by thread (two `/proc/<pid>/task` snapshots 8 s
  apart; pool threads summed under one name, so `RNSkia Render 1–4` reads as
  one `RNSkia Render`). **Graphics / Native / Java MB** are the `dumpsys
  meminfo` App Summary rows; Graphics is GPU buffers and textures.
- Every engine gets a parity still per scene in `bench/shots/` (the app freezes
  the rotation at 0 for the first 1.5 s). Check them — a canvas that draws
  nothing benchmarks at 120 fps.
- Lock the refresh rate first (`settings put system peak_refresh_rate 120`,
  `min_refresh_rate 120` where the OEM allows it), make sure
  `animator_duration_scale` is `1`, and keep the phone cool between reps.

Measured tables live in `bench/RESULTS.md` and the dated `bench/results-*.md`.

## Is it fair?

What every engine gets, identically:

- One set of layout arrays (`SHAPES`, `IMAGE_CELLS`, `PATHS_900`, `TEXTS`),
  one palette, one SkSL source, one stroke width, one 14 px sans-serif font,
  one rotation shared value. Each engine binds it the way its docs say to
  (tgfx slot props, skia `useDerivedValue`).
- Anti-aliasing on by default (`JsiSkPaint` sets it; tgfx encodes
  `antiAlias` unless `false`). Every canvas is `absoluteFill` and opaque, and
  each draws through a `SurfaceView`, so the present counter reads the same
  kind of layer: tgfx by default, skia through
  `android={{ backingView: 'SurfaceView' }}` (3.8 defaults to a `TextureView`).
- Vulkan on Android for both: tgfx by default, react-native-skia 3 because
  Graphite is its only Android backend.
- The same measurement: present FPS at SurfaceFlinger, thread FPS from a
  frame callback and `requestAnimationFrame` that know nothing about any
  engine, CPU and PSS for the whole process, a 3 s settle, a 20 s window,
  a release build with Hermes and the new architecture.
- Assets ready before combo 0 on every side.

What differs, on purpose:

- **Threading.** tgfx renders on its own `TgfxRender` thread; skia 3.8 records
  on a four-thread `RNSkia Render` pool and submits from `RNSkia Present`. Neither
  drags the UI or JS thread below the refresh rate on any scene (3.0's `Canvas`
  fell to 30/30 on the shader; 3.8.1 holds 90/90).
- **Stress, not typical.** Static scenes under one animated group at extreme
  counts measure the draw path, not scene rebuilds.

Samsung SM-E146B (Exynos 1330, Android 15, 90 Hz), react-native-skia 3.8.1,
measured independently: a separate app re-implementing these scenes and a separate
runner (SurfaceFlinger `--latency` present timestamps), engines alternating, mean of
2 runs, thermal status 0–1 throughout
(`bench/results-2026-10-29-samsung-90hz-skia381-independent.md`, which also has
neutral layouts):

| scene | tgfx | skia 3.8.1 | skia 3.0.0 `Canvas` (Oct 2) | skia 2.11.1 `Canvas` (GL, Sep 16) |
|---|---|---|---|---|
| shapes | 60.5 | 25.8 | 20.4 | 27.0 |
| images | 90.3 | 66.1 | 42.1 | 82.4 |
| shader | 15.0 | 9.3 | 15.0 | 15.1 |
| pattern | 90.3 | 84.8 | 89.9 | 90.3 |
| paths | 90.3 | 17.6 | 82.5 | 90.0 |
| text | 68.3 | 34.4 | 25.4 | 33.8 |

UI and JS hold at 90 for both engines in every row. Skia 3.8.1's shader and paths
rows run at 99–100 % GPU busy at the full 949 MHz; this app and `bench/run.mjs`
reproduce them (paths 17.8, shader 9.3:
`bench/results-2026-10-29-samsung-90hz-skia381-crosscheck.md`).
