import type { HybridObject, UInt64 } from 'react-native-nitro-modules'

/**
 * How a hardware buffer's YUV planes map to RGB. `rgba` means the buffer is not
 * YUV at all — a single-plane RGBA surface, imported without a conversion.
 *
 * Camera frames are `bt601-limited`.
 */
export type PixelFormat =
  | 'rgba'
  | 'bt601-limited'
  | 'bt601-full'
  | 'bt709-limited'
  | 'bt709-full'
  | 'bt2020-limited'
  | 'bt2020-full'
  | 'jpeg-full'

/** How a scaled image is resampled. Same values as the drawing-side `Sampling`. */
export type ImageSampling = 'nearest' | 'linear' | 'mipmap'

/** Where the stored top-left pixel belongs, matching EXIF's orientation tag. */
export type Orientation =
  | 'topLeft'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'leftTop'
  | 'rightTop'
  | 'rightBottom'
  | 'leftBottom'

/**
 * A decoded image living in native memory.
 *
 * The draw program carries {@link handle} — a small integer — so the scene's
 * string table stops scaling with image bytes and a re-commit costs no hashing
 * and no decode. Bytes never travel as base64.
 */
export interface TgfxImage extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /** Registry id written into the draw program. 0 once disposed. */
  readonly handle: number
  readonly width: number
  readonly height: number

  /**
   * Point this handle at a different hardware buffer, keeping its id.
   *
   * This is the per-frame path: the scene keeps referencing the same handle, so
   * a new frame costs no scene re-commit and no allocation, and a frame the
   * renderer has not drawn yet is *superseded* by the next rather than queued
   * behind it. Zero-copy, like {@link TgfxImageFactory.fromNativeBuffer}.
   *
   * The handle takes a reference to the new buffer and drops the previous one
   * before returning, so a producer recycling a fixed pool gets its slot back
   * on the swap. Until then, the buffer's *contents* must stay unchanged, not
   * just its reference count: tgfx samples it directly (`Image::MakeFrom`,
   * cpp/third_party/tgfx/include/tgfx/core/Image.h). Write into a slot only
   * after it has been swapped out.
   *
   * Only valid on a handle created from a native buffer.
   */
  setNativeBuffer(buffer: UInt64, format: PixelFormat): void

  /**
   * A crop of this image, sharing its decode. Lazy: no pixels are copied and no
   * bytes are charged, so a sprite sheet cut into handles costs one decode.
   */
  subset(x: number, y: number, width: number, height: number): TgfxImage

  /**
   * A resampled copy at `width` x `height`. The memory fix for photo grids: a
   * 12 MP source drawn at 200x200 otherwise holds full-resolution pixels in
   * both the decode budget and texture memory.
   */
  scaled(width: number, height: number, sampling?: ImageSampling): TgfxImage

  /**
   * Rotated or flipped by an EXIF-style orientation. `'topLeft'` is the
   * identity; the rest name where the stored top-left pixel belongs.
   */
  oriented(orientation: Orientation): TgfxImage

  /**
   * This image with a Gaussian blur baked in, so a frosted backdrop is filtered
   * once rather than every frame.
   *
   * The result is **larger than the source and centred in it** — a blur spreads
   * about two sigma past each edge — so drawing it at the source's position
   * shifts the content. Offset by `(derived.width - source.width) / 2` to line
   * the two up.
   */
  blurred(blurX: number, blurY: number): TgfxImage

  // `dispose()` comes from HybridObject and is overridden natively: it drops
  // the native image now instead of at the next GC. A scene still holding the
  // handle simply stops drawing it.
}

/**
 * Creates {@link TgfxImage} handles. Every method decodes on a background
 * thread and resolves once the pixels are ready, so no frame ever blocks on a
 * decode.
 */
export interface TgfxImageFactory extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * A local file path or `file://` URI. The bytes never reach JS.
   *
   * PNG/JPEG/WebP stay on disk and are re-read after an eviction. An `.svg` is
   * read once and parsed into a picture that replays at whatever size it is
   * drawn, so {@link TgfxImage.width} on one is nominal, not a resolution cap.
   */
  fromFile(path: string): Promise<TgfxImage>

  /**
   * Encoded (PNG/JPEG/WebP) bytes or an SVG document, zero-copy across the Nitro
   * boundary. Which one it is comes from the bytes, not from a file extension.
   */
  fromBytes(bytes: ArrayBuffer): Promise<TgfxImage>

  /** Base64-encoded bytes, for `data:` URIs and raw base64 sources. */
  fromBase64(data: string): Promise<TgfxImage>

  /**
   * Wrap a platform hardware buffer — an `AHardwareBuffer*` on Android, a
   * `CVPixelBufferRef` on iOS — as a GPU-resident handle. Pass
   * `frame.getNativeBuffer().pointer`.
   *
   * Zero-copy and synchronous: there is nothing to decode, so the buffer is
   * imported straight to a texture and there is no promise to await on a
   * 16 ms budget. The returned handle retains the buffer, so the caller may
   * release its own reference as soon as this returns — but must not write into
   * the buffer while the handle still points at it: tgfx requires the contents
   * to stay unchanged for the image's lifetime
   * (cpp/third_party/tgfx/include/tgfx/core/Image.h).
   *
   * Such a handle is *not* accounted against the decoded-pixel budget: a frame
   * arriving every 16 ms is not a long-lived asset, and its memory belongs to
   * whoever produced the buffer.
   */
  fromNativeBuffer(buffer: UInt64, format: PixelFormat): TgfxImage

  /**
   * Render one or more compiled draw programs into a PDF at `path`. Geometry
   * and text stay vectors; only images rasterize.
   *
   * The arrays run in parallel, one entry per page, because Nitro has no
   * nested-array type: `pages[i]` is that page's program, `stringCounts[i]` how
   * many of the concatenated `strings` belong to it, and `sizes[i * 2]` and
   * `sizes[i * 2 + 1]` its width and height. `metadata` is title, author,
   * subject, creator.
   */
  savePdf(
    path: string,
    pages: ArrayBuffer[],
    strings: string[],
    stringCounts: number[],
    sizes: number[],
    metadata: string[]
  ): Promise<void>

  /**
   * Render a compiled draw program to an offscreen GPU surface and register the
   * result as an image. No `<Canvas>` need be mounted: the surface belongs to no
   * view, so the pixels are read back to the CPU and re-uploaded wherever they
   * are drawn.
   */
  fromScene(
    words: ArrayBuffer,
    strings: string[],
    width: number,
    height: number,
    pixelRatio: number,
    opaque: boolean
  ): Promise<TgfxImage>

  /**
   * Byte budget for decoded images. A decoded image is resident twice — as CPU
   * pixels here and as the GPU texture uploaded from them — so this number is
   * applied to both the pixel cache and the tgfx context's resource cache
   * rather than to only one of them. Defaults to 64 MB.
   */
  setCacheLimit(bytes: number): void

  /** Bytes currently held by decoded pixel buffers. */
  readonly cachedBytes: number
}
