# react-native-tgfx

A **declarative, Skia-style GPU 2D canvas** for React Native, backed by Tencent's
[**tgfx**](https://github.com/Tencent/tgfx) and built with
[**Nitro Modules**](https://nitro.margelo.com).

Render shapes, strokes, paths, gradients, images and text through a React
component tree that compiles to a single native draw-program and runs on the GPU
(Metal on iOS, OpenGL on Android).

```tsx
import { Canvas, Rect, Circle, Path, Image, Text, LinearGradient, useImage } from 'react-native-tgfx'

function Hello() {
  const img = useImage(require('./cat.png'))
  return (
    <Canvas style={{ flex: 1 }}>
      <Rect x={0} y={0} width={120} height={80} color="lightblue" />

      <Circle cx={160} cy={120} r={40} color="red" style="stroke" strokeWidth={6} strokeCap="round" />

      <Path path="M0 200 q40 -60 80 0 t80 0" color="#5856D6" style="stroke" strokeWidth={5} />

      <Rect x={0} y={260} width={160} height={70}>
        <LinearGradient start={{ x: 0, y: 260 }} end={{ x: 160, y: 330 }} colors={['#FF6CAB', '#7366FF']} />
      </Rect>

      {img && <Image x={180} y={260} width={96} height={96} image={img} fit="cover" />}

      <Text x={0} y={380} text="Hello tgfx" fontSize={24} color="#111" />
    </Canvas>
  )
}
```

## How it works

```
<Canvas> children
   │  (custom react-reconciler, persistence mode)
   ▼
immutable node tree ──► JSON draw-program (compiler) ──► `scene` prop
   │
   ▼  Nitro HybridView (TgfxView)
Swift / Kotlin view shell (CAMetalLayer / TextureView)
   │
   ▼  shared C++ engine (nlohmann::json → tgfx::Canvas)
tgfx ──► Metal (iOS) / OpenGL (Android) ──► GPU
```

- A dedicated **react-reconciler** turns the component tree into an immutable
  scene and compiles it to a compact JSON program on every change.
- A single Nitro **`TgfxView`** receives that program via its `scene` string prop.
  The Swift/Kotlin shell only hosts the GPU surface; all drawing is shared C++.
- Drawing happens on the platform's display-link / choreographer thread.

## Components

| Component | Key props |
|---|---|
| `Canvas` | `style`, `children` |
| `Group` | `transform`, `origin`, `opacity` + inherited paint |
| `Rect` / `Oval` | `x`, `y`, `width`, `height` |
| `RoundedRect` | `x`, `y`, `width`, `height`, `r` (or `rx`/`ry`) |
| `Circle` | `cx`, `cy`, `r` |
| `Line` | `x1`, `y1`, `x2`, `y2` |
| `Path` | `path` (SVG path data) |
| `Image` | `x`, `y`, `width`, `height`, `image` (a `useImage` handle), `fit`, `sampling`, `rect` |
| `Text` | `x`, `y`, `text`, `fontSize`, `fontFamily` |
| `Paint` | paint as a child of a shape/group |
| `LinearGradient` / `RadialGradient` | shader as a child of a shape/`Paint` |

**Paint props** (on any drawing component, `Group`, or `Paint`): `color`,
`style` (`'fill'` \| `'stroke'`), `strokeWidth`, `strokeCap`, `strokeJoin`,
`opacity`, `antiAlias`.

Colors accept hex (`'#rrggbb'`, `'#rgba'`), `rgb()/rgba()`, common names, or a
packed `0xAARRGGBB` number.

## Hooks

- `useImageState(source)` — the same load as `useImage`, returning `{ data, error, loading }` so a slow load can be told from a failed one
- `useImage(source)` — loads a `require()` asset, URL, `data:` URI, or base64
  string into a native `TgfxImage` handle. Local files are decoded natively and
  their bytes never enter JS; nothing is base64-encoded on the JS thread.
- `setImageCacheLimit(bytes)` — byte budget for decoded images (64 MB). A
  decoded image is resident twice, as CPU pixels and as the GPU texture uploaded
  from them, so this is applied to both the pixel cache and tgfx's context cache.

## Requirements

- React Native **0.78+** with the **New Architecture** (Nitro Views are Fabric-only)
- iOS: Xcode 16.4+, Metal; Android: NDK 27+, `compileSdk` 34+, OpenGL

## Install (monorepo / local)

tgfx is a git submodule built from source.

```bash
git submodule update --init --recursive
# fetch tgfx's third_party (depsync) — see scripts/
cd packages/react-native-tgfx/cpp/third_party/tgfx && depsync
```

Android builds tgfx automatically via CMake. For iOS, build the tgfx static lib
once before `pod install`:

```bash
bash packages/react-native-tgfx/scripts/build-tgfx-ios.sh   # SIMULATORARM64 by default
```

## On-device rendering tests

Rendering is verified with [React Native Harness][harness] image snapshots,
which mount a real `<Canvas>` in the example app and screenshot it — no app
navigation and no UI selectors.

```bash
cd apps/example
npx react-native run-android          # rebuild once after adding @react-native-harness/ui
npx react-native-harness --harnessRunner android-emulator
```

Tests live in `apps/example/src/*.harness.tsx`; baselines land in
`apps/example/src/__image_snapshots__/<runner>/`. Runners are declared in
`apps/example/rn-harness.config.mjs`.

**`android-emulator` is the authoritative runner.** It targets the
`Pixel_8_API_35` AVD, which anyone can recreate, so a diff there is a rendering
change rather than a different phone. Review that set as the source of truth.

The `android` runner (motorola moto g35 5G) is **advisory**: real GPU and real
driver, but its baselines only ever match that one phone. GPU, density and
anti-aliasing all move pixels, so a diff there on another device is not a
regression — check the emulator before believing it.

**Never delete a baseline to "fix" a failure.** A missing baseline is written on
the spot and reported as a pass, so a checkout with no baselines passes without
comparing anything. Regenerate deliberately: delete the file, re-run, then open
the new PNG and confirm it is actually correct before committing it.

Snapshot targets must use `composite="texture"`: a screenshot draws the view
tree into a bitmap, and a `composite="layer"` canvas lives on its own
compositor layer where nothing can see it.

[harness]: https://react-native-harness.dev

## License

MIT — wraps tgfx (BSD-3-Clause) and Nitro (MIT).
