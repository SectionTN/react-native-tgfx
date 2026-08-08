import React, { type ReactNode } from 'react'
import { NitroModules } from 'react-native-nitro-modules'
import { TgfxRoot } from './reconciler/Reconciler'
import type { TgfxImage, TgfxImageFactory } from './specs/TgfxImage.nitro'

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
      throw new Error('[tgfx] renderToImage: the scene compiled to nothing')
    }
  } finally {
    // Muted first: tearing down commits an empty program that would replace the scene.
    root.container.muted = true
    root.unmount()
  }
  if (out.scene == null) {
    throw new Error('[tgfx] renderToImage: the scene compiled to nothing')
  }
  const { buffer, strings } = out.scene
  return images().fromScene(
    buffer,
    // Decoded, not the packed delta setScene takes: this program has no prior table.
    strings,
    options.width,
    options.height,
    options.pixelRatio ?? 1,
    options.opaque ?? false
  )
}
