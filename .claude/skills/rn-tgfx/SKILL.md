---
name: rn-tgfx
description: react-native-tgfx expert guidance — a declarative, Skia-style GPU 2D canvas for React Native backed by Tencent's tgfx and Nitro Modules. Use when drawing shapes, text, paths, images, runtime SkSL shaders or effects on a Canvas, animating from the UI thread with shared values and node handles, rendering VisionCamera frames zero-copy, or migrating a screen from @shopify/react-native-skia to react-native-tgfx.
metadata:
  priority: 8
  docs:
    - "https://github.com/riteshshukla04/react-native-tgfx"
    - "https://visioncamera.margelo.com/docs/skia-frame-processors"
  pathPatterns:
    - "**/*Canvas*.tsx"
    - "**/*canvas*.tsx"
    - "**/*Shader*.tsx"
    - "**/*FaceBlur*.tsx"
    - "**/*CameraEffects*.tsx"
    - "packages/react-native-tgfx/**"
    - "packages/react-native-tgfx-vision-camera/**"
    - "apps/example/**"
  importPatterns:
    - "react-native-tgfx"
    - "react-native-tgfx-vision-camera"
    - "@shopify/react-native-skia"
    - "react-native-vision-camera-skia"
  bashPatterns:
    - '\b(npm|pnpm|bun|yarn)\s+(install|i|add)\s+[^\n]*react-native-tgfx'
    - '\bbun\s+--cwd\s+packages/react-native-tgfx\b'
    - '\bbun\s+run\s+specs\b'
    - '\bnitrogen\b'
  promptSignals:
    phrases:
      - "react-native-tgfx"
      - "rn-tgfx"
      - "tgfx canvas"
      - "camera frame shader"
      - "skia to tgfx"
    allOf:
      - [skia, migrate]
      - [camera, shader]
      - [frame, processor]
    anyOf:
      - "usecameraframe"
      - "cameraframe"
      - "usenode"
      - "sksl"
      - "face blur"
      - "backdrop blur"
      - "sprite buffer"
    noneOf: []
    minScore: 5
retrieval:
  aliases:
    - tgfx
    - rn tgfx
    - react native tgfx
    - tencent tgfx
    - skia alternative react native
  intents:
    - draw GPU 2D graphics in a React Native app
    - render VisionCamera frames through a GPU canvas with effects
    - blur faces in a live camera preview
    - run a runtime SkSL shader over a camera frame
    - migrate a screen from react-native-skia to react-native-tgfx
    - animate canvas props from the UI thread without JS per frame
  entities:
    - Canvas
    - CameraFrame
    - useCameraFrame
    - useTgfxCameraSink
    - Shader
    - ImageShader
    - useNode
    - createHandle
    - useSpriteBuffer
    - imageFromNativeBuffer
  examples:
    - add a GPU canvas to my React Native screen
    - blur detected faces on the live camera
    - apply a neon edge shader to the camera preview
    - port my Skia frame processor to tgfx
    - animate a circle radius without re-rendering
