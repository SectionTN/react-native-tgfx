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
