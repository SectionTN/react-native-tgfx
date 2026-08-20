# Content — text, fonts, paths, images, video, atlas, meshes

## Text

```tsx
<Text text="Hello" x={20} y={60} fontSize={28} color="#f5f7fa" />
```

`y` is the **baseline**. A `width` turns it into a wrapping paragraph.

### `TextProps` = `PaintProps` + `FontProps` + `ParagraphProps` + `x`, `y`, `text`

`FontProps`:

| Prop | Notes |
| --- | --- |
| `fontSize` | `Animated<number>` |
| `fontFamily` | a family registered with `useFonts`/`loadFont`, or one the platform knows; unknown falls back to the platform default text font |
| `fontWeight` | `'normal' \| 'bold' \| 100…900`; picks the nearest face, synthesised when none is close |
| `fontStyle` | `'normal' \| 'italic'` |
| `fauxBold`, `fauxItalic` | force embolden/shear |
| `letterSpacing` | extra px between glyphs |

`ParagraphProps`:

| Prop | Notes |
| --- | --- |
| `width` | wrap width in px. Without it, text breaks only at explicit `\n` — the cheap single-line path. |
| `textAlign` | `'left' \| 'center' \| 'right'` |
| `lineHeight` | baseline-to-baseline px; defaults to the font's own |
| `maxLines` | 0/omitted = unlimited |
| `ellipsis` | appended to the last line when `maxLines` truncates |

`text` is `Animated<string>`: a `SharedValue` (or `handle.set({ text })`) gets a
**string slot** — the engine re-shapes on the render thread with no re-encode.
That is the live-counter path:

```tsx
label.set({ text: String(Math.round(fps.value)) })
```

### `<Span>` — styled runs

`<Span>` children replace the `text` prop when present.

```tsx
<Text x={0} y={40} width={220} fontSize={18}>
  <Span text="Total " />
  <Span text="4 500" fontWeight={700} color="#d98a4a" />
  <Span text=" credits" />
</Text>
```

`SpanProps`: `text`, `color`, `fontSize`, `fontFamily`, `fontWeight`,
`fontStyle`, `letterSpacing`. A span's `fontSize` is **static on purpose** — the
paragraph's `fontSize` is the one with the animation slot.

### `<TextPath>` — text laid along a curve

Each glyph is placed at its own advance along the path and rotated to the
tangent. The path is the baseline, so there is no `x`/`y` and no wrapping.

```tsx
<TextPath path="M8 170 q90 -70 170 0" text="along the curve" fontSize={20} startOffset={10} />
```

### `<Glyphs>` — explicit placement

No shaping, no line breaking, no font fallback. An id the face lacks draws
`.notdef`.

```tsx
const style = { fontSize: 32, fontFamily: 'PT Serif' }
const ids = glyphIds('wave', style)

<Glyphs x={20} y={60} {...style} glyphs={ids.map((id, i) => ({ id, x: i * 22, y: Math.sin(i) * 8 }))} />
```

## Fonts

```tsx
const ready = useFonts({
  'PT Serif': [
    require('./PT_Serif-Web-Regular.ttf'),
    require('./PT_Serif-Web-Bold.ttf'),
  ],
})                                        // boolean
```

| Function | Signature |
| --- | --- |
| `useFonts` | `(families: Record<string, FontSource[]>) => boolean` |
| `useFontsState` | same input → `FontsState` `{ ready, error }` — use when a failed load must be visible; `useFonts` stays `false` forever on failure |
| `loadFont` | imperative single-family registration |
| `loadFonts` | imperative multi-family registration |
| `<Image source={require() / https / file / svg / base64} ...ImageProps>` | THE image component: loads + draws when ready; function component, so its canvas leaves the direct-node fast path. `<TgfxImage image={handle}>` is the power form (plain host tag, direct path) — pair with `useImage`/`loadImage` |
| `<Canvas fonts={{Family: [source, ...]}}>` | registers + withholds children until ready (no fallback flash); failed load warns and renders anyway |
| `registeredFontFamilies` | `() => string[]` |
| `measureText` | `(text: string, style?: TextStyle) => TextMeasurement` |
| `textToPath` | `(text: string, style?: TextStyle) => string` (SVG path data) |
| `glyphIds` | `(text: string, style?: TextStyle) => number[]` |
| `glyphPositionAtCoordinate` | `(text, style, x, y) => GlyphPosition` — a point to an insertion point |
| `rectsForRange` | `(text, style, start, end) => TextBox[]` — a byte range to its boxes |

