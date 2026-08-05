# Roadmap — react-native-tgfx

Status: both platforms render and animate (iOS Metal + Android OpenGL), verified
on a physical Android device and the iOS Simulator. This document tracks known
issues and planned improvements.

Legend: 🔴 high priority · 🟠 medium · 🟡 nice-to-have · ✅ done

---

## ✅ Done — renderer performance pass (this branch)

Measured on a Samsung SM-E146B (Mali-G68) and the iPhone 17 Pro Simulator, 400
objects with 15 ms of main-thread pressure per vsync; medians of 3–5 accepted
runs are in `benchmarks/renderer-benchmark/artifacts/quick-*.json`.

- ✅ **Scene off the Fabric prop path** — the draw program goes straight to the
  hybrid object (`setScene`), not through a React re-render + shadow-tree commit.
  Android main-thread FPS 54.1 → 56.9, main p99 33.2 → 22.2 ms.
- ✅ **Binary wire format** — the compiler writes a flat `Float64Array` program
  plus a string table over a zero-copy Nitro `ArrayBuffer`; no `JSON.stringify`,
  no `nlohmann` parse. Native scene compile fell to 1.32 ms/frame; app frames
  +12%, JS FPS +3.6, CPU −10 points.
- ✅ **SurfaceView instead of TextureView** — the canvas is its own compositor
  layer, so a new frame costs the app window no traversal or HWUI redraw.
  Peak PSS 149 → 135 MB.
- ✅ **Allocation-free paint resolution** — paint fields are read from props with
  the inherited paint as fallback, instead of building a merged paint object per
  node. JS FPS 42.7 → 48.6.
- ✅ **iOS renders off the main thread** — the display link enqueues onto a serial
  render queue. iOS main-thread FPS 58.2 → 59.9, main p99 33.3 → 16.7 ms.
- ✅ **iOS device pixel ratio** — the Metal view never told the renderer its
  scale, so the whole scene drew at 1/3 size on a 3× screen.

### Measured next frontier

