# Agent instructions — apps/benchmark

tgfx vs react-native-skia on a device. Read `README.md` for what it measures;
this file is the procedure. Every number you report must come from this
procedure — a debug build, a hot phone, a 60 Hz cap or a blank canvas all
produce plausible-looking tables.

## Build (release only)

```sh
bun install                                    # repo root; wires workspace:* tgfx
cd apps/benchmark/android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease
```

- Output: `app/build/outputs/apk/release/app-release.apk`, arm64 only.
- tgfx compiles from source when `packages/react-native-tgfx/android/libs-vulkan/arm64-v8a`
  is empty (the default `TgfxVulkan=ON`), so a submodule edit is in the APK
  after a rebuild; adding a source file under a CMake glob needs
  `touch packages/react-native-tgfx/cpp/third_party/tgfx/CMakeLists.txt` or the
  link fails with an undefined symbol.
- After changing JS on a release build, delete
  `android/app/build/generated/assets` first or the old bundle ships.
- `bun install` may print `Fail extracting tarball from react-native-skia-*`;
  check `node_modules/react-native-skia-android/libs/android/arm64-v8a` exists
  before building.

## Device prep — do all of it, every time

```sh
export ANDROID_SERIAL=<serial>                 # two phones attached = every adb call needs it
adb shell settings get global animator_duration_scale   # must be 1 — 0 freezes both canvases
adb shell settings put system peak_refresh_rate 120     # and min_refresh_rate; lock the panel
adb shell settings put system min_refresh_rate 120      # (OnePlus refuses: WRITE_SETTINGS; ask the user)
adb shell svc power stayon usb
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard
adb shell input keyevent KEYCODE_HOME          # SurfaceFlinger back to device composition
adb install -r -d android/app/build/outputs/apk/release/app-release.apk
```

- A locked or asleep phone prints `[bench] start` and then nothing: RN timers
  pause on host pause. Wake and unlock before every run.
- OnePlus/OPPO `adb install` blocks on an on-phone dialog; the package lands,
  the adb process never returns — kill it.
- Do not touch the phone during a run; a tap backgrounds the app and the rows
  stop. Incoming-call overlays do the same — check the parity stills.
- Restore `peak_refresh_rate`/`min_refresh_rate` and `svc power stayon false`
  when done.

## Run

```sh
node bench/run.mjs                                            # full 12-combo matrix, ~6 min
node bench/run.mjs --engines tgfx,skia --scenes paths --order alternate --reps 2
node bench/run.mjs --present latency                          # Android ≤ 13
```

- `--order alternate` interleaves engines per scene; use it for A/B and
  thermal-sensitive comparisons. Two reps in alternating order is the minimum
  for a before/after claim; the present column is the median across reps.
- Present FPS comes from SurfaceFlinger: `atrace gfx` `queueBuffer - SurfaceView[<pkg>`
  on Android 14+, `dumpsys SurfaceFlinger --latency` (`--present latency`) on
  Android ≤ 13. A present of 0 with healthy UI/JS means the wrong source, not
  a stalled canvas. Thread FPS (UI/JS) is never a throughput number.
- Results: `bench/results-<timestamp>.md`; rename the ones you keep to
  `results-<date>-<device>-<hz>-<what>.md`. Parity stills: `bench/shots/<engine>-<scene>.png`
  — open two and confirm both engines drew the scene before quoting anything.
- Run-to-run noise on one phone is about ±1.5 fps at 90–120 fps and ±1 fps on
  the CPU-bound scenes; thermal drift is larger. For a regression call, cool
  the phone (`KEYCODE_SLEEP`, 75 s) and interleave old/new builds.

## Profiling the render thread

```sh
adb shell "atrace -a com.tgfxskiabench -t 6 -b 32768 gfx view" > trace.txt   # tgfx.draw / tgfx.submit markers
adb shell simpleperf record --app com.tgfxskiabench -e cpu-clock -g --duration 6 -o /data/local/tmp/perf.data
```

Report with `--symfs` pointing at a folder holding `lib/arm64-v8a/libNitroTgfx.so`
copied from `android/app/build/intermediates/merged_native_libs/release/…`
(unstripped); tgfx-internal frames resolve only through `llvm-symbolizer` on the
offsets. `debuggerd` and `kill -QUIT` need root or a debuggable build.

## Do not

- Benchmark a debug build, an emulator, or a phone in 60 Hz auto mode and
  call it a comparison.
- Switch git branches while an APK from this tree is running on a device.
- Edit the scene definitions for one engine only; both engines share the
  layout arrays in `App.tsx` on purpose.
