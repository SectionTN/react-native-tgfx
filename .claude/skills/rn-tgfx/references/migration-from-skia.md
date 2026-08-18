# Migrating from `@shopify/react-native-skia` to `react-native-tgfx`

The JSX looks familiar on purpose. The execution model is not — port the mental
model first, or you will write Skia code that compiles and runs slowly.

## The four differences that matter

1. **There is no object graph.** Skia gives you `Skia.Paint()`, `Skia.Path`,
   `Skia.RuntimeEffect.Make()`, `SkImage` — live objects you mutate. tgfx has
   none of it: paint is props or a `<Paint>` child, paths are **SVG strings**,
   shaders are **source strings**, images are opaque handles.
2. **The scene is compiled, not walked.** Each commit encodes the tree to a
   binary draw program. Animated values live in native **slots** patched on the
   UI thread. So `SharedValue` props and `NodeHandle.set()` are free per frame;
   changing ordinary JSX props recompiles and re-uploads.
3. **`useNode()` replaces most of Skia's imperative escape hatches.** No
   `useCanvasRef().current.redraw()` loops, no `useComputedValue` chains — get a
   handle and write slots, from JS or from a worklet.
4. **Children of `<Canvas>` should be primitive.** The reconciler recognises the
   exported drawing components directly; a wrapper function component
   (`<Bar />`, `<Star />`) falls back to a slower path. In Skia this is free.

## Component mapping

| Skia | tgfx | Notes |
| --- | --- | --- |
| `<Canvas mode ref>` | `<Canvas ref composite colorSpace opaque>` | no `mode`; ref is a `CanvasHandle` |
| `<Group>` | `<Group>` | `transform`, `origin`, `clip`, `invertClip`, `layer` all carry over; tgfx adds `picture` |
| `<Rect>` `<RoundedRect>` `<Circle>` `<Oval>` `<Line>` | same names | Skia's `rect={rect(...)}` object → flat `x`/`y`/`width`/`height` props |
| `<Path path={SkPath \| string}>` | `<Path path={string}>` | SVG string only |
| `<Fill>` | `<Fill>` | |
| `<Paint>` | `<Paint>` | same "child supplies paint" idea |
| `<Image image={SkImage} fit>` | `<Image image={TgfxImage} fit>` | |
| `<ImageShader>` | `<ImageShader>` | |
| `<Atlas sprites transforms>` | `<Atlas sprites>` / `buffer` | **tgfx sprites are axis-aligned**; no RSXform rotation — rotate a `<Group>` around the batch |
| `<Vertices>` | `<Vertices>` | + `buffer` for the zero-allocation path |
| `<Text font>` `<TextPath>` `<Glyphs>` | `<Text>` `<TextPath>` `<Glyphs>` | no `SkFont` object — register with `useFonts`, then pass `fontFamily`/`fontSize` |
| `Skia.ParagraphBuilder` | `<Text>` + `<Span>` children | |
| `<LinearGradient>` `<RadialGradient>` `<SweepGradient>` | same names | + `<DiamondGradient>` |
| `<Turbulence>` `<FractalNoise>` | same names | |
| `<ColorMatrix>` `<Blend>` `<BlendColor>` `<Lerp>` | `<ColorMatrix>` `<Blend>` `<BlendColor>` `<Luma>` | |
| `<Blur>` `<Shadow>` | `<Blur>` `<DropShadow>` | |
| `<BackdropFilter>` / `<BackdropBlur>` | `<BackdropBlur>` | plus `<Glass>` (refraction, frost, dispersion) |
| `<Mask mode mask>` | `<Mask mode mask>` | |
| `<DashPathEffect>` `<CornerPathEffect>` | same names | children of `<Path>` |
| `<RuntimeShader source={effect}>` | `<Shader source={string}>` | no `RuntimeEffect.Make` step |
| `useImage` | `useImage` | returns `TgfxImage \| null`; `useImageState` adds `loading`/`error` |
| `useSVG` + `<ImageSVG>` | `useImage(require('./x.svg'))` + `<Image>` | an SVG source decodes to a resolution-independent picture |
| `useVideo` | `useVideo` | `video.currentFrame` → `<Image image={...}>` |
| `useFont` / `matchFont` | `useFonts` / `loadFont` + `fontFamily` prop | |
| `useTouchHandler` | `canvas.hitTest()` / `useCanvasPress` + Gesture Handler | |
| `canvasRef.current.makeImageSnapshot()` | `await canvas.current.snapshot()` | async, returns encoded bytes in an `ArrayBuffer` |
| `drawAsImage(element, size)` | `await renderToImage(element, { width, height })` | |
| `Skia.Path.Make()` / `path.op()` | `pathOp`, `pathBounds`, `pathTransform`, … on strings | |
| — | `renderToPdf`, `renderToSvg` | no Skia equivalent |
| Skottie / Lottie | — | no equivalent |

