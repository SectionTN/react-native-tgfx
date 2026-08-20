# Export — snapshots, offscreen rendering, PDF, SVG

## Snapshot a live canvas

```tsx
const canvas = useRef<CanvasHandle>(null)

const shot = await canvas.current.snapshot()              // Snapshot
await canvas.current.save('/absolute/path/out.png')       // bytes never enter JS
```

```ts
interface SnapshotOptions {
  format?: 'png' | 'jpeg' | 'webp' | 'raw'   // default 'png'
  quality?: number                            // 1–100, jpeg/webp, default 100
  rect?: { x: number; y: number; width: number; height: number }  // crop, in logical pixels
  scale?: number                              // multiplier on the cropped region's device-pixel size, default 1
}

interface Snapshot {
  data: ArrayBuffer        // encoded bytes, or straight-alpha RGBA8888 rows for 'raw'
  width: number            // logical size × device pixel ratio × scale
  height: number
  format: SnapshotFormat
}
```

Always an `ArrayBuffer`, never a base64 string. iOS wraps the encoded native
buffer without copying; Android copies the temporary JNI buffer into
Nitro-owned memory once.

The readback is issued on the render thread inside a frame it forces, and the
encode runs on a worker, so the animation loop keeps its cadence. It **rejects**
(rather than resolving a black frame) if the canvas has no surface yet or is
unmounted before the frame lands.

`scale` must be positive and finite; the ceiling is whatever target the GPU can
allocate, so a large canvas times a large scale rejects rather than resolving.

`save(path, options?)` does the same readback but encodes and writes natively —
use it for large canvases so the bytes never touch the JS heap.

## Offscreen rendering — no canvas mounted

```tsx
const image = await renderToImage(
  <Rect x={0} y={0} width={512} height={512}>
    <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 512, y: 512 }} colors={['#f0f', '#0ff']} />
  </Rect>,
  { width: 512, height: 512 }
)                                              // Promise<TgfxImage>
```

`TgfxImage.encode(format?, quality?)` returns the encoded bytes as an `ArrayBuffer`;
`TgfxImage.save(path, format?, quality?)` writes natively (bytes never enter
JS). Formats: `png` (default) / `jpeg` / `webp` / `raw` (straight-alpha RGBA).
Disposed handles and live camera/video frames reject. This closes the headless
loop: `renderToImage(scene) → image.save(path)`.

All three offscreen entry points also take `SceneNode[]` (element factories) or
a `Scene` instead of JSX — those forms never construct a reconciler, and a
`Scene`'s live handle writes are baked at their current values:

```ts
const still = await renderToImage([rect({ x: 0, y: 0, width: 40, height: 40 })], { width: 40, height: 40 })
const doc = await renderToSvg(scene, { width: 512, height: 256 })
await renderToPdf(path, [{ width: 595, height: 842, scene: pageNodes }], meta)
// PdfPage: exactly one of `element` (JSX) or `scene` per page, mixed freely.
```

```ts
interface RenderToImageOptions {
  width: number          // logical points, like a <Canvas> of the same size
  height: number
  pixelRatio?: number    // default 1 — pass the screen scale for a display-resolution render
  opaque?: boolean       // default false: uncovered area stays transparent
  colorSpace?: ColorSpace // default 'srgb' — 'display-p3' for a wide-gamut surface,
                          // carried on the result so drawing it converts rather than reinterprets
}
```

Hook form, re-run on a dependency change:

```tsx
const badge = useOffscreenImage(<Badge count={n} />, { width: 64, height: 64 }, [n])
```

All offscreen entry points render a **still**: animated props resolve to their
committed value.

## PDF

```tsx
await renderToPdf(
  `${RNFS.DocumentDirectoryPath}/report.pdf`,
  [
    { width: 612, height: 792, element: <Cover /> },        // US Letter
    { width: 595, height: 842, element: <Chart data={data} /> },  // A4
  ],
  { title: 'Quarterly report', author: 'Acme' }             // PdfMetadata
)
```

`PdfMetadata`: `title`, `author`, `subject`, `creator`. Geometry and text stay
vectors; only images rasterize.

`useOffscreenPdf(...)` is the hook form and returns a `PdfExportState`.

## SVG

```tsx
const svg = await renderToSvg(<Chart data={data} />, { width: 400, height: 300 })
```

```ts
interface RenderToSvgOptions {
  width: number          // the document's viewBox, in points
  height: number
  textAsPaths?: boolean  // write glyphs as <path> outlines instead of <text>; default false
}
```

`textAsPaths` removes the reader's font dependency at the cost of editability.
Only what needs an offscreen surface rasterizes.

`useOffscreenSvg(...)` is the hook form.

## Derived images

`useDerivedImage(image, derivation)` runs `scaled` / `subset` /
`oriented` / `blurred` natively, reusing the decoded source rather than decoding
the file again. See [api-content.md](api-content.md).