`context->flush()` is 29.7 ms of the ~37 ms render-thread frame (Perfetto,
400 objects). Inside it, `DrawingBuffer::encode()` is 27.5 ms: ~800 draw ops at
~32 µs each (geometry 2.8 µs, program key + lookup 3.9 µs, uniforms 10.2 µs,
draw call 15.2 µs). Batching is limited because the scene alternates fill and
stroke, and `OpsCompositor::ShouldFlushRectOps` flushes on every alternation.
Reducing per-op cost in tgfx's GL backend is where the remaining gap to
`react-native-nitro-thor` lives.

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
- ⚠️ **Per-frame allocations** — one reused Paint and no std::function in the hot
  path, but the draw loop is *not* allocation-free: an animated `<Line>` builds a
  Path per frame, `RuntimeShaderCmd::build` deep-copies its uniforms per frame,
  and an animated `fontSize` re-lays out its text whenever the quantised size
  moves. Text no longer rebuilds a TextBlob on every draw (#127).
- ✅ **Bounded image cache** + error logging for parse/decode/font failures.

---

## ✅ Done — native image handles (this branch)

- ✅ **`TgfxImage` handle instead of base64.** A Nitro HybridObject backed by a
  process-wide `ImageRegistry`; the draw program carries an integer id, so the
  string table no longer scales with image bytes and a re-commit does no hashing
  and no decode. `useImage` keeps its signature and returns the handle.
- ✅ **No native → JS → native round trip.** A local file (a `file:` URI, or a
  bundled asset resolving to a path) is opened and decoded natively. A remote or
  Metro-served URI still uses `fetch`, but hands over the `ArrayBuffer` — the
  hand-rolled JS base64 encoder is gone.
- ✅ **Decode off the render thread — on every path.** `ImageCodec::makeBuffer()`
  runs on Nitro's thread pool and the promise resolves only once the pixels
  exist. `ImageRegistry::acquire()` never decodes at all: an entry the byte
  budget dropped comes back empty, the re-decode goes to the registry's own
  worker, and the node skips frames until it lands. No frame waits on a decode,
  including after an eviction.
- ✅ **Byte-bounded LRU + `dispose()`.** Keyed on the handle (an integer, so no
  unverified-hash collision can draw the wrong bitmap), 64 MB of decoded pixels
  by default, recency refreshed on a hit. Replaces the 32-entry FIFO.
- ✅ **A GPU texture budget.** `Context::setCacheLimit` was never called, leaving
  tgfx's 512 MB default. A decoded image is resident twice — CPU pixels the
  `BufferImage` holds for the Image's life, and the texture uploaded from them —
  so `setImageCacheLimit()` now sets both, and there is one number rather than
  a CPU budget and an unrelated GPU constant.
- ✅ **Skia parity for `<Image>`** — the full seven-mode `fit` set (Flutter's
  `BoxFit`, so `cover` crops the source rather than overflowing), `sampling`
  including real mipmaps via `makeMipmapped`, a source `rect` for sprite sheets,
  and a full paint (it used to carry only alpha).
- ✅ **`<ImageShader>`** — an image as a paint source for any shape, with
  `clamp`/`repeat`/`mirror`/`decal` tiling and a `fit` rect.
- ✅ **Hardware-buffer source.** `imageFromNativeBuffer()` imports an
  `AHardwareBuffer*` / `CVPixelBufferRef` straight to a GPU texture, YUV-aware
  and synchronous, and `setNativeBuffer()` re-points an existing handle per
  frame. The draw path resolves an external handle every frame rather than
  caching the image at compile time, so the swap needs no re-commit, does not
  pin the producer's previous buffer, and moves the registry epoch the render
  loop's dirty check folds in — a new frame with no commit behind it still
  draws. Held outside the decoded-pixel budget, so a 16 ms frame is not treated
  as a long-lived asset. This is what `<CameraFrame>` (#132) draws.

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
- 🟠 **tgfx patches.** The vendor `CONFIG_DIR` fix is now a tracked patch
  (`patches/0003-vendor-config-dir.patch`) applied by `apply-tgfx-patches.sh`
  from both builds. The `-s` / shaderc-stub fixes still edit `third_party/`,
  which tgfx gitignores and depsync re-fetches, so they cannot be patch files;
  upstreaming them to vendor_tools is the only fix left.
- 🟠 **Multi-ABI Android.** All four ABIs link (`arm64-v8a`, `armeabi-v7a`,
  `x86`, `x86_64`); only `arm64-v8a` is run on a device and built in CI, so the
  others are compile-tested only.
- 🟠 **npm publish readiness.** `package.json` `files` includes `cpp` (would
  publish the whole tgfx submodule). Define a binary-distribution strategy and
  set up `release-it`/versioning.
- 🟡 **Optional reanimated, for real.** Metro statically bundles the lazily
  required driver, so consumers without reanimated fail to bundle. Use the
  Skia-style `Proxy`/optional-require or a separate entry point.
- 🟡 RN-version compatibility matrix (currently pinned to RN 0.85 / Nitro 0.35.9).

## Rendering engine (features + perf)

- ✅ Android decodes images in-process (#151): `TGFX_USE_{PNG,JPEG,WEBP}_DECODE`
  are forced on beside the encoders, so EXIF orientation is honoured, no decode
  crosses JNI, and the path is the one the host tests exercise. Costs ~1.4 KB —
  libjpeg-turbo and libwebp were already linked for the encoders.
- ℹ️ #150 turned on more than its title says: `SetJavaVM` boots `SurfaceTexture`,
  `HandlerThread` and `AndroidBitmap` as well as the codec bridge. Nothing here
  uses them directly yet; anything that starts to is live from that commit on.

- 🟠 **Full animated-prop coverage.** Value slots cover geometry, opacity,
  strokeWidth, fontSize, transform ops (rotate/scale/translate), shader uniforms
  and colour (as `[r, g, b, a]`, scene version 16). Add slots for gradient
  stops/endpoints, path data, and text.
- 🟠 **Native `<ImageSVG>`.** SVG *documents* are not parsed, only single path
  data strings. Needs tgfx's SVG module (`TGFX_BUILD_SVG`, currently off).
- 🟠 **Colour and image filters on `<Image>`.** The scene graph has no
  `ColorFilter`/`BlendMode` node at all, so blend-mode tint, matrix colour
  filters, blur and drop shadow are unavailable. `<Image>` now carries a full
  paint, so the wire format has room for them.
- ✅ **Camera frames as scene inputs (#132).** `<CameraFrame>` places a live
  hardware-buffer handle over the canvas and draws the rest of the scene through
  the same matrix, in frame-pixel coordinates, with `rotation`/`mirror` folded
  into it. `drawCameraFrame` is gone from the spec, the renderer and both
  platforms. Sampling the frame *inside a runtime shader* still needs #130.
- 🟠 **Native asset loading on Android.** A `require()`d asset in a release build
  resolves to a bare drawable-resource name, and `asset://` / `content://` URIs
  need the JNI `AssetManager`/`ContentResolver`. Both still go through JS
  `fetch`. iOS release assets and any `file:` URI already load natively.
- 🟠 **`<ImageShader transform>`.** Skia's `ImageShader` takes a transform on top
  of `fit`/`rect`; here the only way to move one is a `<Group>`, which moves the
  shape too.
- 🟠 **Group layer + opacity.** Group opacity currently multiplies into child
  alpha (not a real `saveLayer`); add `<Group layer>`, `clip`, and `zIndex`.
- 🟠 **More tgfx surface:** blend modes, color/image filters, blur, shadows,
  masks, path trim (start/end), fillType, and dash/path effects.
- 🟡 **Robust SVG path parser.** Elliptical arcs (`A/a`) are approximated as a
  line to the endpoint; implement true arc-to-bezier.
- 🟡 **Text layout.** Only single-line `drawSimpleText`. Add multiline/paragraph,
  alignment, font weight/style, measurement, custom fonts from assets, emoji/RTL.
  Android relies on hardcoded `/system/fonts/*.ttf` (OEM-fragile).
- ✅ Pixel readback: `<Canvas ref>` exposes `snapshot()` and `save(path)`.
- 🟡 Wide-gamut/P3 colour handling, including on readback (snapshots come back
  as sRGB straight-alpha RGBA8888).

## Animation / Reanimated

- 🟠 Re-subscribe the `useAnimatedReaction` mapper only when the value *set*
  changes (currently re-subscribes on every commit due to new array identity).
- 🟠 Send values via a shared ArrayBuffer instead of a fresh `number[]` per frame
  (the scene already travels this way; `setValues` still takes `number[]`).
- 🟡 Examples + tests for gesture-driven (gesture-handler is installed but
  unused), `withDecay`, `useDerivedValue`, `useClock`.
- 🟡 Document that animated `rotate`/`skew` expect radians (`'45deg'` strings are
  static only); consider auto-handling degrees.

## Reconciler / JS API

- ✅ Imperative writes (`useNode()` + `ref` on a drawing node, `CanvasHandle.redraw()`):
  a slotted prop is patched in place — from the JS thread or from inside a worklet —
  and anything else re-encodes without React. `color`, a `<Group>`'s transform
  operands and a `<Shader>`'s `uniforms` are patchable too (#160), and the surface
  has its own docs page. Still open: slots for `path`/`text` (#49), and structural
  add/remove/reorder (#160).
- 🟠 The HostConfig is cast (`as unknown`) with stubbed suspense/hydration
  members — test Suspense (image loading), error boundaries, concurrent features.
- 🟠 Incremental/diff updates to native (Skia diffs a command list); currently
  the whole scene is re-encoded every commit (O(n), but now allocation-free).
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
4. Colour/image filters on `<Image>` (the paint is now carried; the filters are not).
5. Unit tests + CI.