validate:
  -
    pattern: useSkiaFrameProcessor
    message: 'useSkiaFrameProcessor is the VisionCamera v4 Skia path. In tgfx the frame is drawn declaratively: useCameraFrame() + <CameraFrame image={image} {...posture} /> inside a <Canvas>. Run Skill(rn-tgfx) for the migration.'
    severity: error
    upgradeToSkill: rn-tgfx
    upgradeWhy: 'Guides the port from Skia frame processors (frame.render() + imperative draw calls per frame) to the tgfx declarative CameraFrame scene.'
    skipIfFileContains: 'useCameraFrame|CameraFrame'
  -
    pattern: "from\\s+['\"]react-native-vision-camera-skia['\"]"
    message: 'SkiaCamera renders the preview through Skia. With react-native-tgfx the camera is a frame source only and every pixel is drawn by <Canvas>/<CameraFrame>. Run Skill(rn-tgfx).'
    severity: error
    upgradeToSkill: rn-tgfx
    upgradeWhy: 'Maps SkiaCamera onFrame/render() onto useCameraFrame + CameraFrame + the native sink package.'
    skipIfFileContains: 'react-native-tgfx'
  -
    pattern: "from\\s+['\"]@shopify/react-native-skia['\"]"
    message: 'Skia import in a file that also uses tgfx. Do not mix the two canvases in one screen — see references/migration-from-skia.md for the component-by-component mapping.'
    severity: warn
    upgradeToSkill: rn-tgfx
    upgradeWhy: 'Provides the Skia to tgfx API mapping table so the screen can be ported in one pass.'
    skipIfFileContains: 'migration|codemod'
  -
    pattern: "pixelFormat:\\s*['\"]rgb['\"]"
    message: "pixelFormat: 'rgb' forces a full-frame YUV to RGB copy in the camera pipeline every frame. tgfx samples YUV planes directly and converts in the fragment shader — use 'yuv'."
    severity: error
  -
    pattern: '<ImageShader[^>]*\bt[xy]=\{?["'']?(repeat|mirror|decal)'
    message: 'A YUV camera frame sampled with any tile mode other than clamp comes back fully transparent. Leave tx/ty unset on a frame ImageShader.'
    severity: error
  -
    pattern: 'Skia\.(RuntimeEffect|Paint|XYWHRect|Color|Path)\b'
    message: 'Skia imperative object construction. tgfx has no Skia object graph — shaders are <Shader source={...}>, paint is <Paint>/props, paths are SVG strings. Run Skill(rn-tgfx).'
    severity: warn
    upgradeToSkill: rn-tgfx
    upgradeWhy: 'Replaces the imperative Skia object graph with tgfx declarative nodes and SVG path strings.'
  -
    pattern: 'useDerivedValue\([^)]*\)\s*(?:as\s+\w+\s*)?\}?\s*(?:\/>|color=)'
    message: 'tgfx props take a SharedValue directly — useDerivedValue wrapping is a Skia idiom and is not needed.'
    severity: recommended
  -
    pattern: '\.set\(\{[^}]*color:\s*[''"]#'
    message: "handle.set({ color: '#rrggbb' }) cannot be a slot patch — the parser is on the JS thread, so a worklet write costs a runOnJS hop and a re-encode. For per-frame color use a packed 0xAARRGGBB number or an [r,g,b,a] 0..1 tuple."
    severity: warn
    skipIfFileContains: "'worklet'"
  -
    pattern: 'half4\s+main[\s\S]{0,4000}?\buniform\b'
    message: 'Shader declarations must come before main(). tgfx lifts only what precedes main; anything after it fails to compile.'
    severity: error
  -
    pattern: 'uniform\s+\w+\s+\w+\s*\[[0-9]*\]'
    message: 'Array uniforms are unsupported — only scalar, vector and square-matrix uniforms. Flatten to separate uniforms or pack into a vector.'
    severity: error
chainTo:
  -
    pattern: "from\\s+['\"]react-native-vision-camera['\"]"
    targetSkill: react-native-vision-camera
    message: 'VisionCamera detected — loading v5 outputs/constraints guidance alongside the tgfx frame path.'
    skipIfFileContains: 'useFrameOutput'
---

## What this is

`react-native-tgfx` is a declarative GPU 2D canvas for React Native, backed by
Tencent's [tgfx](https://github.com/Tencent/tgfx) and built on Nitro Modules.
The JSX shape is deliberately close to `@shopify/react-native-skia`, but the
execution model is not:

**Every scene commit compiles the React tree to a binary draw program.** Between
commits, animated values live in native *slots* that the renderer patches on the
UI thread. A `SharedValue` prop or a slot-backed `NodeHandle.set()` costs zero
JavaScript per frame — no worklet, no re-render, no re-encode. A prop with no
slot re-encodes the scene instead.

Backends: Metal on iOS, OpenGL ES by default on Android, Vulkan opt-in
(the default; `TgfxVulkan=OFF` in `android/gradle.properties` falls back to GL, Vulkan gives 15–30% more presented FPS).

## Read this first, then load one reference

Every reference is self-contained. Do not load more than the task needs.

| Task | Reference |
| --- | --- |
| Install, `<Canvas>`, shapes, paint, groups, transforms, clipping, hit testing, colors | [references/api-drawing.md](references/api-drawing.md) |
| Text, spans, glyphs, fonts, measurement, SVG paths and path helpers, images, video, atlas, meshes | [references/api-content.md](references/api-content.md) |
| Blend modes, color filters, blur, shadow, gradients, noise, masks, backdrop/glass, runtime SkSL shaders, **complex shader recipes** | [references/api-effects-shaders.md](references/api-effects-shaders.md) |
| `Animated<T>`, `useClock`, `useNode`/`createHandle` slots, pools, sprite and vertex buffers, performance levers | [references/api-animation-imperative.md](references/api-animation-imperative.md) |
| Snapshots, `save()`, offscreen render, PDF, SVG export | [references/api-export.md](references/api-export.md) |
| **VisionCamera** — `useCameraFrame`, `<CameraFrame>`, the native sink, face blur, camera shaders | [references/vision-camera.md](references/vision-camera.md) |
| **Porting from `@shopify/react-native-skia`** or from Skia frame processors | [references/migration-from-skia.md](references/migration-from-skia.md) |
| Errors, blank canvases, native rebuild rules | [references/troubleshooting.md](references/troubleshooting.md) |

