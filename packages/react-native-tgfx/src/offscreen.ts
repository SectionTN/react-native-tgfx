// Offscreen rendering: image, SVG and PDF export with no view mounted.
// React-free: the ReactNode input form lazy-requires the reconciler adapter,
// so an imperative caller never loads react or react-reconciler.
import type { ReactNode } from 'react'
import { NitroModules } from 'react-native-nitro-modules'
import { compileScene } from './compiler/compile'
import { SceneWriter } from './compiler/writer'
import type { SceneNode } from './elements'
import { Scene } from './scene'
import type { TgfxImage, TgfxImageFactory } from './specs/TgfxImage.nitro'
import type { ColorSpace } from './types'

let factory: TgfxImageFactory | null = null
function images(): TgfxImageFactory {
  factory ??=
    NitroModules.createHybridObject<TgfxImageFactory>('TgfxImageFactory')
  return factory
}

/** What the offscreen renderers draw: factory nodes, a Scene, or JSX. */
export type SceneSource = SceneNode[] | Scene

function isSceneNodes(input: unknown): input is SceneNode[] {
  if (!Array.isArray(input)) {
    return false
  }
  if (input.length === 0) {
    return true
  }
  const first = input[0] as { type?: unknown; children?: unknown } | null
  // The children check is what tells a factory node from a JSX element: the
  // host components are literally these type strings, so `[<Rect/>]` matches
  // on type alone - but an element keeps its children in props.
  return (
    typeof first?.type === 'string' &&
    (first.type as string).startsWith('tgfx_') &&
    Array.isArray(first.children)
  )
}

function compileSource(
  input: ReactNode | SceneSource,
  what: string
): { buffer: ArrayBuffer; strings: string[] } {
  if (input instanceof Scene) {
    return input.compileForExport(what)
  }
  if (isSceneNodes(input)) {
    if (input.length === 0) {
      throw new Error(`[tgfx] ${what}: the scene compiled to nothing`)
    }
    const { buffer, strings } = compileScene(input, new SceneWriter())
    return { buffer, strings }
  }
  // Loaded only here, so the imperative path never pulls in the reconciler.
  const { compilePage } =
    require('./reconciler/compilePage') as typeof import('./reconciler/compilePage')
  return compilePage(input as ReactNode, what)
}

export interface RenderToImageOptions {
  /** Logical points, like a `<Canvas>` of the same size. */
  width: number
  height: number
  /**
   * Pixels per point. Defaults to 1, so the result is exactly `width` x
   * `height` pixels - pass the screen's scale for a display-resolution render.
   */
  pixelRatio?: number
  /** Defaults to false, which leaves everything the scene did not cover transparent. */
  opaque?: boolean
  /**
   * The offscreen surface's colour space. Defaults to `'srgb'`.
   *
   * `'display-p3'` keeps wide-gamut image and gradient content instead of
   * clamping it, exactly as the `<Canvas colorSpace>` prop does - and the
   * result carries that space, so drawing it onto a P3 canvas converts rather
   * than reinterprets. Match it to the canvas the image is headed for.
   */
  colorSpace?: ColorSpace
}

export interface RenderToSvgOptions {
  /** The document's viewBox, in points. */
  width: number
  height: number
  /**
   * Write glyphs as `<path>` outlines instead of `<text>`. Removes the reader's
   * font dependency at the cost of editability. Defaults to false.
   */
  textAsPaths?: boolean
}

/**
 * Render a scene to SVG markup, returned as a string.
 *
 * The vector counterpart to `snapshot()`: geometry and text stay resolution
 * independent, so the result opens in a design tool rather than being pixels.
 * Like the other offscreen entry points, it is a still - animated props resolve
 * to their committed value.
 *
 * Takes JSX, a `SceneNode[]` from the element factories, or a `Scene` - the
 * non-JSX forms never touch React.
 */
export async function renderToSvg(
  scene: ReactNode | SceneSource,
  options: RenderToSvgOptions
): Promise<string> {
  const { buffer, strings } = compileSource(scene, 'renderToSvg')
  return images().toSvg(
    buffer,
    strings,
    options.width,
    options.height,
    options.textAsPaths ?? false
  )
}

export interface PdfPage {
  /** Page size in points. 612 x 792 is US Letter, 595 x 842 is A4. */
  width: number
  height: number
  /** The page as JSX. Exactly one of `element` and `scene` per page. */
  element?: ReactNode
  /** The page as factory nodes or a `Scene` - no React involved. */
  scene?: SceneSource
}

export interface PdfMetadata {
  title?: string
  author?: string
  subject?: string
  creator?: string
}

/**
 * Write a scene to a PDF, one page per entry. Geometry and text stay
 * **vectors** - only images rasterize - so a chart drawn with the same
 * components that render on screen exports as a real document rather than a
 * screenshot.
 *
 * Pages may mix `element` (JSX) and `scene` (factory nodes or a `Scene`)
 * freely. Like {@link renderToImage}, each page is a still: animated props are
 * read at their committed value.
 */
export async function renderToPdf(
  path: string,
  pages: PdfPage[],
  metadata: PdfMetadata = {}
): Promise<void> {
  if (pages.length === 0) {
    throw new Error('[tgfx] renderToPdf: needs at least one page')
  }
  const buffers: ArrayBuffer[] = []
  const strings: string[] = []
  const stringCounts: number[] = []
  const sizes: number[] = []
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    if ((page.element == null) === (page.scene == null)) {
      throw new Error(
        `[tgfx] renderToPdf: page ${i} needs exactly one of element and scene`
      )
    }
    const compiled = compileSource(
      page.scene ?? page.element,
      `renderToPdf: page ${i}`
    )
    buffers.push(compiled.buffer)
    // One at a time, not spread: a text-heavy report would exceed the argument limit.
    for (const text of compiled.strings) {
      strings.push(text)
    }
    stringCounts.push(compiled.strings.length)
    sizes.push(page.width, page.height)
  }
  return images().savePdf(path, buffers, strings, stringCounts, sizes, [
    metadata.title ?? '',
    metadata.author ?? '',
    metadata.subject ?? '',
    metadata.creator ?? 'react-native-tgfx',
  ])
}

/**
 * Draw a scene to an image without mounting a `<Canvas>`.
 *
 * Takes JSX (compiled by the same reconciler a canvas uses, so function
 * components, `.map()` and context all work), a `SceneNode[]` from the element
 * factories, or a `Scene` - the non-JSX forms skip the reconciler entirely.
 * The program is rendered on an offscreen GPU surface and registered as an
 * image handle, ready for `<TgfxImage>`, `<ImageShader>`, or `save()`.
 *
 * Animated props are read once, at their committed value: there is no view to
 * drive them and the result is a still frame. A `Scene`'s live handle writes
 * are baked in at their current values.
 */
export async function renderToImage(
  scene: ReactNode | SceneSource,
  options: RenderToImageOptions
): Promise<TgfxImage> {
  const { buffer, strings } = compileSource(scene, 'renderToImage')
  return images().fromScene(
    buffer,
    // Decoded, not the packed delta setScene takes: this program has no prior table.
    strings,
    options.width,
    options.height,
    options.pixelRatio ?? 1,
    options.opaque ?? false,
    options.colorSpace ?? 'srgb'
  )
}
