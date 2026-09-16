# react-native-tgfx vs @shopify/react-native-skia — stress tier

Samsung SM-E146B (90Hz), Android 15, release builds, new arch, RN 0.85.3,
react-native-skia 2.4.x, tgfx from source.

**Loads**: 20,000 shapes · 3,600 images · 40-octave fullscreen SkSL ·
0.03-scale repeating image pattern · 6,000 texts. One Reanimated shared value
rotates identical scene graphs in both engines.

**Metrics**: *Present FPS* is the ground truth — SurfaceFlinger `queueBuffer`
events for the canvas layer (atrace, 8s window) = frames that actually reached
the screen. *UI/JS FPS* are thread health (`useFrameCallback` / rAF counts).
CPU = `/proc/<pid>/stat` (100 = one core). Memory = `dumpsys meminfo` TOTAL PSS.

**Visual parity**: every combo freezes its animation at t=0 for a screenshot
before measuring; the five tgfx/skia pairs in `bench/shots/` are visually
identical. This parity gate caught a real rig bug: skia's offscreen-built
images drew as *nothing* (texture-backed snapshots can't cross contexts —
`makeNonTextureImage()` fixed it), so any skia images/pattern number before
the fix was a blank canvas at 90fps.

| engine · scene | Present FPS | UI FPS | JS FPS | CPU % | PSS MB |
|---|---|---|---|---|---|
| tgfx · shapes | 8.4 | 90 | 90 | 230 | 455 |
| skia · shapes | **21.0** | 22 | 11 | 108 | 473 |
| tgfx · images | 23.0 | 90 | 90 | 121 | 389 |
| skia · images | **67.9** | 74 | 43 | 110 | 430 |
| tgfx · shader | 11.6 | 90 | 90 | 27 | 360 |
| skia · shader | 13.5 | 14 | 8 | 14 | 401 |
| tgfx · pattern | 90.0 | 91 | 90 | 63 | 356 |
| skia · pattern | 90.3 | 91 | 90 | 59 | 395 |
| tgfx · text | **66.3** | 91 | 90 | 167 | 389 |
| skia · text | 33.5 | 33 | 17 | 109 | 483 |

## What the stress tier shows

The two engines fail differently, and that IS the difference:

- **tgfx never blocks the app.** At every load its UI and JS threads stay at
  90fps — animation and scene replay live entirely off the JS thread. When the
  canvas can't keep up it coalesces frames and presents slower (8-23fps on the
  20k-shape and 3.6k-image scenes) while the app stays perfectly responsive.
- **skia drags the app down with the canvas.** Its recording work sits on the
  measured threads, so when the canvas slows, UI and JS fps collapse with it
  (22/11 at 20k shapes, 33/17 at 6k texts, 14/8 on the shader) — scrolling,
  gestures, and React updates would stutter at the same rate.
- **Text: tgfx wins outright** — 66 vs 33 presented fps AND 90/90 vs 33/17
  threads (2× the frames with a fully responsive app).
- **Shapes/images: skia presents more frames** (21 vs 8, 68 vs 23) but only by
  consuming the app: at 11-43 JS fps the rest of the app is unusable. Pick your
  failure mode.
- **Shader & pattern: a wash** at this tier — the 40-octave shader is pure
  GPU-bound (11.6 vs 13.5) and the pattern presents at 90 in both.
- **Memory: tgfx lighter in every scene**, by 18-94MB (biggest gap on text:
  389 vs 483MB).

## Moderate loads (for context)

At 400-4000 shapes / 64-576 images / 12-octave shader / 150-1200 texts (see
`results-*.md` history), both engines' canvases keep up and the thread story is
the whole story: tgfx 90/90 everywhere; skia holds 90 UI except the 12-octave
shader (54) with JS dipping to 71-85 on heavy scenes. Present FPS was
instrumented for the stress tier; the pattern rows above (90 present when the
canvas can keep up) validate the pipeline reaches the panel rate when able.

## Post-fix update: commit-time batch clustering (react-native-tgfx PR #260)

Profiling the 8fps shapes scene (simpleperf, render thread) showed it was
CPU-bound on per-batch bookkeeping: tgfx's OpsCompositor merges only *adjacent*
compatible draws, so the rect/circle interleave flushed ~13k GPU batches per
frame (19% of the thread in shared_ptr refcount atomics, plus program/uniform
hash lookups and Vulkan descriptor binds; the same 20k scene as all-rects ran
90fps). The fix reorders sibling draws by batch class at scene commit when
their padded bounds are provably disjoint — once, zero per-frame cost,
pixel-identical (ImageMagick AE 0 vs pre-fix; 78/78 device snapshot baselines
unchanged).

Stress tier, presented FPS, same run:

| scene | tgfx before | tgfx after | skia 2.4 |
|---|---|---|---|
| 20k mixed shapes | 8.4 | **53.0** | 18.3 |
| 3,600 images | 23.0 | **89.9** (panel rate) | 53.3 |
| 6,000 texts | ~34 | **56.9** | 24.9 |
| pattern | 90 | 90 | 90 |
| 40-oct shader | ~10 | 10.0 (GPU-bound) | 9.8 |

tgfx now leads or ties every scene on presented frames while holding 90/90
UI/JS thread FPS (skia's threads: 9-30 on the heavy scenes).