When the user shows Skia code, load `migration-from-skia.md` **before** writing
anything. When the user mentions a camera, load `vision-camera.md`.

## Non-negotiable rules

Apply these without asking. They are the ones that catch people who know Skia.

1. **Animate slots, not the tree.** Pass a Reanimated `SharedValue` straight to
   a numeric/boolean/string prop, or write through a `useNode()` handle. Never
   drive per-frame state through React `useState` — that recompiles and
   re-uploads the whole scene.
2. **Keep `<Canvas>` children primitive.** The reconciler recognises the
   exported drawing components directly. A wrapper function component
   (`<Star />`, `<Bar />`) falls back to the slow path.
3. **`pixelFormat: 'yuv'`, never `'rgb'`** on a camera frame output. tgfx
   imports the YUV planes to a texture and converts in the fragment shader;
   `'rgb'` pays a full-frame CPU copy per frame.
4. **Never set a tile mode on a camera-frame `<ImageShader>`.** A YUV image
   sampled with anything but `clamp` comes back fully transparent.
5. **One animated `opacity` per chain.** A draw command has a single alpha slot;
   two opacities multiply at commit time and freeze.
6. **Shader helpers and declarations go above `main()`,** one name per
   statement, no array uniforms. `main` returns `half4`, `float4` or `vec4` and
   takes an optional `half2`/`float2`/`vec2` coord — `float4 main(float2 pos)`
   and `vec4 main()` are both valid.
7. **Colors animated from a worklet must be packed or component form** —
   `0xAARRGGBB` or `[r, g, b, a]` in 0..1 patch the four color slots in place. A
   `'#rrggbb'` string still works from a worklet, but the parser lives on the JS
   thread, so it costs a `runOnJS` hop and a scene re-encode — not a per-frame
   path.
8. **The frame handed to your per-frame worklet dies when it returns.** Do not
   retain it, do not call `getNativeBuffer()` on it again, never store
   `.pointer`. `useCameraFrame` already owns that lifetime.
9. **The next React commit wins.** An imperative `handle.set()` survives until
   the canvas re-renders; then the JSX props are the truth again. Drive a value
   from one side or the other, never both.
10. **A `SCENE_VERSION` bump needs a native rebuild.** A blank canvas or an
    `unexpected header` warning is a stale APK, not a render bug.

## Install

```bash
npm install react-native-tgfx@alpha react-native-nitro-modules
```

Add `react-native-reanimated` + `react-native-worklets` for anything animated,
camera-driven or video-driven (they are optional peers; skip only for fully
static scenes). tgfx ships prebuilt per ABI — no postinstall, no source build.

```tsx
import { Canvas, Circle, Rect } from 'react-native-tgfx'

<Canvas style={{ width: 300, height: 140 }}>
  <Rect x={0} y={0} width={300} height={140} color="#101725" />
  <Circle cx={70} cy={70} r={44} color="#d98a4a" />
</Canvas>
```

## Working in this repo

- Monorepo: `packages/react-native-tgfx` (core),
  `packages/react-native-tgfx-vision-camera` (native frame sink),
  `apps/example` (feature gallery, including the camera screens),
  `docs/` (Fumadocs site).
- **Imperative API first.** Design which props get value slots and what a
  worklet write costs *before* wrapping a declarative component over it. A prop
  that only animates via re-encode is not done.
- Every public-surface change updates `docs/content/docs`, and
  `packages/react-native-tgfx/docs/wire-format.md` when the wire format moves.
  `docs/content/api` is typedoc output — edit the doc comments, not the output.
- Regenerate Nitro specs with `bun run specs`; typecheck with `bun run typecheck`.
- Every SkSL source in this skill's docs is checked against the real transpiler:
  `bun .claude/skills/rn-tgfx/scripts/check-shaders.ts`. Run it after editing a
  shader example.
