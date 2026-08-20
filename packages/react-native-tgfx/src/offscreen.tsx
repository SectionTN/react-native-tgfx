import React, { type ReactNode } from 'react'
import { NitroModules } from 'react-native-nitro-modules'
import { TgfxRoot } from './reconciler/Reconciler'
import type { TgfxImage, TgfxImageFactory } from './specs/TgfxImage.nitro'
import type { ColorSpace } from './types'

let factory: TgfxImageFactory | null = null
function images(): TgfxImageFactory {
  factory ??=
    NitroModules.createHybridObject<TgfxImageFactory>('TgfxImageFactory')
  return factory
}

export interface RenderToImageOptions {
  /** Logical points, like a `<Canvas>` of the same size. */
  width: number
  height: number
  /**
   * Pixels per point. Defaults to 1, so the result is exactly `width` x
   * `height` pixels — pass the screen's scale for a display-resolution render.
   */
  pixelRatio?: number
  /** Defaults to false, which leaves everything the scene did not cover transparent. */
  opaque?: boolean
  /**
   * The offscreen surface's colour space. Defaults to `'srgb'`.
   *
   * `'display-p3'` keeps wide-gamut image and gradient content instead of
   * clamping it, exactly as the `<Canvas colorSpace>` prop does — and the
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
 * Like the other offscreen entry points, it is a still — animated props resolve
 * to their committed value.
 */
export async function renderToSvg(
  element: ReactNode,
  options: RenderToSvgOptions
): Promise<string> {
  const { buffer, strings } = compilePage(element, 'renderToSvg')
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
  element: ReactNode
}

export interface PdfMetadata {
  title?: string
  author?: string
  subject?: string
  creator?: string
}

/**
 * Write a scene to a PDF, one page per element. Geometry and text stay
 * **vectors** — only images rasterize — so a chart drawn with the same
 * components that render on screen exports as a real document rather than a
 * screenshot.
 *
 * Like {@link renderToImage}, each page is a still: animated props are read at
 * their committed value.
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
    const scene = compilePage(page.element, `renderToPdf: page ${i}`)
    buffers.push(scene.buffer)
    // One at a time, not spread: a text-heavy report would exceed the argument limit.
    for (const text of scene.strings) {
      strings.push(text)
    }
    stringCounts.push(scene.strings.length)
    sizes.push(page.width, page.height)
  }
  return images().savePdf(path, buffers, strings, stringCounts, sizes, [
    metadata.title ?? '',
    metadata.author ?? '',
    metadata.subject ?? '',
    metadata.creator ?? 'react-native-tgfx',
  ])
}

/// Shared with renderToImage: the same reconciler, the same teardown ordering.
function compilePage(
  element: ReactNode,
  what: string
): {
  buffer: ArrayBuffer
  strings: string[]
} {
  // Boxed: a `let` assigned only inside the callback narrows to `never` below.
  const out: { scene: { buffer: ArrayBuffer; strings: string[] } | null } = {
    scene: null,
  }
  const root = new TgfxRoot((buffer, strings) => {
    out.scene = { buffer, strings }
  })
  try {
    root.renderSync(<>{element}</>)
    // React swallows a throwing component, so an empty root is how that surfaces.
    if (root.container.root.length === 0) {
      throw new Error(`[tgfx] ${what}: the scene compiled to nothing`)
    }
  } finally {
    // Muted first: tearing down commits an empty program that would replace the scene.
    root.container.muted = true
    root.unmount()
  }
  if (out.scene == null) {
    throw new Error(`[tgfx] ${what}: the scene compiled to nothing`)
  }
  return out.scene
}

/**
 * Draw a scene to an image without mounting a `<Canvas>`.
 *
 * The tree is compiled by the same reconciler a canvas uses, so function
 * components, `.map()` and context all work; it is then rendered on an
 * offscreen GPU surface and registered as an image handle, ready for `<Image>`,
 * `<ImageShader>`, or `save()`.
 *
 * Animated props are read once, at their committed value: there is no view to
 * drive them and the result is a still frame.
 */
export async function renderToImage(
  element: ReactNode,
  options: RenderToImageOptions
): Promise<TgfxImage> {
  const { buffer, strings } = compilePage(element, 'renderToImage')
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
