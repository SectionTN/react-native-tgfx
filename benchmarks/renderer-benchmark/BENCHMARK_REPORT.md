# React Native renderer stress benchmark

For the deliberately main-thread-saturating follow-up, see `HARD_STRESS_REPORT.md`.

Date: 2026-07-29  
Device: Samsung SM-E146B, Android 15/API 35, Mali-G68  
Build: React Native 0.85.3 release, Hermes, Fabric, arm64-v8a  
Accepted trials: 20, five per backend

## Verdict

For this end-to-end React Native structural-churn workload:

1. Thor CPU and Thor GPU both sustained the 60 Hz ceiling. Their process CPU ranges overlap, so this test does not establish a meaningful CPU winner between them.
2. Tgfx rendered about 45 JS-driven scene updates per second. It had the lowest measured PSS and PSS growth, but the highest process CPU use at about 2.15 cores.
3. Skia Graphite rendered about 23 JS-driven scene updates per second and used about 1.34 cores. It had the largest measurement-window PSS growth.
4. All four kept the Android main-looper callback near 60 Hz. That value is main-thread responsiveness, not presentation FPS.

This is a final result for the scoped adapter stress test, not a raw rasterizer microbenchmark or direct GPU-utilization comparison.

## Headline results

Values are median with IQR in parentheses across five accepted runs.

| Backend | JS update FPS | JS p99 | JS missed frames | Main callback FPS | Process CPU | Peak PSS | Peak − start PSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Skia Graphite | 23.11 (0.24) | 56.73 ms (2.18) | 557 (21) | 60.14 (0.16) | 133.6% (1.3) | 206.5 MiB (5.7) | 25.2 MiB (1.6) |
| Thor CPU | 60.18 (0.02) | 21.81 ms (0.78) | 1 (0) | 60.26 (0.01) | 96.2% (6.2) | 176.2 MiB (0.9) | 11.4 MiB (0.2) |
| Thor GPU | 60.21 (0.03) | 22.29 ms (0.69) | 1 (0) | 60.26 (0.00) | 98.4% (0.4) | 241.4 MiB (4.5) | 13.7 MiB (4.1) |
| Tgfx GPU | 45.10 (1.15) | 31.01 ms (2.55) | 194 (31) | 60.25 (0.01) | 214.8% (0.8) | 151.4 MiB (1.4) | 1.6 MiB (0.8) |

Process CPU is percentage of one core, so values above 100% indicate multicore use. PSS starts after the five-second warmup. Absolute PSS is the combined process footprint: the APK contains all renderer libraries, so it is not the standalone install footprint of each engine.

### Raw JS FPS

| Backend | Five accepted values | Range |
|---|---|---:|
| Skia Graphite | 22.96, 23.11, 23.20, 21.59, 23.65 | 21.59–23.65 |
| Thor CPU | 60.18, 60.18, 60.16, 60.16, 60.23 | 60.16–60.23 |
| Thor GPU | 60.23, 60.20, 60.23, 60.17, 60.21 | 60.17–60.23 |
| Tgfx GPU | 41.10, 44.31, 45.46, 45.10, 45.99 | 41.10–45.99 |

The first Tgfx accepted run was a low outlier, suggesting first-use or pipeline-cache conditioning. Thor CPU process CPU also declined from 101.9% to 94.9% across the campaign. With five observations per backend these are descriptive signals, not inferential statistics.

## Representative presentation validation

SurfaceFlinger TimeStats was captured in one separate, non-scored run per backend over the complete warmup, measurement, and result transition. All retained presentation runs stayed at thermal status NONE.

| Backend/layer | Frames | TimeStats average | Dropped | Late acquire |
|---|---:|---:|---:|---:|
| Skia Graphite SurfaceView | 914 | 46.47 FPS | 0 | 0 |
| Skia app window | 456 | 22.67 FPS | 0 | 0 |
| Thor CPU app window | 1,199 | 62.12 FPS | 0 | 0 |
| Thor GPU GLSurfaceView | 1,183 | 61.83 FPS | 0 | 0 |
| Tgfx app window/TextureView composition | 1,128 | 58.11 FPS | 0 | 0 |

These are layer-buffer presentation rates, not interchangeable renderer FPS. SurfaceView child layers are independently visible to SurfaceFlinger; a TextureView is composed into its app window. TimeStats also measures the layer's active interval rather than the exact 15-second native window, which explains values slightly above 60 for the Thor app layers.

Android `gfxinfo` was collected for every scored run, but it covers warmup plus measurement and does not observe SurfaceView child presentation consistently. Its median jank percentages were Skia 14.35%, Thor CPU 0.25%, Thor GPU 0.58%, and Tgfx 0.52%; these remain supplemental HWUI diagnostics and are not used to rank renderers.

