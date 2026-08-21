# Animation, node handles, buffers, performance

## Element factories and `Scene` (React-free)

Every component has a lowercase element factory returning the same plain node
the JSX would: `rect`, `rrect`, `oval`, `circle`, `line`, `path`, `image`,
`imageSvg`, `text`, `span`, `glyphs`, `textPath`, `fill`, `atlas`, `vertices`,
`backdropBlur`, `glass`, `cameraFrame`, `group`, `paint`, `linearGradient`,
`radialGradient`, `sweepGradient`, `diamondGradient`, `shader`, `imageShader`,
`colorShader`, `blend`, `blendColor`, `blur`, `dropShadow`, `colorMatrix`,
`luma`, `alphaThreshold`, `filmGrain`, `fractalNoise`, `turbulence`,
`dashPathEffect`, `cornerPathEffect`, `mask`. Signature
`(props, children?: SceneNode[]) => SceneNode`; props are the JSX props
(including `ref` handles and `SharedValue`s). NOTE: the factory `textPath`
builds the text-on-a-path node; the font utility that returns SVG path data is
`textToPath`.

`Scene` holds a root list of `SceneNode`s and drives targets with no React:

```ts
const scene = Scene.create()            // or Scene.from(nodes)
scene.add(node); scene.insert(node, 0); scene.remove(node)
scene.replaceChildren(nodes); scene.clear()
scene.flush()                           // commit now (else once per microtask)
await scene.save(path); scene.toImage(); scene.toSvg(); scene.toPdf(path)
                                        // export sugar; size from call options
                                        // ?? Scene.create({width,height}) ?? a
                                        // lone attached surface
const detach = scene.attach(viewRef)    // TgfxViewRef; several targets fan out
scene.dispose()
```

Structural mutation = one re-encode per batched commit; value mutation goes
through `createHandle()` exactly as with JSX. Factories and JSX compile
byte-identically — components are sugar over the same nodes.

Worklet runtimes build scenes too: the compile graph is workletized
(file-level `'worklet'` directives; `workletized.test.ts` pins them). Inside a
worklet use `createScene()` / `sceneFrom()` — statics cross as remote
functions — keep the scene on that runtime's `globalThis`, flush explicitly,
and render through an attached boxed offscreen surface. Exports throw on a
worklet; handles/mappers stay JS-side. Plugin gotchas that shaped this: no
getters in top-level objects, no assignments to captured module `let`s, and a
factory-returned arrow needs its own `'worklet'` directive.

## Callable forms of the hook-only APIs

Every hook wraps a callable (React-free) form: `createClock()` →
`{value, stop()}`; `createVideoPlayer(source, opts?)` → Promise of a player
with `setOptions`/`onFrame`/`dispose`; `createCameraFrameSink(opts?)` →
`{image, posture, push(frame), dispose}` (VisionCamera adapter =
`sink.push(frame)` in a frame processor); `createSpriteBuffer(capacity)` /
`createVertexBuffer(options)`; `dispatchPress(nodes, handlers)` with
`scene.handlesAt(surface.hitTest(x, y, precise))` for headless taps. The
clock/video/camera callables need Reanimated (UI-thread pumps); the rest work
without it. There is no separate `bindSharedValues`: an attached `Scene` runs
the driver mapper itself.

## The model

A scene commit compiles the React tree into a binary draw program. Animated
values live in native **slots** the renderer patches on the UI thread.

- `SharedValue` prop → slot → **zero JS per frame**.
- `handle.set()` on a slotted prop → slot patch, **worklet-safe**, no React
  render, no reconciler commit, no Fabric commit.
- `handle.set()` on an unslotted prop → **re-encode** (still no React render;
  from a worklet it hops to the JS thread to do it).
- Ordinary JSX prop change → React render + recompile + upload.

## `Animated<T>` props

`Animated<T> = T | SharedValueLike<T>`. Numeric, boolean and string props typed
`Animated<T>` take a Reanimated `SharedValue` directly — **no `useDerivedValue`
wrapper** (that is a Skia idiom).

```tsx
import { useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { Canvas, Circle } from 'react-native-tgfx'

function Pulse() {
  const r = useSharedValue(20)
  useEffect(() => {
    r.value = withRepeat(withTiming(60, { duration: 900 }), -1, true)
  }, [r])

  return (
    <Canvas style={{ width: 200, height: 200 }}>
      <Circle cx={100} cy={100} r={r} color="#d98a4a" />
    </Canvas>
  )
}
```

### Animated color

