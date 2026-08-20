# Drawing — Canvas, shapes, paint, groups, hit testing

Everything drawn is a child of `<Canvas>`. Import everything from
`react-native-tgfx`.

## `<Canvas>` — `CanvasProps`

```tsx
<Canvas
  ref={canvas}                    // Ref<CanvasHandle>
  style={{ width: 300, height: 140 }}
  composite="layer"               // Android only: 'layer' (default) | 'texture'
  colorSpace="srgb"               // 'srgb' (default) | 'display-p3' — read once, at mount
  opaque={false}                  // no alpha channel; clears to opaque black
/>
```

| Prop | Meaning |
| --- | --- |
| `style` | Standard RN view style. |
| `ref` | `CanvasHandle` — `snapshot`, `save`, `redraw`, `hitTest`. |
| `composite` | `'layer'` (default) gives the canvas its own compositor layer: fastest, but it punches through the window — RN content *behind* the canvas does not show through transparent pixels and view transforms do not apply. `'texture'` draws inside the view hierarchy (transparency and transforms behave normally) at the cost of a window redraw per frame. Ignored on iOS. |
| `colorSpace` | `'display-p3'` creates a P3 surface so wide-gamut images and gradients keep their color. **Read once at mount** — changing it later warns and does nothing; remount with a `key`. A `color` prop is still carried as sRGB in the draw program. |
| `opaque` | Renders without an alpha channel. Measured neutral for performance (57.5 → 56.7 FPS with 400 shapes on a Mali-G68) — treat it as an appearance switch, not an optimisation. |

### `CanvasHandle`

```ts
interface CanvasHandle {
  snapshot(options?: SnapshotOptions): Promise<Snapshot>
  save(path: string, options?: SnapshotOptions): Promise<void>
  redraw(): void
  hitTest(x: number, y: number, options?: HitTestOptions): HitTestResult[]
}
```

`redraw()` forces a frame without a React commit — only needed for state the
scene *points at* rather than holds (an image handle re-pointed at new pixels).
A `NodeHandle.set` already redraws on its own.

## Shapes

| Component | Props |
| --- | --- |
| `<Rect>` | `x`, `y`, `width`, `height` |
| `<RoundedRect>` | `RectProps` + `r`, or `rx`/`ry` (which override `r`) |
| `<Circle>` | `cx`, `cy`, `r` |
| `<Oval>` | `x`, `y`, `width`, `height` |
| `<Line>` | `x1`, `y1`, `x2`, `y2` |
| `<Path>` | `path` (SVG data), `start`, `end`, `fillType` |
| `<Fill>` | fills the current clip; the usual host for a full-surface `<Shader>` |
| `<TgfxImage>` | see [api-content.md](api-content.md) |
| `<ImageSVG>` | the same node under Skia's name, for a handle loaded from an SVG document |
| `<Atlas>`, `<Vertices>` | batched sprites / meshes, see [api-content.md](api-content.md) |
| `<Glyphs>`, `<Text>`, `<TextPath>`, `<Span>` | see [api-content.md](api-content.md) |
| `<CameraFrame>` | see [vision-camera.md](vision-camera.md) |
| `<BackdropBlur>`, `<Glass>` | see [api-effects-shaders.md](api-effects-shaders.md) |

The numeric geometry props above are `Animated<number>` — a plain number or a
Reanimated `SharedValue`. Not every geometry prop is: `<Path>`'s `path` is
`Animated<string>` (a string slot) and its `fillType` is static, and
`<BackdropBlur>`/`<Glass>` animate their rect **and their whole material** —
`blur`, `refraction`, `depth`, `frost`, `dispersion`, `splay`, `lightAngle`,
`lightIntensity` are all value slots. Only the corner radius `r` is a plain
`number` with no slot: it is a clip, not a material parameter.

```tsx
<Rect x={0} y={0} width={300} height={140} color="#101725" />
<RoundedRect x={20} y={20} width={120} height={80} r={16} color="#4F8EF7" />
<Circle cx={70} cy={70} r={44} color="#d98a4a" />
<Oval x={10} y={10} width={80} height={40} color="#fff" />
<Line x1={0} y1={0} x2={100} y2={100} style="stroke" strokeWidth={2} color="#fff" />
<Path path="M20 80 L80 20 L140 80 Z" color="#ffffff" />
<Fill color="#000" />
```

## Paint — `PaintProps`

Every drawing component, `<Group>` and `<Paint>` accepts these. Set them inline
or through a `<Paint>` child; a `<Paint>` on a `<Group>` supplies inherited
defaults for the subtree.

| Prop | Type | Notes |
| --- | --- | --- |
| `ref` | `NodeHandle` | from `useNode()` / `createHandle()` |
| `visible` | `Animated<boolean \| number>` | slot-backed; the supported way to pool nodes |
| `color` | `Animated<Color>` | see Colors below |
| `style` | `'fill' \| 'stroke'` | defaults to `'fill'` |
| `strokeWidth` | `Animated<number>` | |
| `strokeCap` | `'butt' \| 'round' \| 'square'` | |
| `strokeJoin` | `'miter' \| 'round' \| 'bevel'` | |
| `strokeMiter` | `Animated<number>` | miter falls back to bevel past this ratio; default 4 |
| `opacity` | `Animated<number>` | 0..1. **One animated opacity per chain.** |
| `antiAlias` | `boolean` | |
| `blendMode` | `BlendMode` | defaults to `'srcOver'` |

```tsx
<Circle cx={70} cy={70} r={40}>
  <Paint color="#f2c088" style="stroke" strokeWidth={3} />
</Circle>
```

## Colors — the `Color` type