A `FontSource` is a `require()`'d asset, a URI, or raw base64 bytes.

`TextStyle` is exactly the `<Text>` props that affect layout —
`Omit<FontProps, 'fontSize'> & ParagraphProps & { fontSize?: number }` — derived
from them, so a width measured here is the width drawn.

```tsx
const box = measureText('measured', { fontSize: 22, fontFamily: 'PT Serif' })
const { lines } = measureText(label, { fontSize: 18, width: 200 })
```

`TextMeasurement` is relative to the **first baseline**: `ascent` is negative and
the box runs from `y + ascent` to `y + ascent + height`. Per-line entries are
`LineMeasurement`.

Text is shaped through HarfBuzz and reordered by the Unicode bidi algorithm:
Arabic joins, Indic reorders, ligatures and marks apply, and a right-to-left run
reads right to left inside a left-to-right paragraph. The base direction is the
first strong character's. `textAlign` still defaults to `'left'` — a
right-to-left paragraph that should sit right needs `textAlign="right"`. A script
still needs a face registered for it: the fallback chain is emoji-only, and an
uncovered codepoint warns once and draws `.notdef`. `U+200E`/`U+200F`/`U+061C`
work. Not implemented: UAX#9's explicit embedding/override/isolate controls, the
paired-bracket rule N0, and P1 — a `<Text>` is one paragraph however many
newlines it holds.

`glyphPositionAtCoordinate` and `rectsForRange` are the caret and selection
half, in the same baseline-relative coordinates: subtract the `x`/`y` you gave
`<Text>` from the touch point. `GlyphPosition` is `{ index, leading, line }` and
`TextBox` is `{ x, y, width, height, line, startIndex, endIndex }`, one per line
the range crosses. Every index is a **UTF-8 byte offset**, matching
`LineMeasurement.startIndex` — the same as a JS string index for ASCII only.

`index` is always the insertion point, never a glyph to advance past. **Not every
offset has a box** — a line's wrap space, a newline and a truncating ellipsis
draw nothing — so a caret needs the glyph before it as a fallback:

```tsx
const at = glyphPositionAtCoordinate(text, style, touch.x - x, touch.y - y)
const box = rectsForRange(text, style, at.index, at.index + 1)[0]
  ?? rectsForRange(text, style, at.index - 1, at.index)[0]
```

Both calls lay the paragraph out, like `measureText`: fine per tap, wasteful per
frame. `TextBox.endIndex` is exclusive; `LineMeasurement.endIndex` names its last
glyph.

`textToPath` returns SVG path data relative to the first baseline at `(0, 0)`, so
translate it by the `x`/`y` you would have given `<Text>`. Empty for a face with
no outlines (a color emoji).

```tsx
const outline = textToPath('outlined', { fontSize: 44, fontFamily: 'PT Serif' })

<Group transform={[{ translateX: 8 }, { translateY: 60 }]}>
  <Path path={outline} color="#d98a4a" style="stroke" strokeWidth={2} />
</Group>
```

## Paths

Paths are **SVG path strings**, everywhere. Helpers that create or modify
geometry return another SVG path string.

```tsx
<Path path={pathOp(plate, hole, 'difference')} color="#4F8EF7" />
```

| Function | Returns |
| --- | --- |
| `pathOp(a, b, op)` | path; `op` is `'union' \| 'difference' \| 'intersect' \| 'xor'` |
| `pathBounds(path, tight = false)` | `PathBounds` |
| `pathContains(path, x, y)` | `boolean` |
| `pathTransform(path, matrix)` | path, by a `PathMatrix` |
| `pathLength(path)` | `number` |
| `pathPointAtLength(path, distance)` | `PathPoint` — `x`, `y`, `angle` in **radians** |
| `pathSegment(path, start, stop)` | sub-path between two distances |

