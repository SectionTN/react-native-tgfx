# tgfx vs @shopify/react-native-skia — measured results

Device: **Samsung SM-E146B** (Galaxy M14, arm64-v8a, Android 15, Mali GPU, **90 Hz** display).
Release builds, one engine mounted at a time, 2.5 s warmup discarded, 6 s measurement
window, 3 runs per config with lib order flipped each run, median reported.

Metrics: `uiFps` = UI-thread driver callbacks/s (Reanimated `useFrameCallback`);
`jsFps` = JS-thread `requestAnimationFrame` ticks/s; `prsFps` = frames actually
presented (`dumpsys gfxinfo` total frames / window); `jank%` and `f95` from gfxinfo;
`cpu%` = process CPU over the window; `pssMB` = TOTAL PSS.

Harness: `apps/benchmark/bench.sh` + `agg.py`. Parity: `parity.sh` + `paritydiff.py`.

---

## Iteration 0 — baseline

| N | lib | uiFps | jsFps | prsFps | jank% | f95 | cpu% | pssMB |
|---:|:---|---:|---:|---:|---:|---:|---:|---:|
| 100 | tgfx | 90.29 | 90.12 | **45.41** | 95.5 | 12 | 71.6 | 197.0 |
| 100 | skia | 90.29 | 90.14 | 90.98 | 0.0 | 13 | 85.4 | 201.1 |
| 300 | tgfx | 90.27 | 90.26 | **45.40** | 100.0 | 14 | 80.3 | 194.8 |
| 300 | skia | 90.29 | 90.29 | 90.84 | 0.0 | 14 | 87.7 | 195.2 |
| 600 | tgfx | 90.29 | 90.29 | **45.41** | 100.0 | 16 | 83.8 | 186.0 |
| 600 | skia | 90.29 | 89.96 | 90.57 | 0.2 | 16 | 92.8 | 192.5 |
| 1000 | tgfx | 90.29 | 89.79 | **45.03** | 99.6 | 17 | 94.8 | 188.4 |
| 1000 | skia | 84.73 | 43.51 | 81.81 | 9.9 | 31 | 118.1 | 190.9 |
| 1500 | tgfx | 90.12 | 80.25 | **38.49** | 100.0 | 21 | 111.3 | 199.8 |
| 1500 | skia | 55.38 | 28.35 | 56.45 | 61.7 | 44 | 112.9 | 202.6 |

**Where tgfx already wins:** UI-thread and JS-thread FPS at N >= 1000
(at N=1500: uiFps +62.7%, jsFps +183%). Lower CPU at every count. Slightly lower PSS.

**Where tgfx loses:** presented FPS, at *every* count. It is pinned at **45.4 fps on a
90 Hz display — exactly half refresh rate — with ~100% jank**, and the value is
identical at N=100 and N=600, so it is not scene-walk cost. It is a fixed cost in the
present path.

Verdict: one structural defect dominates everything. Fix presentation and tgfx wins
all three FPS metrics at every count.

---

## Harness rebuilt for fairness (before iteration 1)

An adversarial fairness audit of the harness found the *decision rule* was weaker
than the noise, so the following were fixed before trusting any further number:

- A metric now counts as a win only when the two engines' **run ranges do not
  overlap** (tgfx min beats skia max). A 3-run median swing is not a win.
- Metrics pinned within 2% of the observed refresh ceiling are reported as
  `capped` and decided on `f95` instead, which has no ceiling.
- Run order is flipped on `(run + countIndex + workloadIndex) % 2` with an even
  run count, so each engine runs first exactly half the time per config.
- PSS is sampled **mid-window while the canvas is still mounted** (it previously
  sampled ~0.5 s after unmount, which measured teardown speed, not footprint),
  plus an idle baseline PSS with both libraries loaded and nothing mounted.
- SharedValues are allocated once for the whole sweep and reused, so late
  configs don't pay for earlier ones' leaked mutables.
- Failed `dumpsys` parses emit `NA` instead of `0` (a `0` for jank/f95 is the
  *best* possible score, so a broken row used to look like a perfect row).
- A discarded pre-roll config per engine absorbs cold start / first shader compile.
- Skia gets `colorSpace="srgb"` so it is not silently color-managing.
- More than one workload (see below) — the old single-primitive test could not
  support a general claim.
- Per-thread CPU for main / JS / RenderThread, and device temperature per row.

