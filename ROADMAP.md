# Roadmap — react-native-tgfx

Status: both platforms render and animate (iOS Metal + Android OpenGL), verified
on a physical Android device and the iOS Simulator. This document tracks known
issues and planned improvements.

Legend: 🔴 high priority · 🟠 medium · 🟡 nice-to-have · ✅ done

---

## ✅ Done — performance + stability pass (commit `c7a9662`)

- ✅ **Dirty-driven redraw** — `draw()` is a no-op when nothing changed.
- ✅ **Compile-once command list** — scene JSON is parsed/compiled once per change
  (not every frame); images, SVG paths, typefaces and static shaders resolved up
  front. Per-frame work is now only value-slot resolution + draw.
- ✅ **Idle loop suspension** — Choreographer / CADisplayLink pause when idle and
  resume on change.
- ✅ **Stable Reanimated subscription** — re-subscribe only when the SharedValue
  set changes; Canvas dedupes scene/value state.
- ✅ **Thread-safety** — immutable shared_ptr program under a mutex; documented model.
- ✅ **Per-frame allocations** — one reused Paint; no std::function in the hot path.
- ✅ **Bounded image cache** + error logging for parse/decode/font failures.

---

## Build & packaging

- 🔴 **iOS device build + universal xcframework.** The tgfx static lib is built
  for the arm64 *simulator* only (`SIMULATORARM64`). Add an `OS64` device build
  and a device+sim `.xcframework`.
- 🔴 **Automate the tgfx static lib.** `scripts/build-tgfx-ios.sh` is a manual
  pre-`pod install` step. Move it to a podspec `prepare_command` or ship a
  prebuilt xcframework as a release artifact.
- 🔴 **Bootstrap script for tgfx deps.** `cpp/third_party/tgfx/third_party`
  (depsync output) is gitignored; a fresh clone can't build until re-fetched.
  Add a `postinstall`/setup script (submodule init + targeted dep fetch).
- 🟠 **tgfx patches.** The vendor `CONFIG_DIR` / `-s` / shaderc-stub fixes are
  applied to the submodule working tree by self-healing CMake (Android) and the
  iOS build script. Replace with a tracked `.patch` file or a tgfx fork the
  submodule points at, so the gitlink can reference the patched commit.
- 🟠 **Multi-ABI Android.** Currently built/tested for `arm64-v8a` only; add
  `x86_64`/`armeabi-v7a` for emulators and older devices.
- 🟠 **npm publish readiness.** `package.json` `files` includes `cpp` (would
  publish the whole tgfx submodule). Define a binary-distribution strategy and
  set up `release-it`/versioning.
- 🟡 **Optional reanimated, for real.** Metro statically bundles the lazily
  required driver, so consumers without reanimated fail to bundle. Use the
  Skia-style `Proxy`/optional-require or a separate entry point.
- 🟡 RN-version compatibility matrix (currently pinned to RN 0.85 / Nitro 0.35.9).

## Rendering engine (features + perf)

- 🔴 **Dirty-driven redraw.** The render loop draws every vsync even when idle.
  Redraw only on scene/value change, with an opt-in continuous animation loop.
- 🟠 **Dedicated GPU render thread.** Rendering currently runs on the main/UI
  thread (matches tgfx's samples); move GPU work off the main thread.
- 🟠 **Full animated-prop coverage.** Value slots cover geometry, opacity, and
  transform ops (rotate/scale/translate). Add slots for colors, strokeWidth,
  gradient stops/endpoints, path data, fontSize, and text.
- 🟠 **Native image handles.** Images travel as base64 in the scene JSON (bloat +
  per-image decode). Expose an `SkImage`-like HybridObject with native decode /
  zero-copy / texture caching; make `useImage` use it.
- 🟠 **Group layer + opacity.** Group opacity currently multiplies into child
  alpha (not a real `saveLayer`); add `<Group layer>`, `clip`, and `zIndex`.
- 🟠 **More tgfx surface:** blend modes, color/image filters, blur, shadows,
  masks, path trim (start/end), fillType, and dash/path effects.
- 🟡 **Robust SVG path parser.** Elliptical arcs (`A/a`) are approximated as a
  line to the endpoint; implement true arc-to-bezier.
- 🟡 **Text layout.** Only single-line `drawSimpleText`. Add multiline/paragraph,
  alignment, font weight/style, measurement, custom fonts from assets, emoji/RTL.
  Android relies on hardcoded `/system/fonts/*.ttf` (OEM-fragile).
- 🟡 `makeImageSnapshot` for export/share; wide-gamut/P3 color handling.

## Animation / Reanimated

- 🟠 Re-subscribe the `useAnimatedReaction` mapper only when the value *set*
  changes (currently re-subscribes on every commit due to new array identity).
- 🟠 Send values via a shared ArrayBuffer instead of a fresh `number[]` per frame
  (fewer allocations/conversions for many values).
- 🟡 Examples + tests for gesture-driven (gesture-handler is installed but
  unused), `withDecay`, `useDerivedValue`, `useClock`.
- 🟡 Document that animated `rotate`/`skew` expect radians (`'45deg'` strings are
  static only); consider auto-handling degrees.

## Reconciler / JS API

- 🟠 The HostConfig is cast (`as unknown`) with stubbed suspense/hydration
  members — test Suspense (image loading), error boundaries, concurrent features.
- 🟠 Incremental/diff updates to native (Skia diffs a command list); currently
  the whole scene re-serializes to JSON every commit (O(n)).
- 🟡 Verify hooks/effects/context behave in the custom reconciler exactly like
  the main renderer (the example creates SharedValues in the main tree to be safe).
- 🟡 Tighter `<Paint>`/gradient child semantics (multiple paints, scoping, z-index).

## Testing & CI

- 🔴 **Automated tests** — unit tests for `colors`/`transform`/compiler,
  react-native-harness E2E, and visual/snapshot regression.
- 🔴 **CI** — GitHub Actions for typecheck/lint + iOS & Android builds; device
  farm for render/animation checks. (Verification so far is manual screenshots +
  agent-device.)
- 🟡 agent-device iOS gestures need `sudo DevToolsSecurity -enable`; only
  `screenshot` works without it — document or automate for iOS interaction tests.
- 🟡 Enforce eslint/prettier in CI.

## Robustness / DX

- 🟠 Surface errors to JS: invalid scene JSON / bad path data / bad colors are
  silently swallowed in C++ (`catch(...) return`).
- 🟡 `onSize`/`onLayout` callback from the native view; debug overlay / perf
  counters.
- 🟡 Validate many Canvases on screen (e.g. in a `FlatList`) — multiple GPU
  surfaces, recycling, and memory under reuse.
- 🟡 Web / macOS / Windows targets (tgfx supports them).

---

### Suggested first five

1. Dirty-driven redraw.
2. iOS device build + universal xcframework.
3. Bootstrap script for tgfx deps (clone → build).
4. Native image handles (drop base64-in-JSON).
5. Unit tests + CI.
