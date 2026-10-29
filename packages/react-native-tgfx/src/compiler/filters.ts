'worklet'

import { isColorComponents, resolveColor, type Color } from './colors'
import { tileCode, type TileMode } from './image'
import { isSharedValue, resolveValue, type MaybeSharedValue } from './values'
import type { SceneWriter } from './writer'

export type BlendMode =
  | 'clear'
  | 'src'
  | 'dst'
  | 'srcOver'
  | 'dstOver'
  | 'srcIn'
  | 'dstIn'
  | 'srcOut'
  | 'dstOut'
  | 'srcATop'
  | 'dstATop'
  | 'xor'
  | 'plusLighter'
  | 'modulate'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'multiply'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plusDarker'

/**
 * Blend modes, in the order of tgfx's `BlendMode` enum - the index is what
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
] as const satisfies readonly BlendMode[]

const SRC_OVER = BLEND_MODES.indexOf('srcOver')

export function blendCode(mode: unknown): number {
  const at = BLEND_MODES.indexOf(mode as BlendMode)
  return at < 0 ? SRC_OVER : at
}

type AnimNumber = number | MaybeSharedValue<number>

/** A colour transform applied per pixel. Parameters may be value slots. */
export interface ColorFilterInput {
  kind: 'matrix' | 'blend' | 'luma' | 'alphaThreshold' | 'compose'
  matrix?: AnimNumber[]
  threshold?: AnimNumber
  color?: Color
  mode?: BlendMode
  /** `'compose'` only: `inner` runs first, then `outer` over its result. */
  inner?: ColorFilterInput
  outer?: ColorFilterInput
}

/**
 * A filter over the rasterised drawing rather than its colours. Changes bounds -
 * tgfx draws through an offscreen layer - so it costs a render target.
 */
export interface ImageFilterInput {
  kind: 'blur' | 'dropShadow' | 'compose' | 'colorFilter'
  /** `'compose'` only. Named apart from the shadow's `inner` flag below. */
  first?: ImageFilterInput
  then?: ImageFilterInput
  /** `'colorFilter'` only: a colour filter that runs *after* what precedes it. */
  colorFilter?: ColorFilterInput
  inner?: boolean
  blur?: AnimNumber
  blurX?: AnimNumber
  blurY?: AnimNumber
  tileMode?: TileMode
  dx?: AnimNumber
  dy?: AnimNumber
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
    (blendMode !== undefined &&
      (isSharedValue(blendMode) || blendCode(blendMode) !== SRC_OVER)) ||
    colorFilter != null ||
    imageFilter != null
  )
}

function writeColorFilter(
  w: SceneWriter,
  colorFilter: ColorFilterInput | undefined
): void {
  if (colorFilter == null) {
    w.push(NONE)
  } else if (colorFilter.kind === 'compose') {
    w.push(4)
    writeColorFilter(w, colorFilter.inner)
    writeColorFilter(w, colorFilter.outer)
  } else if (colorFilter.kind === 'luma') {
    w.push(2)
  } else if (colorFilter.kind === 'alphaThreshold') {
    w.push(3)
    w.pushAnim(colorFilter.threshold, 0.5)
  } else if (colorFilter.kind === 'blend') {
    // Kind 5 is kind 1 with the colour as four live channels after the word.
    const channels =
      isColorComponents(colorFilter.color) &&
      colorFilter.color.some(isSharedValue)
        ? colorFilter.color
        : null
    w.push(channels != null ? 5 : 1)
    w.push(resolveColor(resolveValue(colorFilter.color)))
    if (channels != null) {
      for (let i = 0; i < 4; i++) {
        w.pushAnim(channels[i], i === 3 ? 1 : 0)
      }
    }
    w.pushAnim(
      isSharedValue(colorFilter.mode)
        ? colorFilter.mode
        : blendCode(colorFilter.mode),
      3
    )
  } else {
    w.push(0)
    const m = colorFilter.matrix?.length === 20 ? colorFilter.matrix : IDENTITY
    for (const value of m) {
      w.pushAnim(value)
    }
  }
}

function writeImageFilter(
  w: SceneWriter,
  imageFilter: ImageFilterInput | undefined
): void {
  if (imageFilter == null) {
    w.push(NONE)
    return
  }
  if (imageFilter.kind === 'compose') {
    w.push(2)
    writeImageFilter(w, imageFilter.first)
    writeImageFilter(w, imageFilter.then)
    return
  }
  if (imageFilter.kind === 'colorFilter') {
    w.push(3)
    writeColorFilter(w, imageFilter.colorFilter)
    return
  }
  const blurX = imageFilter.blurX ?? imageFilter.blur
  const blurY = imageFilter.blurY ?? imageFilter.blur
  if (imageFilter.kind === 'dropShadow') {
    w.push(1)
    w.pushAnim(imageFilter.dx)
    w.pushAnim(imageFilter.dy)
    w.pushAnim(blurX)
    w.pushAnim(blurY)
    const liveColor =
      isColorComponents(imageFilter.color) &&
      imageFilter.color.some(isSharedValue)
    w.push(resolveColor(resolveValue(imageFilter.color)))
    // Bit 1 shadow only, bit 2 inner, bit 4 the colour follows as live channels.
    w.push(
      (imageFilter.shadowOnly === true ? 1 : 0) |
        (imageFilter.inner === true ? 2 : 0) |
        (liveColor ? 4 : 0)
    )
    if (liveColor) {
      const channels = imageFilter.color as readonly unknown[]
      for (let i = 0; i < 4; i++) {
        w.pushAnim(channels[i], i === 3 ? 1 : 0)
      }
    }
    return
  }
  w.push(0)
  w.pushAnim(blurX)
  w.pushAnim(blurY)
  w.push(tileCode(imageFilter.tileMode, 'decal'))
}

/**
 * Write the paint's filter block: blend mode, colour filter, image filter.
 * Only written when {@link hasFilters} says so - the flag bit tells the reader.
 *
 * Parameters travel through `pushAnim`, so a live one becomes a value slot. A
 * filter with no live parameter is still built once at setScene; only one that
 * actually animates is rebuilt per frame, and only that filter.
 */
export function writeFilters(
  w: SceneWriter,
  blendMode: unknown,
  colorFilter: ColorFilterInput | undefined,
  imageFilter: ImageFilterInput | undefined
): void {
  w.pushAnim(isSharedValue(blendMode) ? blendMode : blendCode(blendMode), 3)
  writeColorFilter(w, colorFilter)
  writeImageFilter(w, imageFilter)
}