A `SharedValue` inside a `ColorComponents` tuple animates that channel:

```tsx
<Rect x={0} y={0} width={40} height={40} color={[red, 0.2, 0.4, 1]} />
```

A `SharedValue` holding a color **string** or a packed number does not animate —
conversion into channels happens during scene compilation on the JS thread.

### One opacity per chain

A draw command has a single alpha slot, so two opacities multiply at commit time
and freeze:

```
[tgfx] two opacities in one chain, at least one animated: a draw command has a
single alpha slot, so their product is frozen at the last commit. Animate one
opacity per chain.
```

### `useClock`

```ts
const t: SharedValueLike<number> = useClock()   // seconds since its first frame callback
```

```tsx
<Shader source={source} uniforms={{ uTime: t, uSize: [300, 300] }} />
```

## `useNode` / `createHandle` — `NodeHandle`

```ts
interface NodeHandle { set(props: Record<string, unknown>): void }
```

```tsx
const box = useNode()

<RoundedRect ref={box} x={20} y={20} width={70} height={50} r={12} color="#4F8EF7" />

box.set({ x: 120 })
```

Works from plain JS event handlers **without Reanimated**. With Reanimated +
Worklets installed, slot-backed writes also run inside worklets:

```tsx
const pan = Gesture.Pan().onUpdate((e) => {
  'worklet'
  dot.set({ cx: e.x, cy: e.y })
})
```

### What has slots

- **Geometry**: `x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`,
  `y1`, `x2`, `y2`
- **Paint**: `strokeWidth`, `strokeMiter`, `opacity`, `fontSize`, `visible`,
  `color`, and the enums `style`, `strokeCap`, `strokeJoin`, `blendMode`,
  `antiAlias`
- **Images**: `image` (registry id patched in place), `rect` (source sub-rect)
- **Group transform operands**: `translateX`, `translateY`, `scale`, `scaleX`,
  `scaleY`, `rotate` (`rotateZ` is an alias), `skewX`, `skewY`
- **Shader** `uniforms` (32-float pool)
- **Gradients**: geometry (`start`, `end`, `center`), `positions`, `colors`
  (max 16 stops)
- **Filters**: `blur`, `blurX`, `blurY`, `dx`, `dy` on `<Blur>` / `<DropShadow>`;
  `threshold` on `<AlphaThreshold>`; `matrix` on `<ColorMatrix>`
- **Backdrop material**: `blur`, `refraction`, `depth`, `frost`, `dispersion`,
  `splay`, `lightAngle`, `lightIntensity` on `<BackdropBlur>` / `<Glass>`
- **Film grain**: `size`, `density`, `seed` on `<FilmGrain>` (`opacity` only in
  the colourless mode; `secondColor` re-encodes)
- **Strings**: `text` and `path` — re-shaped / re-parsed on the render thread

```tsx
fx.set({ uniforms: { uFace: [face.x, face.y], uRadius: face.width / 2 } })
label.set({ text: String(Math.round(fps.value)) })
sprite.set({ rect: { x: frame * 32, y: 0, width: 32, height: 32 } })
fade.set({ end: { x: drag.x, y: 0 }, positions: [0, t] })
glow.set({ blur: 4 + press.value * 12, dy: 2 + press.value * 6 })
group.set({ rotate: spin.value, scale: 1 + pinch.value })
```

### Lazy slots

Most **non-geometry** slot families are created lazily by the first write, not
by the `ref` — each costs the render thread work every frame. So the first write
re-encodes once, and every write after it is a slot patch. A `ref` on `<Shader>`
is the exception: its uniforms are live from the first compile.

### Two rules that bite

1. **Colors animated from a worklet must be packed or component form.**
   ```tsx
   box.set({ color: '#4F8EF7' })         // works, but hops to JS to parse, then re-encodes
   box.set({ color: 0xff4f8ef7 })        // packed AARRGGBB, patches slots in place
   box.set({ color: [0.3, 0.5, 1, 1] })  // r, g, b, a in 0..1, patches slots in place
   ```
   `set()` is itself a worklet. A key it cannot serve on the UI thread is
   collected and forwarded with `runOnJS`, so a string color lands — just a
   thread hop and a re-encode later, which is fine for a one-off and wrong for
   a per-frame animation.
2. **The next React commit wins.** An imperative write survives until the canvas
   re-renders, then the JSX props are the truth again. Drive a value from one
   side or the other, never both.

## Pools — `createHandle`

`createHandle()` is `useNode()` without the hook, for making N handles at once.
`visible={false}` skips drawing **and** hit testing, and is slot-backed — so a
pool of mounted nodes is the supported way to do particle systems and
variable-count scenes without remounting.

