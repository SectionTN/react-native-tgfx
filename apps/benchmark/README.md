# TgfxSkiaBench

react-native-tgfx vs `@shopify/react-native-skia`, one scene at a time, on a
release build. The app runs a scene matrix by itself and prints one
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
| `--order` | `sequential` | `alternate` runs both engines per scene |
| `--reps` | `1` | repeat the matrix; present FPS is the median across reps |
| `--present` | `atrace` | `latency` on Android ≤ 13, where `atrace gfx` has no SurfaceFlinger `queueBuffer` events |
| `--package` | `com.tgfxskiabench` | |

The plan reaches the app through the launch intent
(`bench://run?engines=…&scenes=…&order=…&reps=…`), so any launcher can drive it.

## Reading the numbers

- **Present FPS** is what the canvas actually put on screen, counted at
  SurfaceFlinger. Thread FPS says the threads are healthy, nothing more: tgfx's
  render loop coalesces off-thread, so UI can read 120 while the canvas
  presents 8.
- Both engines get a parity still per scene in `bench/shots/` (the app freezes
  the rotation at 0 for the first 1.5 s). Check them — a canvas that draws
  nothing benchmarks at 120 fps.
- Lock the refresh rate first (`settings put system peak_refresh_rate 120`,
  `min_refresh_rate 120` where the OEM allows it), make sure
  `animator_duration_scale` is `1`, and keep the phone cool between reps.

Measured tables live in `bench/RESULTS.md` and the dated `bench/results-*.md`.

## Is it fair?

What both engines get, identically:

- One set of layout arrays (`SHAPES`, `IMAGE_CELLS`, `PATHS_900`, `TEXTS`),
  one palette, one SkSL source, one stroke width, one 14 px sans-serif font,
  one rotation shared value. Each engine binds it the way its docs say to
  (tgfx slot props, skia `useDerivedValue`), both on the UI thread per frame.
- Anti-aliasing on by default in both (`JsiSkPaint` sets it; tgfx encodes
  `antiAlias` unless `false`). Both canvases `absoluteFill` and `opaque`, so
  both draw through a `SurfaceView` and the present counter reads the same
  kind of layer.
- The same measurement: present FPS at SurfaceFlinger, thread FPS from a
  frame callback and `requestAnimationFrame` that know nothing about either
  engine, CPU and PSS for the whole process, a 3 s settle, a 20 s window,
  a release build with Hermes and the new architecture.
- Assets ready before combo 0 on both sides.

What differs, on purpose:

- **Threading.** tgfx renders on its own thread; react-native-skia draws on
  the main thread. That is why skia's UI and JS columns fall while tgfx's stay
  at the refresh rate — an architectural property, and the point of the
  thread columns.
- **Graphics API.** tgfx defaults to Vulkan on Android, skia to OpenGL
  (Ganesh; Graphite is opt-in and slower here). Those are the shipping
  defaults. To see whether the API explains the gap, `-PTgfxVulkan=OFF` builds
  tgfx on OpenGL too — from source, because the GL prebuilt in
  `packages/react-native-tgfx/android/libs` may lag the submodule.
- **Stress, not typical.** Static scenes under one animated group at extreme
  counts measure the draw path, not scene rebuilds.

Checked on a Samsung SM-E146B (Exynos 1330, Android 15, 90 Hz), alternating
engines per scene so neither runs on a cooler phone:

| scene | tgfx-VK / skia-GL | tgfx-GL / skia-GL (same run, hotter phone) |
|---|---|---|
| shapes | 61.6 / 27.0 | 53.6 / 19.5 |
| images | 89.9 / 82.4 | 89.1 / 61.5 |
| shader | 15.1 / 15.1 | 15.6 / 15.0 |
| pattern | 90.1 / 90.3 | 90.3 / 90.3 |
| paths | 89.8 / 90.0 | 90.4 / 90.4 |
| text | 70.5 / 33.8 | 69.5 / 34.3 |

Order changes nothing beyond ±1 fps against the sequential run. On the same
API the margins hold or widen (skia's own numbers move with the phone's
temperature between the two runs; compare within a column), so Vulkan is not
what separates the engines. Thread columns are identical across all of it:
tgfx 91/90 everywhere, skia 15/8 … 91/90.