## Workload and controls

- Fresh app: `benchmarks/renderer-benchmark`; no project under `apps/` was installed or used.
- Scene: 400 deterministic logical objects, seed `20260729`, equal rectangles and circles.
- Every logical object becomes a fill and a stroke draw node in every adapter: 800 draw nodes plus background.
- Every JS animation frame reconstructs positions and the renderer element tree.
- Warmup: 5 seconds; measured window: 15 seconds.
- Five fresh-process repetitions per renderer.
- The first four cycles form a position-balanced Latin square; the fifth repeats the second sequence.
- Phone fixed to 60 Hz, portrait, 40% manual brightness, animations off, battery saver off.
- Every accepted run passed two pre-run thermal-NONE checks and remained thermal NONE at native start, native end, and the external post-run check.
- Six heat-affected attempts were discarded and rerun in the same slot during campaign development; the final three are retained in `artifacts/invalid-runs.json`.
- Main metrics window remained aligned with active rendering. JS FPS uses its own first-to-last callback duration.
- CPU is process CPU time divided by wall time. PSS, native heap, and Java heap were sampled every 500 ms.

## Backend proof

- Skia used `@shopify/react-native-skia@2.9.1-next.1`, the experimental package line required by the [official Graphite installation instructions](https://shopify.github.io/react-native-skia/docs/getting-started/installation/#graphite-experimental). Every accepted Skia run logged `Selected Dawn adapter - Backend: Vulkan, Device: Mali-G68`; no Ganesh runtime appeared.
- Thor CPU used npm `react-native-nitro-thor@0.0.2-alpha.1`. Every run logged `ThorVG SwCanvas` on the main thread with `no GL`.
- Thor GPU used the same npm package. Every run logged a live GLES context, `GL_RENDERER = Mali-G68`, `OpenGL ES 3.2`, `GPU(GL) target OK`, and GlCanvas frame heartbeats on `GLThread`.
- Tgfx was built from `packages/react-native-tgfx`, whose Android build enables OpenGL and disables Metal, Vulkan, and WebGPU. The off-score rendering screenshot visibly confirms the 400-object scene, and SurfaceFlinger recorded 1,128 app-window buffers with zero dropped frames. The package does not currently emit a positive native draw-success or GL-vendor log, so the visual and SurfaceFlinger evidence are the runtime proof.

## Interpretation limits

- This measures the whole React/adapter/native submission path. A renderer that reuses persistent native nodes could rank differently from this forced structural-rebuild workload.
- Main callback FPS is a Choreographer heartbeat, not displayed renderer FPS.
- Tgfx and Skia SurfaceFlinger rates do not map one-to-one to JS scene updates because their surface composition paths differ.
- No reliable production-device Mali utilization counter was available, so GPU utilization is intentionally not reported.
- PSS includes identical in-process observation overhead and all preloaded renderer libraries. Peak-minus-start is more useful than absolute PSS, but it excludes allocations made during warmup.
- Negative end-minus-start PSS for Thor and Tgfx means memory was released relative to the post-warmup sample; it is not negative memory use.
- The phone was USB powered, so energy-per-frame was not measured.

## Artifacts

- `artifacts/raw-runs.json`: all 20 accepted scored trials
- `artifacts/results-summary.json`: medians, IQRs, ranges, and raw values
- `artifacts/invalid-runs.json`: retained thermal-gate exclusions
- `artifacts/pilot-runs.json`: discarded automation pilots
- `artifacts/presentation-summary.json`: parsed SurfaceFlinger results
- `artifacts/surfaceflinger-*.txt`: raw layer TimeStats
- `artifacts/tgfx-rendering-proof.png`: visual runtime proof
- `artifacts/tgfx-representative.pftrace`: non-scored scheduler trace
- `artifacts/environment.json`: device, display, package, and APK metadata
- `scripts/run-campaign.mjs`: repeatable accepted-run campaign
- `scripts/analyze-results.mjs`: statistical aggregation
- `scripts/run-presentation-validation.mjs`: representative TimeStats capture
- `scripts/analyze-presentation.mjs`: presentation-layer extraction

The tested APK SHA-256 is `848c810f11bdf7bbd3f04febcc67576a18e5c1db76b470ba12c2d62c98d8d8ed`.

## Verification

- Release APK assembled and installed on the Samsung through agent-device.
- App launched and completed all renderer modes without accepted-run crash, ANR, OOM, or native abort.
- `npm test -- --runInBand`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Ten independent audit agents reviewed backend selection, scene fairness, metrics windows, campaign design, external metrics, and final statistics.