```tsx
const [dots] = useState(() => Array.from({ length: 64 }, () => createHandle()))

<Canvas>
  {dots.map((ref, i) => (
    <Circle key={i} ref={ref} cx={0} cy={0} r={4} visible={false} color="#fff" />
  ))}
</Canvas>

dots[next].set({ visible: true, cx: x, cy: y })
```

The same trick sizes a face-blur scene: allocate a fixed number of ovals, and
collapse the unused ones to `width: 0, height: 0`.

## Shared buffers

For counts too large for one handle each, share a typed array with the renderer.

### `useSpriteBuffer(capacity): SpriteBuffer`

`SPRITE_FLOATS` (7) floats per sprite: `srcX, srcY, srcW, srcH, scale, centreX,
centreY`.

```tsx
const sprites = useSpriteBuffer(512)
const count = useSharedValue(0)

<Atlas image={sheet} buffer={sprites} count={count} />

// per frame, in a worklet
sprites.set(i, 0, 0, 16, 16, p.scale, p.x, p.y)
count.value = alive          // set the count *after* filling entries
```

### `useVertexBuffer(options): VertexBuffer`

`VertexBufferOptions`: `maxVertices`, optional `maxIndices`, and
`textures`/`colors` booleans to reserve those sections.
`positions`/`textures`/`colors`/`indices` are plain `Float32Array` views.

```tsx
const mesh = useVertexBuffer({ maxVertices: 4, maxIndices: 6 })
mesh.positions.set([0, 0, 200, 0, 0, 200, 200, 200])
mesh.indices.set([0, 1, 2, 1, 2, 3])

<Vertices buffer={mesh} vertexCount={4} indexCount={6} />
```

### `meshViews(buffer)` — the worklet gotcha

A worklet's captured `mesh.positions` is a **cloned copy**, not the shared
memory. Call `meshViews()` inside the worklet to map that runtime's own view
onto the same buffer:

```tsx
const drag = Gesture.Pan().onUpdate((e) => {
  'worklet'
  meshViews(mesh).positions[0] = e.x
})
```

## Performance levers

1. **Animate slots, not the tree.** Changing ordinary JSX props recompiles and
   uploads the scene.
2. **Keep `<Canvas>` children primitive.** The reconciler recognises the
   exported drawings directly; a wrapper function component falls back to the
   slow path.
   ```tsx
   <Canvas>{shapes.map((s) => <Rect key={s.id} {...s} />)}</Canvas>   // fast
   <Canvas>{shapes.map((s) => <Star key={s.id} {...s} />)}</Canvas>   // falls back
   ```
3. `<Group picture>` for a static subtree; dynamic children fall back to direct
   drawing.
4. `<Group layer>` costs an offscreen surface — only for group opacity or group
   filters.
5. Pool handles + `visible` instead of mounting/unmounting.
6. Move large sprite/mesh collections to shared buffers.
7. One animated opacity per chain.
8. Keep shader source strings module-level constants (the transpile cache keys
   on the string, and holds 64 entries).

### Redraws are scoped to what a canvas reads

Decoded images and typefaces live in process-wide registries, but a canvas only
reacts to the registry its own compiled scene reads. A scene counts as reading
images when it holds `<TgfxImage>`, `<CameraFrame>` or `<Atlas>`, an image handle,
an `<ImageShader>`, or a runtime shader / `<Blend>` whose child shaders sample an
image; and as reading fonts when it holds any text. A canvas of shapes,
gradients and image-free shaders is idle while a video plays beside it.

### Offscreen canvases do not draw (Android)

A canvas scrolled out of view keeps its surface but skips its draws entirely.
Animated values keep flowing into slots and the first frame after it scrolls
back in picks them up. `snapshot()` / `save()` still force the frame they need.

### Vulkan backend (Android)

```properties title="android/gradle.properties"
TgfxVulkan=ON
```

Links the Vulkan prebuilt, swaps the window glue to `VulkanWindow`/
`VulkanDevice`, and routes video frames through an `AImageReader`. Measured on a
Galaxy F14 (90 Hz, Mali-G68): ~15–30% more presented FPS at GPU-bound loads, at
similar CPU and ~50 MB more PSS. Prebuilts for all four ABIs ship in the package.

### Measuring (this repo)

```bash
node benchmarks/renderer-benchmark/scripts/run-quick.mjs --tag=mine --renderers=tgfx,thor-gpu,skia-graphite
```