Workloads: `leaves` (N circles, 2 animated scalars each), `group` (N static
circles under one animated group transform), `mixed` (circles + rects + rounded
rects + stroked rects), `idle` (N static circles, zero animated values),
plus single-primitive probes `rects` / `rrects` / `strokes`. All are driven from
a Reanimated worklet on the UI thread; each engine animates through **its own
documented fast path** (tgfx: SharedValue props; Skia: SharedValue props, and a
`useDerivedValue` transform array for the group case, per Skia's docs).

---

## Iteration 1 — fix presentation (draw from a looper message, not a Choreographer callback)

`TgfxTextureView` drew inside a `Choreographer.postFrameCallback`, which runs in
the ANIMATION phase — *before* the view hierarchy's TRAVERSAL. The buffer it had
just produced was therefore not visible to the traversal that immediately
followed, and the TextureView picked up only every other frame. tgfx was
rendering **90.3 fps and presenting 45.2** — doing 2x the GPU work and discarding
half of it.

Fix: produce from a coalesced main-looper message, which lands after traversal.
This is what Skia does (`RNSkView::requestRedraw` -> `runOnMainThread`). It also
deleted the whole idle-suspension mechanism: with no loop there is nothing to pause.

Measured immediately: produced 90.3 -> consumed **90.3** (was 45.2).

Full sweep (median of 4 runs, `[min-max]` across runs):

| wl | N | lib | uiFps | jsFps | prsFps | f95 | jank% | mainCPU% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|---:|
| leaves | 100 | tgfx | 90.2 | 90.0 | 89.4 | 14 | 0.4 | 40.0 | 211 |
| leaves | 100 | skia | 90.1 | 90.0 | 89.4 | 13 | 0.4 | 38.0 | 198 |
| leaves | 600 | tgfx | 90.1 | 89.9 | 88.9 | 14 | 0.9 | 60.1 | 214 |
| leaves | 600 | skia | 90.0 | 86.0 | 88.5 | 18 | 1.3 | 67.0 | 194 |
| leaves | 1500 | tgfx | 82.2 | 60.6 | 48.6 | 23 | 72.9 | 87.5 | 219 |
| leaves | 1500 | skia | 56.1 | 28.9 | 56.4 | 43 | 60.5 | 87.7 | 202 |
| group | 1500 | tgfx | 90.1 | 90.0 | 88.9 | **9** | 0.5 | **41.4** | 219 |
| group | 1500 | skia | 90.0 | 89.5 | 89.2 | 17 | 0.4 | 49.0 | 203 |
| mixed | 600 | tgfx | 85.5 | 54.6 | **38.5** | 22 | **99.3** | 89.2 | 217 |
| mixed | 600 | skia | 87.4 | 47.5 | 81.9 | 26 | 8.8 | 83.2 | 202 |
| idle | 600 | tgfx | 59.8 | 59.6 | 0.2 | 20 | 100.0 | 11.5 | 207 |
| idle | 600 | skia | 60.1 | 60.1 | 0.2 | 12 | 0.0 | 10.6 | 198 |

Idle baseline PSS (both libs loaded, nothing mounted): **94.8 MB**.

Kept: jank at N<=600 went from ~100% to 0.0-0.9%, and presented FPS from 45 to
~89 — parity with Skia. `group` is a clear tgfx win (f95 9 ms vs 17 ms, main
thread 41% vs 49%). `leaves`@1500 shows tgfx far ahead on both thread metrics
(uiFps +46%, jsFps +110%, f95 -47%) but the run ranges overlap, so not yet a
statistically clean win.

Still losing:
1. **`mixed`@600 presents 38.5 vs 81.9 with 99.3% jank** — the largest remaining
   defect. `leaves`@600 (all circles) presents 88.9, so mixing draw kinds, not
   count, is what breaks it.
2. `leaves`@1500 presented 48.6 vs 56.4.
3. PSS consistently +7-10% (tgfx requests `EGL_STENCIL_SIZE 8` for the window
   config; Skia requests 0 — untested hypothesis).
4. `idle` jank 100% on tgfx's handful of frames.

### Single-primitive probes — is any draw kind slow?

600 animated shapes of ONE kind, median of 3 runs. Answer: no — tgfx wins every
primitive, so `mixed`'s collapse is caused by *interleaving* kinds, not by cost.

| workload@600 | tgfx prs / f95 / mainCPU | skia prs / f95 / mainCPU |
|:---|:---|:---|
| circles | 89.5 / **13** / 58 | 89.7 / 16 / 58 |
| rects | 89.1 / **13** / 59 | 89.2 / 15 / 61 |
| rounded rects | **87.8** / **14** / **63** | 86.5 / 21 / 77 |
| stroked rects | **87.7** / **14** / **64** | 86.0 / 21 / 76 |

Confirmed in tgfx's source: `OpsCompositor::canAppend` breaks the batch when
`pendingType != type` (`src/gpu/OpsCompositor.cpp:383`). Colour is explicitly not
a batch breaker ("Ignore the color differences"), which is why 600 differently
coloured circles batch fine. Alternating circle/rect/rrect/stroked-rect defeats
it on every single draw.

---

## Iteration 2 — driver: `startMapper` instead of `useAnimatedReaction`

`useAnimatedReaction` runs `previous.value = input` every frame
(`react-native-reanimated/src/hook/useAnimatedReaction.ts`), so tgfx's driver was
writing an N-element **array** into a SharedValue on every frame — a blocking
shareable clone of 3000 values at N=1500 — on top of the fresh array its
`prepare` allocated. Skia's driver (`Rea.startMapper`) does neither.

Replaced with a raw `startMapper` that fills a buffer allocated once. Removes one
3000-element clone and one 3000-element allocation per frame. Kept.

---

## Iteration 3 — dedicated GPU render thread

Native phase profiling of `draw()` on-device (`TGFXRN_PROFILE` build) at 600
circles: `render` 300 us, `flush` 100 us, **`submit` (eglSwapBuffers) ~1900 us**,
lock/unlock 58 us. So ~80% of the native frame cost was the blocking swap — and
all of it was on the **main thread**.

Moved surface creation, drawing, flush and swap onto a dedicated
`HandlerThread` at `THREAD_PRIORITY_DISPLAY`. Surface teardown blocks the main
thread on a latch so the `Surface` is never released while the render thread is
still using it. Verified off-thread: `drawTid` != `valuesTid` in the profile output.

Full sweep, median of 4 runs:

| wl | N | lib | uiFps | jsFps | prsFps | f95 | jank% | mainCPU% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|---:|
| leaves | 100 | tgfx | 90.1 | 89.9 | 88.9 | **12** | 0.5 | **27.2** | 238 |
| leaves | 100 | skia | 90.1 | 89.8 | 89.3 | 13 | 0.4 | 39.1 | 207 |
| leaves | 600 | tgfx | 90.1 | **89.9** | 89.0 | **14** | 0.7 | **46.4** | 239 |
| leaves | 600 | skia | 90.0 | 84.0 | 88.2 | 18 | 1.5 | 71.3 | 206 |
| leaves | 1500 | tgfx | **89.7** | **62.5** | 45.0 | **22** | 96.2 | **81.5** | 243 |
| leaves | 1500 | skia | 51.1 | 26.3 | 51.1 | 47 | 73.7 | 89.8 | 211 |
| group | 1500 | tgfx | 90.1 | 90.0 | 89.1 | **10** | 0.4 | **16.9** | 244 |
| group | 1500 | skia | 90.0 | 89.6 | 89.3 | 17 | 0.5 | 48.8 | 213 |
| mixed | 600 | tgfx | 90.0 | **88.2** | 65.4 | **15** | 35.4 | **43.2** | 238 |
| mixed | 600 | skia | 88.6 | 45.5 | 83.8 | 28 | 6.8 | 84.2 | 209 |
| idle | 600 | tgfx | 60.1 | 60.0 | 0.2 | 19 | 100.0 | 10.6 | 224 |
| idle | 600 | skia | 60.0 | 59.9 | 0.2 | 13 | 0.0 | 11.3 | 201 |

Headline: **main-thread CPU is 30-65% lower than Skia at every workload**, frame
times (f95) 8-54% lower, and at N=1500 tgfx holds **+76% UI-thread FPS and +137%
JS-thread FPS**. `leaves`@600 is a clean sweep with zero losing metrics.
`mixed`@600 presented FPS went 38.5 -> 65.4.

Remaining losses, in priority order:
1. **PSS +11-16% at every workload**, and tgfx's PSS *climbs across the sweep*
   (206 -> 247 MB) while Skia's stays roughly flat — a leak, not just a constant
   overhead. Idle baseline (both libs loaded, nothing mounted) is 95 MB.
2. **Presented FPS under saturation**: `mixed`@600 65.4 vs 83.8, `leaves`@1500
   45.0 vs 51.1 — both cases where the main thread is >80% busy.
3. **Total process CPU is higher** even though main-thread CPU is much lower
   (work moved to the render thread, and the swap wait appears to be charged as
   CPU).
4. `idle` jank 100% / f95 19 vs 13 on the handful of frames tgfx does render.

### Pixel parity after iteration 3 — PASS

5 rounds x 11 scenes, both engines rendering the same scene at the same pixel
size in one screenshot, two fixed crops.

A flat "% of pixels differing" is not a usable gate between two independent
rasterizers — it is dominated by anti-aliasing noise on curved edges. Measured
directly: in every failing scene **100.0% of differing pixels lay on an
anti-aliased edge and 0 lay in a shape interior**. So the diff now splits into
interior (real errors) vs edge (AA), plus geometry invariants.

| scene | interior diff | edge (AA) diff | bbox drift | coverage diff |
|:---|---:|---:|---:|---:|
| rects, rrects, strokes, path, lingrad, radgrad | **0.0000%** | **0.0000%** | 0 px | <=0.003% |
| opacity | **0.0000%** | 0.0072% | 0 px | 0.486% |
| transform | **0.0000%** | 0.0735% | 0 px | 0.011% |
| ovals | **0.0000%** | 0.3263% | 0 px | 0.024% |
| lines | **0.0000%** | 0.2523% | 1 px | 0.036% |
| circles | **0.0000%** | 0.8108% | 0 px | 0.047% |

**Interior difference is 0.0000% on every scene in every round** — geometry,
size, position, colour, gradients, stroke widths and transforms match Skia
exactly. Six scenes are bit-identical. The only differences are sub-pixel AA
coverage on curves and diagonals, which is inherent between two rasterizers.

---

## Iteration 4a — EGL stencil hypothesis: TESTED AND REVERTED

Memory was the one metric tgfx lost, so it was attributed rather than guessed.
`dumpsys meminfo` mid-window, same workload, same canvas size:

| category | tgfx | skia | delta |
|:---|---:|---:|---:|
| EGL mtrack | 45.1 MB | 26.3 MB | **+18.8** |
| GL mtrack | 12.6 MB | 9.8 MB | +2.8 |
| Native heap | 80.3 MB | 78.9 MB | +1.4 |
| Dalvik heap | 12.5 MB | 8.8 MB | +3.7 |
| **TOTAL PSS** | **223.0** | **195.0** | **+28.0** |

So the entire gap is graphics memory, not heap. Hypothesis: tgfx asks for
`EGL_STENCIL_SIZE 8` on the window config while Skia asks for 0
(`EGLGlobals.cpp:62`), and nothing in tgfx's GL backend ever enables a stencil
test — no op, task or processor references `stencilState`.

Implemented an override via tgfx's public `EGLGlobals::Set()` requesting
`EGL_STENCIL_SIZE 0, EGL_DEPTH_SIZE 0`. A diagnostic confirmed the override was
actually installed and the chosen config had `stencil=0 depth=0`.

Result: **EGL mtrack unchanged at 45097 KB, TOTAL PSS unchanged (223.5 vs 223.0).**
Hypothesis falsified — the driver was not allocating a stencil attachment.
**Reverted**, per the "no improvement, no code" rule. The +28 MB remains
unexplained; it is ~4 canvas-sized buffers of EGL memory vs Skia's ~1, which
points at swapchain buffer count rather than attachment format.

---

## Iteration 4b — built-in shaders (Skia-compatible API)

Added, with the same component names and prop names Skia uses so scenes port
over unchanged:

- `<SweepGradient c start end colors positions>` (tgfx `MakeConicGradient`;
  verified tgfx takes **degrees**, matching Skia)
- `<DiamondGradient center r colors positions>` (tgfx-only, no Skia equivalent)
- `<FractalNoise freqX freqY octaves seed>` (tgfx `MakeFractalNoise`)
- `<Turbulence freqX freqY octaves seed>` (tgfx `MakeTurbulence`)

Also fixed a real API bug found by typechecking the benchmark: tgfx's runtime
already supported `transform={[{ rotate: sharedValue }]}` but its public
`TransformOp` type only allowed plain numbers, so the animated-transform path
was untypeable.

Parity for the new shaders (5 rounds), which also demonstrates the gate is not
rubber-stamping — it caught a real difference:

| scene | interior | edge (AA) | coverage | verdict |
|:---|---:|---:|---:|:---|
| sweep | **0.0000%** | **0.0000%** | 0.000% | **bit-identical to Skia** |
| noise (FractalNoise) | **28.99%** | 0.12% | 0.044% | **differs — real** |
| turb (Turbulence) | **24.84%** | 1.83% | 1.105% | **differs — real** |

`SweepGradient` is pixel-perfect against Skia. **`FractalNoise` and `Turbulence`
render a different pattern from Skia's** — total coverage matches within ~1%, so
overall density/brightness is right, but tgfx's and Skia's Perlin
implementations use different gradient tables, so the noise field itself is not
the same. This is an engine difference, not a wiring bug, and it is a documented
limitation rather than a silent failure.

---

## Iteration 5 — acting on the second (adversarial) methodology audit

A second audit was run against the parity and perf methodology. It found one
**real bug in the renderer** and several ways the reporting overstated the case.
Acted on:

**Renderer bug (fixed).** `TgfxRenderer::draw()` cleared `dirty_` *after* it had
already snapshotted `values_`. `setValues` runs on the UI thread while `draw`
runs on the render thread, so an update landing between the snapshot and the
clear was swallowed — leaving a permanently stale frame once an animation
stopped. `dirty_` is now cleared with an `exchange` *before* the snapshot, and
restored on every early-out path.

**Measurement honesty (fixed).**
- tgfx's own render thread was never sampled: `find_tid RenderThread` finds
  *HWUI's* thread, not tgfx's `TgfxRender`. The per-thread table therefore
  understated tgfx. Added a `gfxC%` column.
- Total process `cpu%` is now printed in every table with its run range. After
  moving work to a second thread, main-thread CPU means "cost *located on this
  thread*", not "cost" — total CPU is the honest cost metric, and it is the one
  tgfx does *not* clearly win.
- The verdict counted the CPU axis up to three times (`cpu` is the sum that
  already contains `mainCpu` and `jsCpu`) and the memory axis once. Reduced to
  one metric per independent axis: `prsFps`, `uiFps`, `f95`, `cpu`, `pss`.
- Device temperature was printed but never written to the row data. Now stored.
- Pre-roll only warmed circles, so the first shader compile for rects / rounded
  rects / strokes landed on whichever engine ran first. Pre-roll is now `mixed`.
- Workload order was fixed (all `leaves`, then `group`, then `mixed`, then
  `idle`), confounding workload with thermal drift over a ~9 minute sweep.
  Workloads are now interleaved and rotated per run.
- Removed asymmetric instrumentation: a per-frame counter and a once-a-second
  `Log.w` in tgfx's `onSurfaceTextureUpdated` that had no Skia counterpart and
  shipped in the measured release APK.

**Known limits of these results, stated rather than hidden:**
- `f95` / `jank%` come from `dumpsys gfxinfo`, which measures **HWUI** frames.
  Skia rasterizes on the main thread so its raster cost is inside that measure;
  tgfx now rasterizes on its own thread, so its raster cost is not. The f95
  comparison is therefore not like-for-like across the threading change.
- `uiFps` is a *decoupling* metric, not throughput: tgfx coalesces draw requests
  and never back-pressures the UI thread, so under saturation it can report a
  high uiFps while presenting fewer frames. At `leaves`@1500 that is exactly
  what happens (uiFps 89.7 vs 51.1, but presented 45.0 vs 51.1). Presented FPS
  is the throughput metric.
- The parity suite covers static scenes only, up to 24 shapes. It does not cover
  text, images, or the animated-slot path that the entire perf benchmark runs
  through.

---

## Iteration 6 — draw-order batching: TESTED AND REVERTED

`mixed`@600 was the largest remaining loss (presented 49.5 vs 86.2). Root cause
established by elimination: no single primitive is slow (tgfx wins circles,
rects, rounded rects and stroked rects individually), and
`OpsCompositor::canAppend` breaks tgfx's pending batch whenever the op type
changes, so a scene alternating four draw kinds costs one GPU op per shape.

Implemented a z-order-safe reorder in `SceneRenderer::drawList`: commands are
bucketed by the batch tgfx would keep them in, and a command may be deferred
past commands of other kinds **only if their bounds do not overlap** (two
non-overlapping draws commute, so stacking order is not observably changed). A
new `zorder` parity scene — 10 deliberately overlapping shapes of alternating
kinds — was added first, specifically to catch a stacking regression.

Correctness held: `zorder` interior diff **0.0000%**, bbox drift 0 px.

Performance did not:

| metric (tgfx) | without reorder | with reorder |
|:---|---:|---:|
| mixed@600 presented | 49.5 [48-62] | 52.5 [46-70] |
| mixed@600 total cpu | 142.1 | 136.0 |
| leaves@1500 presented | 53.9 [44-71] | 44.6 [44-67] |
| leaves@600 presented | 87.3 | 88.4 |

Ranges overlap on every metric and `leaves`@1500 got worse. The reason is
visible in the workload: shapes are animated by +/-35% of a grid cell, so they
genuinely overlap their neighbours, the per-bucket accumulated bounds grow to
cover almost everything, and the conflict test fires almost immediately — the
reorder rarely gets to happen. A precise per-command overlap test would be
O(n^2). **Reverted** (~90 lines removed); the `zorder` parity scene was kept
because it is useful coverage regardless.

## Iteration 6b — render thread ownership

`TgfxTextureView` created one `HandlerThread` per canvas and only stopped it in
`release()`, which runs from `onDropView`. Measured 4-5 live `TgfxRender` threads
during a sweep. Changed to a single process-wide render thread (net code
deletion: no per-view thread, no `quitSafely` lifecycle).

**Honest result: the thread count measured 4 both before and after**, and all
four are created within 40 ms of each other in one process, so `sharedHandler()`
is somehow entered four times despite being `@Synchronized`. The count is stable
across a whole sweep in both variants, so there is no unbounded leak and the
"leak" framing was wrong. The four-thread observation is **unexplained and worth a follow-up.**

It was kept because it turned out to be a measured win on the metric that
mattered most. Iteration 5 and the final state differ *only* in thread
ownership, and `mixed`@600 presented FPS went **49.5 [48-62] -> 65.8 [64-72]**,
non-overlapping ranges. Total CPU on that workload got worse (142 -> 160).

---

## Final verified state

Median of 4 runs, `[min-max]` across runs, parity re-verified on the same build.

| wl | N | lib | uiFps | jsFps | prsFps | f95 | mainCPU% | total cpu% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|---:|
| leaves | 100 | tgfx | 90.1 | 89.9 | 89.1 | **12** | **27.7** | 103.8 | 235 |
| leaves | 100 | skia | 90.1 | 89.9 | 89.4 | 13 | 38.7 | 84.1 | 210 |
| leaves | 600 | tgfx | 90.1 | **89.9** | 87.6 | **14** | **47.1** | **103.2** | 229 |
| leaves | 600 | skia | 89.9 | 79.3 | 87.3 | 19 | 73.7 | 109.9 | 204 |
| leaves | 1500 | tgfx | **88.9** | **62.0** | 44.0 | **22** | **80.5** | 128.1 | 241 |
| leaves | 1500 | skia | 50.6 | 26.2 | 51.0 | 46 | 88.8 | 111.9 | 213 |
| group | 1500 | tgfx | 90.1 | 89.9 | 88.7 | **10** | **17.0** | 116.0 | 242 |
| group | 1500 | skia | 90.0 | 89.8 | 89.1 | 17 | 49.6 | 89.4 | 214 |
| mixed | 600 | tgfx | **90.1** | **88.5** | 65.8 | **15** | **43.4** | 159.7 | 240 |
| mixed | 600 | skia | 87.6 | 49.6 | 82.2 | 29 | 83.6 | 117.0 | 217 |
| idle | 600 | tgfx | 59.9 | 59.9 | 0.2 | 23 | 11.3 | 16.5 | 226 |
| idle | 600 | skia | 59.8 | 59.9 | 0.2 | 13 | 11.2 | 16.4 | 208 |

`leaves`@600 is a **clean win with zero losing metrics**, including total CPU
(-6.1%). Frame times beat Skia at every animated workload (-7.7% to -53%).
Main-thread CPU is 28-66% lower everywhere. At N=1500 tgfx holds +76%
UI-thread FPS and +137% JS-thread FPS.

Remaining losses, honestly stated:
1. **Total process CPU +14 to +37%** at N=100, N=1500, `group` and `mixed`. This
   is the honest cost metric and tgfx loses it: work moved off the main thread,
   it did not disappear.
2. **PSS +9 to +13%**, entirely EGL/GL graphics memory (~4 canvas-sized buffers
   vs Skia's ~1), not heap. The EGL memory *is* reclaimed on unmount, so it is
   live cost, not a leak. The stencil hypothesis was tested and disproved.
3. **Presented FPS under saturation**: `mixed`@600 65.8 vs 82.2, `leaves`@1500
   44.0 vs 51.0.
4. `idle` f95 23 vs 13 — on ~1 presented frame per window, so a sample size of
   about one; not meaningful as stated.

---

## Iteration 7 — zero-copy values buffer: TESTED AND REVERTED

`group`@1500 (1 animated value) costs 17% main-thread CPU while `leaves`@1500
(3000 animated values) costs 80% for *identical draw work*, so the value pipeline
— not rendering — is what saturates the main thread. Replaced
`setValues(number[])` with a natively-owned buffer: `getValuesBuffer(count)`
returning an `ArrayBuffer` over memory the renderer reads directly, the worklet
writing into a `Float64Array` over it, and the engine taking a
`std::span<const double>` instead of a vector.

Measured: tgfx uiFps **90.1 -> 61.0** and no frames drawn at all. The per-frame
`getValuesBuffer` call is a Nitro HybridObject round trip that re-materialises
the `ArrayBuffer` in the worklet runtime on every invocation, which costs more
than the 3000-element array marshalling it replaced. Hoisting the buffer out of
the worklet requires caching it across worklet invocations, which
`react-native-worklets` explicitly warns against (`freezeObjectInDev`).
**Reverted** across spec, JNI, Kotlin, C++ and Swift.

Kept from the attempt: the iOS driver no longer boxes every value into an
`NSNumber` per frame (`values.withUnsafeBufferPointer` instead).

---

## Iteration 8 — hack removal (second audit)

A second audit reviewed the change set against "no workarounds; if it needs
multiple lines of comment to explain, the code is wrong". It found **two real
bugs** and a lot of state that existed only to bridge boundaries that shouldn't
exist. All fixed by deletion:

**Bugs**
- **`imageCache_` / `typefaceCache_` data race.** `setScene` ran on the Fabric
  mount thread and mutated both maps unlocked, while `clearCaches()` erased them
  from the render thread — concurrent `unordered_map` insert vs `clear()` is UB.
  The header comment asserted this could not happen. Fixed by making the render
  thread the single owner: `setScene` is now posted like every other native call.
- **`{ translate: [sv, sv] }` rendered frozen.** `isAnimatedTransform` used
  `Object.values(op).some(isSharedValue)`, which does not look inside arrays, so
  an animated `translate` pair was classified static and snapshot once. The
  `lit()` helper I had added to make the types compile turned that into a
  *silent* wrong render instead of a loud one.

**Deletions**
- `CountDownLatch` + `TimeUnit` + a 2-second `await` for surface teardown. Root
  cause was returning `true` from `onSurfaceTextureDestroyed`, which demands a
  synchronous rendezvous; returning `false` keeps ownership so the release is an
  ordinary post. The timeout was worse than useless — after stalling the main
  thread for 2 s it proceeded to release the surface anyway, i.e. the exact
  use-after-free the latch existed to prevent.
- `posted` AtomicBoolean coalescing, replaced by `removeCallbacks` + `post`.
- `hasSurface`, the per-view `HandlerThread`, and the hand-rolled `@Synchronized`
  lazy init (now `by lazy` in a `TgfxRenderThread` object).
- The `dirty_` boolean and its three `store(true)` restores, replaced by a
  generation counter: an early-out simply does not advance `drawnVersion_`, so
  the lost-update race is structurally impossible and the 4-line comment
  explaining it is gone.
- The whole `TGFXRN_PROFILE` block (file-scope mutable globals, paired macros,
  a magic 120-frame report interval) plus its CMake flag and the duplicated
  gradle arguments. It was per-process, so its numbers would be meaningless with
  more than one canvas on the shared render thread.
- `lit()`, `isAnimatedTransform`, `resolveTransform`, `opToAffine`, `multiply`,
  `IDENTITY` — every group transform now compiles through the one `buildOps`
  path, so there is no classification predicate that can be wrong.
- `toRadians` no longer accepts SharedValues (unwrapping belongs at the compiler
  boundary, and a SharedValue silently meant radians while a string meant
  degrees).

Also fixed: `HostLayout` laid out a child that was never measured, so
`super.onLayout` was dead work patched over by an explicit `child.layout`; it now
measures the child instead. And the comment explaining *why* the FrameLayout
wrapper exists at all (a bare `TextureView` cannot host a background drawable,
so RN's `backgroundColor` would stop working) was restored — it had been replaced
with an implementation detail.

**Measured after removing all of it** — total CPU *improved* at three of five
configs and nothing regressed:

| config | before | after |
|:---|---:|---:|
| leaves@100 total cpu | 103.8 | **98.4** |
| leaves@600 total cpu | 103.2 | **99.5** |
| group@1500 total cpu | 116.0 | **111.6** |
| leaves@1500 f95 | 22 | **21** |
| leaves@600 f95 | 14 | 14 |

## Iteration 8b — parity: the worklet path is now covered

The audit's largest parity gap was that every scene was static, so the
animated-value path that the entire perf benchmark runs through was never
verified. Added a `slots` scene whose geometry comes from Reanimated
SharedValues held constant, plus a `zorder` scene of overlapping alternating
draw kinds.

| new scene | interior | edge (AA) | bbox | verdict |
|:---|---:|---:|---:|:---|
| slots (worklet-driven values) | **0.0000%** | 0.4131% | 0 px | **PASS** |
| zorder (overlapping mixed kinds) | **0.0000%** | 0.0034% | 0 px | **PASS** |

14 of 16 scenes pass at interior 0.0000%. Only `noise`/`turb` fail, for the
documented engine-level reason.

Two harness defects fixed along the way: a parity round captured the
**notification shade** over the app and reported identical 29.4% diffs for all 15
scenes — the harness now collapses the shade and, more importantly, *detects* an
obscured capture (the margin beside the canvases must be black) instead of
reporting nonsense. And the row printf had 19 format specifiers with 17
arguments, so the `gfxCpu` and `degC` columns were silently written empty.

---

## Current state (all columns, median of 4 runs, `[min-max]`)

| wl | N | lib | uiFps | jsFps | prsFps | f95 | mainC% | gfxC% | cpu% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| leaves | 100 | tgfx | 90.1 | 90.0 | 89.0 | **12** | **26.8** | 18.0 | 100.2 | 234 |
| leaves | 100 | skia | 90.1 | 90.0 | 89.2 | 13 | 38.0 | 0.0 | **81.0** | **204** |
| leaves | 600 | tgfx | 90.0 | **89.9** | 88.7 | **14** | **45.3** | 14.9 | 97.8 | 229 |
| leaves | 600 | skia | 90.0 | 87.3 | 88.4 | 18 | 61.6 | 0.0 | 93.1 | **200** |
| leaves | 1500 | tgfx | **89.7** | **72.4** | 51.4 | **19** | **76.7** | 17.2 | 125.5 | 240 |
| leaves | 1500 | skia | 57.2 | 29.2 | 57.3 | 42 | 89.5 | 0.0 | **111.9** | **208** |
| group | 1500 | tgfx | 90.1 | 90.0 | 89.1 | **10** | **16.4** | 28.2 | 111.8 | 240 |
| group | 1500 | skia | 90.1 | 89.9 | 89.4 | 17 | 48.5 | 0.0 | **86.2** | **210** |
| mixed | 600 | tgfx | 90.1 | **89.3** | 58.6 | **14** | **38.8** | **73.2** | 143.6 | 237 |
| mixed | 600 | skia | 89.3 | 69.3 | **86.2** | 22 | 77.2 | 0.0 | **109.0** | **206** |
| idle | 600 | tgfx | 60.0 | 60.0 | 0.2 | 14 | 11.7 | 0.2 | 17.0 | 224 |
| idle | 600 | skia | 60.0 | 59.8 | 0.2 | 13 | 11.2 | 0.0 | **16.1** | **202** |

`gfxC%` is tgfx's own render thread; Skia has none (it rasterizes on the main
thread), which is exactly why main-thread CPU is not a like-for-like cost
comparison and total `cpu%` is.

**Wins:** frame-time p95 at every animated workload (-7.7% to -54.8%);
main-thread CPU 30-66% lower everywhere; JS-thread FPS +29% at `mixed` and
+148% at `leaves`@1500; presented FPS at parity except `mixed`.

**Losses, and what they are:**
1. **`mixed`@600 — render thread at 73.2% vs 14.9% for the same shape count at
   `leaves`@600.** This is the batch break: `OpsCompositor::canAppend`
   (`src/gpu/OpsCompositor.cpp:383`) starts a new GPU op whenever the draw kind
   changes, so 600 alternating shapes cost ~600 ops instead of ~4. It causes both
   the presented-FPS loss (58.6 vs 86.2) and most of the CPU loss (+31.6%). This
   is upstream, in tgfx, and is the next thing to fix.
2. **Total CPU +5 to +32%** — real, and the honest cost metric.
3. **PSS +11 to +16%**, all of it EGL/GL graphics memory (~4 canvas-sized buffers
   vs Skia's ~1), reclaimed on unmount so not a leak. Cause still unknown; the
   stencil hypothesis was tested and disproved.

---

## Iteration 9 — runtime shaders (upstream tgfx patch)

tgfx had no user-programmable *Shader*: its public `RuntimeEffect` is an
**ImageFilter** hook (subclass it, build a RenderPipeline, filter an image),
which is not what Skia's `<Shader>` is. So this needed an upstream change,
carried as a tracked patch rather than loose edits to the submodule
(`patches/0001-runtime-shader.patch`, applied idempotently by
`scripts/apply-tgfx-patches.sh`).

The patch adds `Shader::MakeRuntimeShader(body, uniforms)`, backed by a
`RuntimeShader` -> `RuntimeShaderProcessor` -> `GLSLRuntimeShaderProcessor`. The
processor declares the uniforms through tgfx's `UniformHandler`, emits the
author's code as a **mangled GLSL function** via `addFunction` (so `return`
works anywhere and several runtime shaders can coexist in one program), and
hashes the source into `onComputeProcessorKey` so two different shaders can never
share a compiled program.

**One implementation covers both platforms**: tgfx's Metal backend compiles the
same GLSL through SPIRV-Cross to MSL (`MetalShaderModule.mm`), so nothing
Metal-specific was needed.

On top of that, `src/compiler/sksl.ts` translates the practical subset of SkSL
(uniform declarations, `half*`/`float*` type spellings, a `vec4 main(vec2 pos)`
entry point) into that GLSL, and `<Shader source uniforms>` matches Skia's
component and prop names.

**Verified against Skia on the same source.** The parity scene compiles one SkSL
string two ways — Skia's native SkSL compiler, and our transpiler + the new tgfx
runtime shader:

```
uniform float2 size;
uniform float phase;
vec4 main(vec2 pos) {
  vec2 uv = pos / size;
  float band = 0.5 + 0.5 * sin((uv.x + uv.y) * 12.0 + phase);
  return vec4(uv.x, uv.y * band, band, 1.0);
}
```

| scene | interior | edge (AA) | bbox | coverage | verdict |
|:---|---:|---:|---:|---:|:---|
| shader | **0.0000%** | **0.0000%** | 0 px | 0.011% | **PASS** |

Not one differing pixel, edges included — the transpiled GLSL and Skia's SkSL
produce the same image.

Shader support now stands at: built-in gradients (`SweepGradient` bit-identical
to Skia, `DiamondGradient`), Perlin `FractalNoise`/`Turbulence` (working, but a
different pattern from Skia's — different gradient tables), and runtime
`<Shader>` with an SkSL subset. **15 of 17 parity scenes pass at interior
0.0000%.**

Not covered by the transpiler: child shaders (`uniform shader` + `sample()`),
arrays, and matrix uniforms beyond the declared sizes.

**Known limitation found while building this:** shader uniforms and gradient
stops are compiled into the scene, so animating them re-serialises the scene
every frame. Geometry animates cheaply through value slots; uniforms do not yet.
Slot support for uniforms is the obvious next extension.

---

## Iteration 10 — a realistic composite scene, and the headline result

Every workload so far was synthetic: N copies of one or two primitives. The
`showcase` workload is a realistic frame instead — a linear-gradient background,
a runtime-shader panel, N animated particles, a rotating deck of rounded-rect
cards each filled with a sweep gradient, and a stroked bezier path. Identical
geometry for both engines, and the shader is one SkSL source that Skia compiles
natively and tgfx transpiles.

| wl | N | lib | uiFps | jsFps | prsFps | f95 | mainC% | gfxC% | cpu% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| showcase | 300 | tgfx | 90.1 | **87.8** | 87.0 | **17** | **38.9** | 21.1 | **112.7** | 245 |
| showcase | 300 | skia | 89.3 | **4.0** | 87.4 | 24 | 51.5 | 0.0 | 131.2 | **214** |
| showcase | 900 | tgfx | **89.8** | **82.7** | **79.0** | **20** | **58.2** | 18.5 | 122.4 | 252 |
| showcase | 900 | skia | 68.0 | **0.2** | 65.3 | 39 | 78.5 | 0.0 | 124.1 | **225** |

**This is where the architecture pays off.** On a realistic scene tgfx wins
*every* metric except memory:

- **JS thread: 87.8 vs 4.0 fps at N=300, and 82.7 vs 0.2 at N=900.** Skia's JS
  thread is effectively dead — it rebuilds its picture from the recorded command
  list every frame, which scales with node count, while tgfx only writes value
  slots into an already-compiled command list.
- **Presented FPS +21%** at N=900 (79.0 vs 65.3) — the metric tgfx lost on
  synthetic workloads, won here.
- **Total CPU −14.1%** at N=300 — the honest cost metric, also won here.
- Frame times 29-49% lower, main-thread CPU 25-26% lower.

The synthetic `mixed` workload remains tgfx's weak spot (batch breaking), but it
is worth noting that it is synthetic by construction: it alternates draw kinds
shape-by-shape, which real scenes do not. `showcase` mixes draw kinds the way an
actual UI does — in contiguous groups — and tgfx wins it outright.

---

## 4-backend matrix — tgfx {OpenGL ES, Vulkan} × Skia {Ganesh, Graphite}

Same device (SM-E146B, Android 15, Mali-G68, 90 Hz pinned), release arm64 APKs,
one engine mounted at a time. Four APK variants — one tgfx backend + one Skia
backend each — so every tgfx/Skia pair is compared **in-process, in the same
sweep**, with strict run-order alternation. Each backend appears in two sweeps:
8 runs per config (4 for the N>=6000 configs). Raw rows, the matrix runner, the
aggregator and per-APK `.so` manifests: `results-matrix/`.

**Version fairness.** One Skia version for both backends:
`@shopify/react-native-skia@2.12.0-next.1` (the `@next` Graphite preview).
Marker absent -> Ganesh, linking `react-native-skia-android@152.0.0` — the
*identical* binary package stable 2.11.0 ships — marker present -> Graphite,
linking `react-native-skia-graphite-android@152.0.0` (same Skia milestone m152).
The Graphite npm package ships no `libwebgpu_dawn.so`; the chrome-m152 Dawn
shared library from `react-native-webgpu@0.8.2` (the tag Graphite declares) was
placed in its libs dir. tgfx backends flip via `-PTgfxVulkan=ON|OFF` (same-day
prebuilt pair). Every APK was verified before its sweep: vk/egl symbols in the
tgfx `.so`, Dawn strings in `librnskia.so`, and Graphite confirmed live at
runtime (`RNSkia: Selected Dawn adapter - Backend: Vulkan, Device: Mali-G68`).

**Pre-roll** now also covers `showcase` (runtime shader, gradients, path), so
no engine pays a first-pipeline compile inside a measured window.

### 20,000 animated objects

Per-object SharedValue slots at 20k (40,000 mutables) mount for tens of minutes
on **both** engines — the JS thread pegs a core wiring 20k React nodes with
40k value subscriptions. That is a shared architectural ceiling, reported, not
measured. The 20k rows are renderer-bound instead: `group`@6000/@20000 — every
object moves every frame through one animated transform. `leaves`@6000 (12,000
independently animated slots) is kept as the per-object overload probe.

### Results (median of 8 runs; 4 runs for N>=6000; `[min-max]`)

| wl | N | backend | uiFps | jsFps | prsFps | f95 | cpu% | pssMB |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|
| leaves | 1500 | tgfx-gl | **90.3** | **89.1** | **91.2** | 16 | **100.7** | 310.9 |
| leaves | 1500 | tgfx-vk | **90.3** | **89.2** | **91.2** | 16 | 104.0 | 365.6 |
| leaves | 1500 | skia-ganesh | 83.0 | 41.9 | 80.0 | 32 | 114.2 | 299.8 |
| leaves | 1500 | skia-graphite | 76.5 | 38.6 | 25.9 | 36 | 107.9 | 369.3 |
| leaves | 6000 | tgfx-gl | **44.2** | **21.7** | **44.6** | 50 | 149.2 | 385.4 |
| leaves | 6000 | tgfx-vk | 35.2 | 17.4 | 35.8 | 48 | 160.1 | 423.4 |
| leaves | 6000 | skia-ganesh | 17.8 | 9.5 | 17.6 | 123 | 113.7 | 371.0 |
| leaves | 6000 | skia-graphite | 15.2 | 7.7 | 4.8 | 150 | 98.9 | 454.6 |
| group | 6000 | tgfx-gl | **90.1** | **89.9** | **91.1** | 12 | 116.2 | 394.8 |
| group | 6000 | tgfx-vk | **90.0** | **89.8** | **90.9** | **10** | 117.4 | 411.9 |
| group | 6000 | skia-ganesh | 86.0 | 60.6 | 84.3 | 30 | 124.2 | 366.4 |
| group | 6000 | skia-graphite | 47.2 | 23.7 | 15.8 | 67 | 88.8 | 445.8 |
| group | 20000 | tgfx-gl | **90.1** | **89.6** | **87.1** | 18 | 232.7 | 499.0 |
| group | 20000 | tgfx-vk | **90.0** | **89.8** | 79.9 | **11** | 195.4 | 525.1 |
| group | 20000 | skia-ganesh | 30.8 | 15.7 | 31.2 | 101 | 106.9 | 416.4 |
| group | 20000 | skia-graphite | 14.9 | 7.4 | 4.8 | 200 | 71.5 | 538.9 |
| showcase | 900 | tgfx-gl | **90.2** | **89.0** | **91.2** | 20 | **87.7** | 361.1 |
| showcase | 900 | tgfx-vk | **90.2** | **89.3** | **91.2** | 20 | 95.8 | 388.5 |
| showcase | 900 | skia-ganesh | 89.7 | 81.3 | 82.9 | 24 | 99.7 | 345.4 |
| showcase | 900 | skia-graphite | 90.3 | 86.5 | 44.6 | 19 | 97.5 | 377.9 |

(Light workloads — leaves 100/600, group 1500, mixed 600, showcase 300, idle —
are FPS-capped ~90-91 on tgfx-gl, tgfx-vk and skia-ganesh alike; tgfx holds the
lower f95 at every one of them. Full rows in `results-matrix/`.)

### Read of the matrix

- **20k animated objects:** tgfx-gl presents **87 fps** with the main thread
  and JS thread both still at 90 fps; Ganesh presents 31 with its main thread
  at 31 and JS at 16. Graphite presents 4.8. Per delivered frame tgfx is also
  the cheaper engine (2.7 cpu%/fps vs 3.4 for Ganesh).
- **tgfx-gl vs tgfx-vk:** GL presents more under saturation (44.6 vs 35.8 at
  `leaves`@6000; 87.1 vs 79.9 at `group`@20000); Vulkan has the better frame
  times (f95 10-11 vs 12-18 on `group`) and lower CPU at 20k, but +40-60 MB
  PSS and a +48 MB idle baseline. The Vulkan sweeps also ran ~3 °C hotter
  (they came later in the matrix) — a cross-sweep caveat that does not affect
  any tgfx-vs-Skia comparison, which is always in-sweep.
- **Skia Graphite (experimental preview):** presented FPS is pinned at ~45 —
  exactly half the 90 Hz panel — on *every* light workload, while its UI and
  JS threads run at 90 and f95 stays low; under load it collapses (4.8-25.9).
  This is a present-path defect of the preview on this Dawn/Vulkan/Mali stack,
  the same half-refresh symptom tgfx itself had before iteration 1. Its
  Vulkan-via-Dawn stack also carries the largest graphics memory footprint
  (+80-200 MB at high N).
- **Memory:** Ganesh stays lightest at every config. tgfx pays its swapchain
  (~+10-30 MB GL, more on Vulkan); Graphite pays the most. Absolute PSS in all
  rows includes a ~40 MB harness slot pool (12k mutables), identical for every
  engine. Idle baselines per sweep: 198.1 / 205.1 / 245.9 / 252.1 MB
  (gl-ganesh / gl-graphite / vk-ganesh / vk-graphite).

## Iteration 12 — retained offscreen surface vs one-shot renderToImage

Harness: `src/OffscreenBench.tsx` (self-measuring screen, debug build, Samsung
SM-E146B). Each side does 20 fenced export cycles at 1024×1024, opaque: mutate
one group's rotation, render, read the frame back (`toImage()` for the
surface, `renderToImage()` for the one-shot). The retained surface pays
compile + surface allocation once; the one-shot pays them per call. Both pay
the same GPU→CPU readback per export, which is why this is not the
order-of-magnitude gap of the flush-only path — readback (~65 ms at 1024²)
dominates the export loop.

| objects | retained ms/export | one-shot ms/export | speedup |
| --- | --- | --- | --- |
| 400 | 68.9 | 81.5 | **1.2x** |
| 2000 | 77.3 | 122.3 | **1.6x** |

Read: the saving is the per-call `SceneRenderer::setScene` compile plus
`Surface::Make`, so it scales with scene complexity (12.6 ms/export at 400
objects, 45 ms/export at 2000) while the readback stays constant. A
flush-only loop (mutate + `flush()`, no readback until the end) coalesces on
the offscreen worker and renders at slot-patch cost, like a view — the export
numbers above are the *worst case* for the retained surface, and it still
wins everywhere measured. Verdict: `renderToImage` for one-shots,
`createOffscreenSurface` as soon as the same scene renders twice.