## Paint

```tsx
// Skia
const paint = Skia.Paint()
paint.setColor(Skia.Color('#f2c088'))
paint.setStyle(PaintStyle.Stroke)
paint.setStrokeWidth(3)
<Circle cx={70} cy={70} r={40} paint={paint} />

// tgfx
<Circle cx={70} cy={70} r={40} color="#f2c088" style="stroke" strokeWidth={3} />
// or
<Circle cx={70} cy={70} r={40}>
  <Paint color="#f2c088" style="stroke" strokeWidth={3} />
</Circle>
```

Color strings, `rgb()`/`hsl()`, packed `0xAARRGGBB` and `[r,g,b,a]` in 0..1 all
work. There is no `Skia.Color()` call to make.

## Paths

```tsx
// Skia
const path = Skia.Path.Make()
path.moveTo(0, 0).lineTo(120, 0).lineTo(120, 120).close()
const cut = path.op(hole, PathOp.Difference)
<Path path={cut} />

// tgfx
const plate = 'M0 0 L120 0 L120 120 L0 120 Z'
const hole = 'M40 40 L80 40 L80 80 L40 80 Z'
<Path path={pathOp(plate, hole, 'difference')} />
```

Skia's `path.trim(start, end)` → the `start`/`end` props on `<Path>` (both
animatable, both 0..1). `path.getTotalLength()` / `getPoint()` →
`pathLength` / `pathPointAtLength` (angle in **radians**).

## Animation

```tsx
// Skia (older)
const r = useValue(20)
const c = useComputedValue(() => r.current * 2, [r])
<Circle r={c} />

// Skia (current) — Reanimated shared values, often via useDerivedValue
const r = useSharedValue(20)
const c = useDerivedValue(() => r.value * 2)
<Circle r={c} />

// tgfx — the shared value goes straight in
const r = useSharedValue(20)
<Circle r={r} />
```

Derived values are ordinary Reanimated: `useDerivedValue` still works, but a
plain `SharedValue` needs no wrapper, and per-frame arithmetic is usually better
expressed as a `handle.set()` inside the worklet that already runs.

Anything Skia solved with `useComputedValue` + a re-render, tgfx solves with a
`useNode()` handle:

```tsx
const bar = useNode()
const pan = Gesture.Pan().onUpdate((e) => {
  'worklet'
  bar.set({ x: e.x, width: e.translationX })
})
```

**Colors are the one exception.** In tgfx, an animated color must be a
`ColorComponents` tuple (`color={[red, 0.2, 0.4, 1]}`); a `SharedValue` holding
a color *string* does not animate. From a worklet, `set({ color })` needs a
packed number or a tuple.

## Runtime shaders

```tsx
// Skia
const effect = Skia.RuntimeEffect.Make(`
  uniform float2 uSize;
  half4 main(float2 pos) { return half4(pos / uSize, 0.6, 1.0); }
`)!
<Fill>
  <Shader source={effect} uniforms={{ uSize: [300, 140] }} />
</Fill>

// tgfx — the source string is the source; no Make, no null check
const source = `
uniform float2 uSize;
half4 main(float2 pos) { return half4(pos / uSize, 0.6, 1.0); }
`
<Fill>
  <Shader source={source} uniforms={{ uSize: [300, 140] }} />
</Fill>
```