Accepts all of:

```tsx
<Rect color="tomato" />                          // CSS named
<Rect color="#101725" />                         // hex, 3/4/6/8 digits
<Rect color="rgb(255 0 0)" />
<Rect color="rgba(255, 0, 0, 0.5)" />
<Rect color="hsl(210 80% 60%)" />
<Rect color="hsla(210, 80%, 60%, 0.5)" />
<Rect color={0xff4f8ef7} />                      // packed 0xAARRGGBB
<Rect color={[1, 0.2, 0.4, 1]} />                // [r, g, b, a] in 0..1
<Rect color="color(display-p3 1 0.2 0.1)" />
<Rect color="color(srgb 1 0 0 / 0.5)" />
```

**Animating color:** put a `SharedValue` inside a `ColorComponents` tuple —
`color={[red, 0.2, 0.4, 1]}`. A `SharedValue` holding a *string* or a packed
number does **not** animate: string parsing happens during scene compilation on
the JS thread.

**From a worklet:** `handle.set({ color: 0xff4f8ef7 })` or
`handle.set({ color: [0.3, 0.5, 1, 1] })` patch the color slots in place. A
`'#rrggbb'` string still applies, but only after a `runOnJS` hop to the parser
and a scene re-encode.

## `<Group>` — `GroupProps`

Paint and transform inherit down the subtree.

```tsx
<Group transform={[{ translate: [40, 0] }, { rotate: '12deg' }, { scale: 1.5 }]}>
  <Rect x={0} y={0} width={40} height={40} />
</Group>
```

| Prop | Meaning |
| --- | --- |
| `transform` | `Transform` — array of ops (below) |
| `origin` | `Vector` — shifts the pivot rotate/scale use, away from `(0, 0)` |
| `clip` | `ClipRect` (`{x, y, width, height, r?, rx?, ry?}`) or SVG path data. Read once per commit. |
| `invertClip` | keep what falls *outside* `clip` |
| `layer` | composite the subtree into one offscreen layer first |
| `picture` | record the subtree once and replay the recording |

### Transform ops

`translate: [x, y]`, `translateX`, `translateY`, `scale`, `scaleX`, `scaleY`,
`rotate` (number = radians, or a `'12deg'` / `'0.2rad'` string), `rotateZ` (an
alias for `rotate`), `skewX`, `skewY`. Any other key in a transform entry is
silently dropped by the compiler. Operands are individually slot-backed on a handle
(`group.set({ rotate: v })`).

### `layer` vs no layer

Without `layer`, a group `opacity` multiplies into each child, so overlapping
children double-blend. `layer` composites them once:

```tsx
<Group layer opacity={0.5}>
  <Circle cx={40} cy={40} r={30} color="#4F8EF7" />
  <Circle cx={70} cy={40} r={30} color="#4F8EF7" />
</Group>
```

It costs an offscreen surface — use it only for group opacity or group filters.

### `picture`

Records the subtree once and replays the recording every frame — for a static
background a scene redraws but never changes (a map, a chart grid). It replays
recorded *draw calls*, not rasterized pixels, so resolution is unchanged.

```tsx
<Group picture>
  <Path path={gridPath} color="#e5e5ea" style="stroke" />
</Group>
```

Ignored with a warning if anything under it changes between frames — an
animated value, a video or camera frame, an image still decoding.

## `<Mask>` — `MaskProps`

```tsx
<Mask
  mode="luminance"                          // 'alpha' (default) | 'luminance'
  mask={
    <Rect x={0} y={0} width={256} height={256}>
      <RadialGradient center={{ x: 128, y: 128 }} r={128} colors={['white', 'black']} />
    </Rect>
  }
>
  <TgfxImage image={photo} x={0} y={0} width={256} height={256} />
</Mask>
```

`'alpha'` keeps what the mask is opaque under; `'luminance'` keeps what it is
bright under.

## Hit testing

`canvas.hitTest(x, y, options?)` returns `HitTestResult[]`, topmost first.
Answered natively from the geometry the renderer is drawing *this frame*, so it
follows animated values rather than the last committed props, and it
inverse-transforms through each `<Group>`.

```ts
interface HitTestOptions { precise?: boolean }   // filled region vs bounding box
interface HitTestResult {
  node: NodeHandle | null   // null when the node carries no ref
  path: number[]            // child indices root-down, so anonymous hits stay distinct
}
```

```tsx
const canvas = useRef<CanvasHandle>(null)
const bar = useNode()

<GestureDetector gesture={Gesture.Tap().onEnd((e) => {
  const hits = canvas.current?.hitTest(e.x, e.y) ?? []
  if (hits.some((hit) => hit.node === bar)) select(bar)
})}>
  <Canvas ref={canvas} style={{ flex: 1 }}>
    <Rect ref={bar} x={10} y={10} width={40} height={80} color="#0a84ff" />
  </Canvas>
</GestureDetector>
```

### `useCanvasPress`

The declarative half, wired to the responder system. Only the **topmost** hit
fires.

```tsx
const onTouch = useCanvasPress(
  canvas,                                   // { current: CanvasHandle | null }
  [[bar, () => select(bar)]],               // Iterable<[NodeHandle, () => void]>
  { precise: true, onPress: ({ x, y, nodes }) => track(x, y, nodes) }
)

<View onStartShouldSetResponder={() => true} onResponderRelease={onTouch}>
  <Canvas ref={canvas}>
    <Rect ref={bar} x={10} y={10} width={40} height={80} color="#0a84ff" />
  </Canvas>
</View>
```

`onPress` fires for every press including one that landed on nothing.
A backdrop node has no hit bounds and is never pressable.
