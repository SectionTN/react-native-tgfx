import { resolveColor, type Color } from './colors'
import { tileCode, type TileMode } from './image'
import { resolveNumber } from './values'
import type { SceneWriter } from './writer'

/**
 * Blend modes, in the order of tgfx's `BlendMode` enum — the index is what
 * travels on the wire, so this array must not be reordered.
 */
export const BLEND_MODES = [
  'clear',
  'src',
  'dst',
  'srcOver',
  'dstOver',
  'srcIn',
  'dstIn',
  'srcOut',
  'dstOut',
  'srcATop',
  'dstATop',
  'xor',
  'plusLighter',
  'modulate',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
  'multiply',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plusDarker',
] as const

export type BlendMode = (typeof BLEND_MODES)[number]

const SRC_OVER = BLEND_MODES.indexOf('srcOver')

export function blendCode(mode: unknown): number {
  const at = BLEND_MODES.indexOf(mode as BlendMode)
  return at < 0 ? SRC_OVER : at
}

/** A colour transform applied per pixel. Read once at commit; never animated. */
export interface ColorFilterInput {
  kind: 'matrix' | 'blend' | 'luma'
  matrix?: number[]
  color?: Color
  mode?: BlendMode
}

/**
 * A filter over the rasterised drawing rather than its colours. Changes bounds
 * — tgfx draws through an offscreen layer — so it costs a render target.
 */
export interface ImageFilterInput {
  kind: 'blur' | 'dropShadow'
  inner?: boolean
  blur?: number
  blurX?: number
  blurY?: number
  tileMode?: TileMode
  dx?: number
  dy?: number
  color?: Color
  shadowOnly?: boolean
}

const NONE = -1
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]

/** True when a paint carries anything the filter block has to encode. */
export function hasFilters(
  blendMode: unknown,
  colorFilter: unknown,
  imageFilter: unknown
): boolean {
  return (
    (blendMode !== undefined && blendCode(blendMode) !== SRC_OVER) ||
    colorFilter != null ||
    imageFilter != null
  )
}

/**
 * Write the paint's filter block: blend mode, colour filter, image filter.
 * Only written when {@link hasFilters} says so — the flag bit tells the reader.
 *
 * Every field here is a literal. Filters are built once, at setScene, and an
 * animated parameter would mean rebuilding one per frame for every filtered
 * node, which is the allocation the compile-once command list exists to avoid.
 */
export function writeFilters(
  w: SceneWriter,
  blendMode: unknown,
  colorFilter: ColorFilterInput | undefined,
  imageFilter: ImageFilterInput | undefined
): void {
  w.push(blendCode(blendMode))
  if (colorFilter == null) {
    w.push(NONE)
  } else if (colorFilter.kind === 'luma') {
    w.push(2)
  } else if (colorFilter.kind === 'blend') {
    w.push(1)
    w.push(resolveColor(colorFilter.color))
    w.push(blendCode(colorFilter.mode))
  } else {
    w.push(0)
    const m = colorFilter.matrix?.length === 20 ? colorFilter.matrix : IDENTITY
    for (const value of m) {
      w.push(resolveNumber(value))
    }
  }
  if (imageFilter == null) {
    w.push(NONE)
    return
  }
  const blurX = resolveNumber(imageFilter.blurX ?? imageFilter.blur)
  const blurY = resolveNumber(imageFilter.blurY ?? imageFilter.blur)
  if (imageFilter.kind === 'dropShadow') {
    w.push(1)
    w.push(resolveNumber(imageFilter.dx))
    w.push(resolveNumber(imageFilter.dy))
    w.push(blurX)
    w.push(blurY)
    w.push(resolveColor(imageFilter.color))
    // Bit 1 shadow only, bit 2 inside the shape instead of under it.
    w.push(
      (imageFilter.shadowOnly === true ? 1 : 0) |
        (imageFilter.inner === true ? 2 : 0)
    )
    return
  }
  w.push(0)
  w.push(blurX)
  w.push(blurY)
  w.push(tileCode(imageFilter.tileMode, 'decal'))
}