The SkSL is a **subset**. Port checklist:

- [ ] Every declaration and helper function moved **above `main()`**.
- [ ] One name per declaration statement (`float a = 1.0, b = 2.0;` is rejected).
- [ ] No array uniforms — flatten, or pack into vectors / a square matrix.
- [ ] Uniform types limited to `half`/`half2..4`, `float`/`float2..4`,
      `vec2..4`, `int`, `float2x2`/`3x3`/`4x4`, `shader`.
- [ ] Child shaders referenced **only** as `name.eval(coord)` or
      `sample(name, coord)`; one child per `uniform shader`, matched by order.
- [ ] Loop bounds are compile-time constants.
- [ ] `smoothstep(edge0, edge1, x)` has `edge0 < edge1`.
- [ ] `mod()` instead of `%`.
- [ ] Source strings hoisted to module scope (the transpile cache keys on the
      string).

Uniforms take `SharedValue`s directly and become UI-thread slots — the Skia
`useSharedValueEffect` / `RuntimeShaderBuilder` dance is gone.

## Snapshots and offscreen

```tsx
// Skia
const image = canvasRef.current?.makeImageSnapshot()      // SkImage, synchronous
const b64 = image?.encodeToBase64()

// tgfx
const shot = await canvas.current.snapshot({ format: 'png' })   // { data: ArrayBuffer, width, height }
await canvas.current.save('/absolute/path/out.png')             // bytes never enter JS
```

`drawAsImage(element, size)` → `await renderToImage(element, { width, height })`.
tgfx additionally has `renderToPdf` and `renderToSvg`, which Skia does not.

---

# Skia frame processors → tgfx camera

This is the migration people actually come for. Both VisionCamera Skia paths
map onto the same tgfx shape.

## What changes conceptually

A Skia frame processor is **imperative and per-frame**: your worklet runs every
frame, calls `frame.render()`, then issues draw calls into a Skia canvas.

tgfx is **declarative and per-commit**: the scene is compiled once, the frame
buffer is re-pointed behind a stable handle, and per-frame work is reduced to
slot writes. There is no per-frame draw callback to write at all — often no JS
per frame whatsoever.

| Skia frame processor | tgfx |
| --- | --- |
| `frame.render()` | `<CameraFrame image={image} {...posture} />` — mandatory in Skia, structural here |
| `frame.drawRect(rect, paint)` etc. per frame | mount the node once, write its slots from the detector worklet |
| `Skia.Paint()` per frame | `<Paint>` / props, compiled once |
| `frame.width` / `frame.height` | `posture.width` / `posture.height` |
| frame coordinate space | children of `<CameraFrame>` are already in frame pixels |
| orientation handled by the Skia canvas | `posture.rotation` / `posture.mirror`, spread onto `<CameraFrame>` |
| a variable number of draw calls | a **fixed** pool of nodes, unused ones collapsed to zero size |

## VisionCamera v4 — `useSkiaFrameProcessor`

```tsx
// Before (Skia, VisionCamera v4)
const frameProcessor = useSkiaFrameProcessor((frame) => {
  'worklet'
  frame.render()
  const faces = detectFaces(frame)
  const paint = Skia.Paint()
  paint.setColor(Skia.Color('red'))
  for (const face of faces) {
    frame.drawRect(
      Skia.XYWHRect(face.bounds.x, face.bounds.y, face.bounds.width, face.bounds.height),
      paint
    )
  }
}, [])

<Camera device={device} isActive frameProcessor={frameProcessor} />
```