```tsx
const at = pathPointAtLength(route, pathLength(route) * progress)

<Group transform={[{ translateX: at.x }, { translateY: at.y }, { rotate: at.angle }]}>
  <Path path={arrow} color="#FF3B30" />
</Group>
```

### `PathProps`

| Prop | Notes |
| --- | --- |
| `path` | `Animated<string>` — a SharedValue gets a string slot, re-parsed on the render thread with no re-encode |
| `start`, `end` | `Animated<number>` 0..1 — trim to a fraction of the length. `end < start` draws the segment reversed. This is the line-drawing animation. |
| `fillType` | `'winding'` (default) `\| 'evenOdd'` |

### Path effects (children of `<Path>`)

```tsx
<Path path={route} style="stroke" strokeWidth={4} end={progress}>
  <DashPathEffect intervals={[10, 5]} phase={march} />
</Path>
```

- `<DashPathEffect intervals={number[]} phase={Animated<number>} />` — at least
  two intervals, and an even count. Animate `phase` to march the dashes.
- `<CornerPathEffect r={number} />` — rounds every corner before the stroke.

## Images

```tsx
const photo = useImage(require('./cat.png'))          // TgfxImage | null

photo != null && (
  <TgfxImage image={photo} x={0} y={0} width={300} height={200} fit="cover" />
)
```

| Function | Signature |
| --- | --- |
| `useImage` | `(source: number \| string) => TgfxImage \| null` |
| `useImageState` | `(source) => ImageState` `{ data, error, loading }` — the handle is `data`; `useImage` is `useImageState(source).data` |
| `loadImage` | `(source) => Promise<TgfxImage>` |
| `imageFromNativeBuffer` | `(pointer: UInt64, format: PixelFormat) => TgfxImage` — synchronous, zero-copy |
| `setImageCacheLimit` | `(bytes: number) => void`; default budget 64 MB, applied to both the decoded-pixel cache and the tgfx GPU resource cache |

SVG sources decode to a resolution-independent picture that replays at whatever
size it is drawn — `width` on one is nominal, not a resolution cap. A document
loads from a file, a `require()`'d asset, or **markup**, and draws through
`<ImageSVG>` — Skia's name for what is the same node as `<TgfxImage>`, so a
migrating `<ImageSVG svg={…}>` becomes `<ImageSVG image={…}>`:

```tsx
const icon = useImage('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')

<ImageSVG image={icon} x={0} y={0} width={96} height={96} />
```

A `require()`'d asset works in both build types. In a release Android build the
asset becomes a drawable/raw resource read natively; **two assets whose names
differ only by extension (`logo.png` beside `logo.webp`) collide as one Android
resource** — give them distinct names.

### `ImageProps`

| Prop | Notes |
| --- | --- |
| `image` | `ImageLike \| null` — `null` draws nothing. Swappable through a handle: `handle.set({ image })` patches the registry id, no re-encode. |
| `x`, `y`, `width`, `height` | destination box |
| `fit` | `Fit`: `'contain'` (default), `'cover'`, `'fill'`, `'fitWidth'`, `'fitHeight'`, `'none'`, `'scaleDown'` |
| `sampling` | `'nearest' \| 'linear'` (default) `\| 'mipmap'` — use mipmap for large images in small boxes |
| `rect` | `SrcRect` source sub-rect in image pixels — animatable, for sprite-sheet stepping |

```tsx
<TgfxImage x={0} y={0} width={60} height={60} image={sheet}
       rect={{ x: 32, y: 0, width: 32, height: 32 }} sampling="nearest" />

sprite.set({ rect: { x: frame * 32, y: 0, width: 32, height: 32 } })
```

### Derived images — native-side, reusing the decode

```ts
const thumb   = photo.scaled(200, 200, 'linear')
const sprite  = sheet.subset(0, 0, 64, 64)      // lazy crop, shares the decode
const upright = photo.oriented('rightTop')       // EXIF orientation names
const frosted = photo.blurred(20, 20)
photo.dispose()                                  // drops native pixels now, not at GC
```

