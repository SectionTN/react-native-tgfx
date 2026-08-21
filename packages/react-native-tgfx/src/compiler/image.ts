'worklet'

import type { TgfxImage } from '../specs/TgfxImage.nitro'
import type { SharedValueLike } from './values'
import type { SceneWriter } from './writer'

/**
 * How an image is scaled into its destination rect. Same set and same
 * semantics as Skia's `fit` (which is Flutter's `BoxFit`): `cover` crops the
 * source rather than overflowing the destination.
 */
export type Fit =
  | 'fill'
  | 'contain'
  | 'cover'
  | 'fitWidth'
  | 'fitHeight'
  | 'none'
  | 'scaleDown'

/**
 * Texture filtering. `mipmap` also builds the mip chain, which is what a large
 * photo drawn into a small box needs; the filter mode alone does nothing.
 */
export type Sampling = 'nearest' | 'linear' | 'mipmap'

/** How an image shader repeats outside its bounds. */
export type TileMode = 'clamp' | 'repeat' | 'mirror' | 'decal'

export interface SrcRect {
  x: number | SharedValueLike<number>
  y: number | SharedValueLike<number>
  width: number | SharedValueLike<number>
  height: number | SharedValueLike<number>
}

// Mirrored by the Fit enum and samplingOf()/tileModeOf() in cpp/TgfxScene.cpp.
const FIT_CODE: Record<Fit, number> = {
  fill: 0,
  contain: 1,
  cover: 2,
  fitWidth: 3,
  fitHeight: 4,
  none: 5,
  scaleDown: 6,
}
const SAMPLING_CODE: Record<Sampling, number> = {
  nearest: 0,
  linear: 1,
  mipmap: 2,
}
const TILE_CODE: Record<TileMode, number> = {
  clamp: 0,
  repeat: 1,
  mirror: 2,
  decal: 3,
}

export function fitCode(fit: unknown, fallback: Fit = 'contain'): number {
  return FIT_CODE[fit as Fit] ?? FIT_CODE[fallback]
}

export function samplingCode(sampling: unknown): number {
  return SAMPLING_CODE[sampling as Sampling] ?? SAMPLING_CODE.linear
}

export function tileCode(tile: unknown, fallback: TileMode = 'clamp'): number {
  return TILE_CODE[tile as TileMode] ?? TILE_CODE[fallback]
}

// `.handle` is a JSI getter read once per image node per commit, so the id is remembered here.
const handles = new WeakMap<object, number>()

/**
 * The registry id the native engine resolves the image by, or 0 for "nothing to
 * draw". Reading `.handle` off a disposed handle throws, and a scene must not
 * fail to compile because an image went away mid-commit.
 */
export function imageHandle(image: unknown): number {
  if (image == null || typeof image !== 'object') {
    return 0
  }
  const cached = handles.get(image)
  if (cached !== undefined) {
    return cached
  }
  let handle: unknown
  try {
    handle = (image as TgfxImage).handle
  } catch {
    return 0
  }
  if (typeof handle !== 'number') {
    return 0
  }
  handles.set(image, handle)
  return handle
}

/** Write `srcFlag` and, when present, the source rect (each side animatable). */
export function writeSrcRect(w: SceneWriter, rect: unknown): void {
  const r = rect as SrcRect | undefined | null
  if (r == null) {
    w.push(0)
    return
  }
  w.push(1)
  w.pushAnim(r.x)
  w.pushAnim(r.y)
  w.pushAnim(r.width)
  w.pushAnim(r.height)
}