```tsx
// After (tgfx)
const boxes = [useNode(), useNode(), useNode(), useNode()]   // fixed pool

const detect = useCallback((frame: Frame) => {
  'worklet'
  const faces = detectFaces(frame)
  for (let i = 0; i < boxes.length; i++) {
    const b = i < faces.length ? faces[i]!.bounds : null
    boxes[i]!.set(b == null
      ? { width: 0, height: 0 }
      : { x: b.x, y: b.y, width: b.width, height: b.height })
  }
}, [boxes])

const { image, posture, onFrame } = useCameraFrame(detect)
const frameOutput = useFrameOutput({
  pixelFormat: 'yuv',
  dropFramesWhileBusy: true,
  enablePhysicalBufferRotation: true,
  onFrame,
})

<>
  <Camera style={styles.hidden} device={device} isActive outputs={[frameOutput]} />
  <Canvas style={StyleSheet.absoluteFill} opaque={true}>
    <CameraFrame image={image} {...posture}>
      {boxes.map((ref, i) => (
        <Rect key={i} ref={ref} x={0} y={0} width={0} height={0}
              color="red" style="stroke" strokeWidth={3} />
      ))}
    </CameraFrame>
  </Canvas>
</>
```

Note the two structural moves: `frameProcessor` → `outputs={[frameOutput]}`
(VisionCamera v5's output model), and the drawing leaves the worklet entirely.

## VisionCamera v5 — `<SkiaCamera>`

```tsx
// Before
import { SkiaCamera } from 'react-native-vision-camera-skia'

<SkiaCamera
  style={StyleSheet.absoluteFill}
  device={device}
  isActive={true}
  pixelFormat="yuv"
  onFrame={(frame, render) => {
    'worklet'
    render(({ frameTexture, canvas }) => {
      canvas.drawImage(frameTexture, 0, 0)
    })
    frame.dispose()
  }}
/>
```

```tsx
// After — the Camera becomes an invisible frame source, the Canvas is the preview
const { image, posture, onFrame } = useCameraFrame()
const frameOutput = useFrameOutput({
  pixelFormat: 'yuv',
  dropFramesWhileBusy: true,
  enablePhysicalBufferRotation: true,
  onFrame,
})

<Camera style={styles.hidden} device={device} isActive={true} outputs={[frameOutput]} />
<Canvas style={StyleSheet.absoluteFill} opaque={true}>
  <CameraFrame image={image} {...posture} />
</Canvas>
```

`<SkiaCamera>` always attaches a frame output and cannot opt out; with tgfx the
frame output is yours, so you decide whether anything runs in JS.

If nothing in JS needs the frame, add `react-native-tgfx-vision-camera` and
`sink.attach(frameOutput, image.handle)` — after that, **no frame reaches a JS
runtime at all**. See [vision-camera.md](vision-camera.md).

## Shader-over-frame

```tsx
// Before (Skia)
const effect = Skia.RuntimeEffect.Make(NEON)!
const frameProcessor = useSkiaFrameProcessor((frame) => {
  'worklet'
  const paint = Skia.Paint()
  paint.setImageFilter(
    Skia.ImageFilter.MakeRuntimeShader(Skia.RuntimeShaderBuilder(effect), null, null)
  )
  frame.render(paint)
}, [])

// After (tgfx) — declarative, uniforms on the UI thread
<CameraFrame image={image} {...posture}>
  {posture.width > 0 && (
    <Fill>
      <Shader source={NEON} uniforms={{ uSize: [posture.width, posture.height], uTime: clock }}>
        <ImageShader image={image} />
      </Shader>
    </Fill>
  )}
</CameraFrame>
```

## Porting gotchas

- **`frame.dispose()` is not yours to call.** `useCameraFrame` disposes the
  frame and releases the buffer in a `finally`, on every path including a throw.
  Calling `getNativeBuffer()` yourself inside `onEachFrame` adds a retain nothing
  releases and stalls the bounded pool.
- **Never store the buffer pointer.** A stale pointer does not throw; it imports
  whatever memory now sits at that address.
- **`pixelFormat: 'rgb'` is not a safe default here.** Skia's path often used
  RGB; tgfx samples YUV planes directly and converts in the fragment shader, so
  `'rgb'` only adds a full-frame CPU copy per frame.
- **Do not set tile modes on a frame `<ImageShader>`.** A YUV image sampled with
  anything but `clamp` renders fully transparent.
- **A variable number of detections must map onto a fixed number of nodes.** The
  scene compiles once; mounting and unmounting per detection re-encodes every
  frame and defeats the whole design.
- **Do not mix canvases.** One screen should be either Skia or tgfx, not both —
  two GPU canvases means two surfaces and two composites.