`blurred` returns an image **larger than the source and centred in it** (a blur
spreads ~2σ past each edge) — offset by `(derived.width - source.width) / 2` to
line them up.

`Orientation` values: `topLeft`, `topRight`, `bottomRight`, `bottomLeft`,
`leftTop`, `rightTop`, `rightBottom`, `leftBottom` — naming where the stored
top-left pixel belongs.

`useDerivedImage(photo, derivation)` is the hook form — two arguments, no
`deps`: it memoises on `JSON.stringify(derivation)`, so an inline object literal
is safe. (`useOffscreenImage` / `useOffscreenSvg` do take a `deps` array.)

```tsx
const thumb = useDerivedImage(photo, { type: 'scaled', width: 200, height: 200 })
```

### `<ImageShader>` — an image as paint

Goes inside a `<Paint>`, or directly under a shape, the way a gradient does.

```tsx
<Circle cx={60} cy={60} r={50}>
  <ImageShader image={photo} rect={{ x: 10, y: 10, width: 100, height: 100 }} fit="cover" />
</Circle>
```

`ImageShaderProps`: `image`, `tx`/`ty` (`TileMode`: `'clamp'` default,
`'repeat'`, `'mirror'`, `'decal'`), `sampling`, `rect`, `fit`.

> **Never set `tx`/`ty` on a camera frame.** A YUV image sampled with any tile
> mode other than `clamp` comes back fully transparent.

### `PixelFormat` (native buffers)

`'rgba'`, `'bt601-limited'`, `'bt601-full'`, `'bt709-limited'`, `'bt709-full'`,
`'bt2020-limited'`, `'bt2020-full'`, `'jpeg-full'`. `'rgba'` means the buffer is
a single-plane RGBA surface, imported without a conversion.

## Video

```tsx
const video = useVideo(require('./clip.mp4'), {
  seek: 1500,      // ms; seeks again whenever this changes
  paused: false,   // plays as soon as it opens (default)
  looping: true,
  volume: 0.5,     // 0..1, defaults to 0 — a canvas video is usually decoration
})

<TgfxImage image={video.currentFrame} x={0} y={0} width={300} height={200} />
```

Requires Reanimated + Worklets — frames are pulled from a UI-thread frame
callback. `loadVideo(source)` is the promise form outside React; it resolves the
raw native player, so the caller drives `updateFrame()` and `release()` itself.

## `<Atlas>` — batched sprites

```tsx
<Atlas
  image={sheet}
  sprites={particles.map((p) => ({
    rect: { x: 0, y: 0, width: 16, height: 16 },
    x: p.x, y: p.y, scale: p.size,
  }))}
/>
```

Each `AtlasSprite` is `{ rect, x, y, scale? }`, every field animatable. `x`/`y`
is where the sprite's **centre** lands.

Sprites are placed **axis-aligned** — tgfx's `drawAtlas` maps each sprite's
bounding box, so a rotation would stretch it. Rotate a `<Group>` around the
whole batch, or use `<TgfxImage>` per sprite.

For large counts use `buffer` + `count` from `useSpriteBuffer` — see
[api-animation-imperative.md](api-animation-imperative.md).

## `<Vertices>` — meshes

```tsx
<Vertices
  vertices={[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }, { x: 200, y: 200 }]}
  colors={['#ff0000', '#00ff00', '#0000ff', '#ffff00']}
  indices={[0, 1, 2, 1, 2, 3]}
  mode="triangles"                        // 'triangles' (default) | 'triangleStrip'
/>
```

- `vertices` — positions in canvas points.
- `colors` — one per vertex, interpolated across each triangle.
- `textures` — one per vertex, in the **pixels** of the image behind an
  `<ImageShader>` on this node's paint. Without a shader they do nothing.
- `indices` — indexed meshes cap at 65536 vertices; an out-of-range index skips
  the whole mesh.

`buffer` + `vertexCount`/`indexCount` from `useVertexBuffer` is the
zero-allocation path — see [api-animation-imperative.md](api-animation-imperative.md).
