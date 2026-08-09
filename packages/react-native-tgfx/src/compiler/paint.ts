import {
  colorChannels,
  isColorComponents,
  resolveColor,
  type Color,
} from './colors'
import {
  blendCode,
  hasFilters,
  writeFilters,
  type BlendMode,
  type ColorFilterInput,
  type ImageFilterInput,
} from './filters'
import {
  fitCode,
  imageHandle,
  samplingCode,
  tileCode,
  type Fit,
  type Sampling,
  type SrcRect,
  type TileMode,
} from './image'
import { transpileShader } from './sksl'
import type { UniformValue } from '../types'
import {
  isSharedValue,
  resolveNumber,
  resolveValue,
  type MaybeSharedValue,
} from './values'
import type { SceneWriter } from './writer'

/** Public paint inputs shared by every drawing component and `<Paint>`. */
export interface PaintInput {
  color?: Color
  /** A numeric shared value carries the style code from a node handle. */
  style?: 'fill' | 'stroke' | MaybeSharedValue<number>
  strokeWidth?: number | MaybeSharedValue<number>
  strokeCap?: 'butt' | 'round' | 'square' | MaybeSharedValue<number>
  strokeJoin?: 'miter' | 'round' | 'bevel' | MaybeSharedValue<number>
  strokeMiter?: number | MaybeSharedValue<number>
  opacity?: number | MaybeSharedValue<number>
  antiAlias?: boolean | MaybeSharedValue<number>
  blendMode?: BlendMode | MaybeSharedValue<number>
  gradient?: GradientInput
  colorFilter?: ColorFilterInput
  imageFilter?: ImageFilterInput
}

export interface GradientInput {
  kind:
    | 'linear'
    | 'radial'
    | 'sweep'
    | 'diamond'
    | 'fractalNoise'
    | 'turbulence'
    | 'runtime'
    | 'image'
    | 'blend'
    | 'color'
  image?: unknown
  tx?: TileMode
  ty?: TileMode
  sampling?: Sampling
  fit?: Fit
  rect?: SrcRect
  start?: AnimVector
  end?: AnimVector
  center?: AnimVector
  radius?: number | MaybeSharedValue<number>
  colors: Color[]
  positions?: (number | MaybeSharedValue<number>)[]
  startAngle?: number | MaybeSharedValue<number>
  endAngle?: number | MaybeSharedValue<number>
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
  source?: string
  uniforms?: Record<string, UniformValue>
  children?: GradientInput[]
  /** `<Blend>` only: how its children fold together. */
  mode?: BlendMode | MaybeSharedValue<number>
  /** `<ColorShader>` only. */
  color?: Color
}

/** A point whose axes may each be live. */
export interface AnimVector {
  x?: number | MaybeSharedValue<number>
  y?: number | MaybeSharedValue<number>
}

export const CAPS = { butt: 0, round: 1, square: 2 } as const
export const JOINS = { miter: 0, round: 1, bevel: 2 } as const
export const STYLES = { fill: 0, stroke: 1 } as const

const SHADER_KIND = {
  linear: 0,
  radial: 1,
  sweep: 2,
  diamond: 3,
  fractalNoise: 4,
  turbulence: 5,
  runtime: 6,
  image: 7,
  blend: 8,
  color: 9,
} as const

const NO_SHADER = -1

/** Merge two paint inputs; defined fields in `over` win. */
export function mergePaint(
  base: PaintInput | undefined,
  over: PaintInput | undefined
): PaintInput {
  if (base == null) {
    return over ?? {}
  }
  if (over == null) {
    return base
  }
  const out: PaintInput = { ...base }
  for (const key of Object.keys(over) as (keyof PaintInput)[]) {
    const v = over[key]
    if (v !== undefined) {
      // @ts-expect-error index assignment across the union is safe here.
      out[key] = v
    }
  }
  return out
}

/** True when the value itself, or any element of it, is a SharedValue. */
function anyShared(list: readonly unknown[] | undefined): boolean {
  if (list == null) {
    return false
  }
  for (const entry of list) {
    if (isSharedValue(entry)) {
      return true
    }
    if (Array.isArray(entry) && entry.some(isSharedValue)) {
      return true
    }
  }
  return false
}

/**
 * A flags word, then the stops. Bit 1: each colour travels as four animated
 * channels instead of one packed word. Positions are animatable either way —
 * they are single words, so a slot costs nothing when unused.
 */
function writeStops(w: SceneWriter, g: GradientInput): void {
  const liveColors = anyShared(g.colors)
  w.push(liveColors ? 1 : 0)
  w.push(g.colors.length)
  for (const color of g.colors) {
    if (liveColors) {
      const channels = isColorComponents(color)
        ? color
        : colorChannels(resolveColor(resolveValue(color)))
      for (let i = 0; i < 4; i++) {
        w.pushAnim(channels[i], i === 3 ? 1 : 0)
      }
    } else {
      w.push(resolveColor(resolveValue(color)))
    }
  }
  const positions = g.positions
  w.push(positions?.length ?? 0)
  for (const position of positions ?? []) {
    w.pushAnim(position)
  }
}

function writeGradient(w: SceneWriter, g: GradientInput): void {
  w.push(SHADER_KIND[g.kind])
  switch (g.kind) {
    case 'color':
      w.push(resolveColor(resolveValue(g.color)))
      return
    case 'blend': {
      const children = g.children ?? []
      // The fold's mode word is not an anim word; a handle write lands here
      // as a numeric shared value, resolved to its code per re-encode.
      const mode = resolveValue(g.mode as unknown)
      w.push(typeof mode === 'number' ? mode : blendCode(mode))
      w.push(children.length)
      for (const child of children) {
        writeGradient(w, child)
      }
      return
    }
    case 'image': {
      w.pushAnim(isSharedValue(g.image) ? g.image : imageHandle(g.image))
      w.push(tileCode(g.tx))
      w.push(tileCode(g.ty))
      w.push(samplingCode(g.sampling))
      if (g.rect == null) {
        w.push(0)
        return
      }
      w.push(1)
      w.push(resolveNumber(g.rect.x))
      w.push(resolveNumber(g.rect.y))
      w.push(resolveNumber(g.rect.width))
      w.push(resolveNumber(g.rect.height))
      w.push(fitCode(g.fit))
      return
    }
    case 'runtime': {
      const {
        body,
        preamble,
        functionNames,
        uniformNames,
        uniformSizes,
        childNames,
      } = transpileShader(g.source ?? '')
      const children = g.children ?? []
      // A missing child leaves `TGFX_CHILD_n` bound to nothing and the node silently unpainted.
      if (children.length !== childNames.length) {
        throw new Error(
          `[tgfx] shader: the source declares ${
            childNames.length
          } 'uniform shader' (${childNames.join(', ') || 'none'}) but ${
            children.length
          } shader ${
            children.length === 1 ? 'child was' : 'children were'
          } given — pass one shader child per declaration, in order`
        )
      }
      w.pushString(body)
      w.pushString(preamble)
      w.push(functionNames.length)
      for (const name of functionNames) {
        w.pushString(name)
      }
      w.push(uniformNames.length)
      for (const name of uniformNames) {
        const raw = g.uniforms?.[name]
        const values = Array.isArray(raw) ? raw : raw != null ? [raw] : []
        const size = uniformSizes[name] ?? 1
        w.pushString(name)
        w.push(size)
        for (let i = 0; i < size; i++) {
          w.pushAnim(values[i] ?? 0)
        }
      }
      w.push(children.length)
      for (const child of children) {
        writeGradient(w, child)
      }
      return
    }
    case 'fractalNoise':
    case 'turbulence':
      w.push(resolveNumber(g.freqX, 0.05))
      w.push(resolveNumber(g.freqY, 0.05))
      w.push(resolveNumber(g.octaves, 1))
      w.push(resolveNumber(g.seed, 0))
      return
    case 'sweep':
      w.pushAnim(g.center?.x)
      w.pushAnim(g.center?.y)
      w.pushAnim(g.startAngle, 0)
      w.pushAnim(g.endAngle, 360)
      writeStops(w, g)
      return
    case 'radial':
    case 'diamond':
      w.pushAnim(g.center?.x)
      w.pushAnim(g.center?.y)
      w.pushAnim(g.radius)
      writeStops(w, g)
      return
    default:
      w.pushAnim(g.start?.x)
      w.pushAnim(g.start?.y)
      w.pushAnim(g.end?.x)
      w.pushAnim(g.end?.y)
      writeStops(w, g)
  }
}

/** Props with no paint fields, for callers that only have an inherited paint. */
export const NO_PAINT_PROPS: Record<string, unknown> = {}

/**
 * Write a node's paint into the program: color, flags, stroke geometry, the
 * alpha multiplier (a live slot when the node's own opacity is animated), and
 * an optional shader.
 *
 * Fields are read straight off the node's props, falling back to the inherited
 * paint — the same precedence {@link mergePaint} gives, without building a
 * merged object per node. Only the rare node that carries `<Paint>` or gradient
 * children merges eagerly and passes the result as `inherited`.
 *
 * `forceStroke` is for `<Line>`, which has no interior to fill: the engine draws
 * the compiled paint as-is, so the style has to be settled here.
 */
export function writePaint(
  w: SceneWriter,
  props: Record<string, unknown>,
  inherited: PaintInput,
  alpha: number | unknown,
  forceStroke = false
): void {
  const color = props.color !== undefined ? props.color : inherited.color
  const style = props.style !== undefined ? props.style : inherited.style
  const strokeWidth =
    props.strokeWidth !== undefined ? props.strokeWidth : inherited.strokeWidth
  const cap =
    props.strokeCap !== undefined ? props.strokeCap : inherited.strokeCap
  const join =
    props.strokeJoin !== undefined ? props.strokeJoin : inherited.strokeJoin
  const miter =
    props.strokeMiter !== undefined ? props.strokeMiter : inherited.strokeMiter
  const antiAlias =
    props.antiAlias !== undefined ? props.antiAlias : inherited.antiAlias
  const gradient =
    props.gradient !== undefined ? props.gradient : inherited.gradient
  const blendMode =
    props.blendMode !== undefined ? props.blendMode : inherited.blendMode
  // Filters only reach a paint through its children, so `inherited` is their only source.
  const { colorFilter, imageFilter } = inherited
  const filtered = hasFilters(blendMode, colorFilter, imageFilter)

  // Four live channels only when one moves; a literal `[r, g, b, a]` packs into the word below.
  const channels =
    isColorComponents(color) && color.some(isSharedValue) ? color : null
  // Style and antiAlias are flag bits, so a live one needs its own word. A live
  // style must hold the numeric code — a string cannot ride the value array.
  const styleNow = resolveValue(style)
  const aaNow = resolveValue(antiAlias)
  const liveStyle =
    !forceStroke && isSharedValue(style) && typeof styleNow === 'number'
  const liveAA = isSharedValue(antiAlias)
  w.push(resolveColor(resolveValue(color as Color | undefined)))
  w.push(
    (forceStroke || styleNow === 'stroke' || styleNow === 1 ? 1 : 0) |
      (aaNow !== false && aaNow !== 0 ? 2 : 0) |
      (filtered ? 4 : 0) |
      (channels != null ? 8 : 0) |
      (miter !== undefined ? 16 : 0) |
      (liveStyle || liveAA ? 32 : 0)
  )
  if (liveStyle || liveAA) {
    w.pushAnim(
      liveStyle ? style : forceStroke || styleNow === 'stroke' ? 1 : 0
    )
    w.pushAnim(liveAA ? antiAlias : aaNow !== false ? 1 : 0)
  }
  if (channels != null) {
    for (let i = 0; i < 4; i++) {
      w.pushAnim(channels[i], i === 3 ? 1 : 0)
    }
  }
  w.pushAnim(strokeWidth, 1)
  w.pushAnim(
    isSharedValue(cap) ? cap : CAPS[(cap as keyof typeof CAPS) ?? 'butt']
  )
  w.pushAnim(
    isSharedValue(join)
      ? join
      : JOINS[(join as keyof typeof JOINS) ?? 'miter']
  )
  if (miter !== undefined) {
    w.pushAnim(miter, 4)
  }
  w.pushAnim(alpha, 1)
  if (filtered) {
    writeFilters(w, blendMode, colorFilter, imageFilter)
  }
  if (gradient == null) {
    w.push(NO_SHADER)
    return
  }
  writeGradient(w, gradient as GradientInput)
}

/** Extract only the paint-related fields from an arbitrary props object. */
export function pickPaintInput(props: Record<string, unknown>): PaintInput {
  const out: PaintInput = {}
  if (props.color !== undefined) {
    out.color = resolveValue(props.color) as Color
  }
  if (props.style !== undefined) {
    out.style = props.style as PaintInput['style']
  }
  if (props.strokeWidth !== undefined) {
    out.strokeWidth = props.strokeWidth as PaintInput['strokeWidth']
  }
  if (props.strokeCap !== undefined) {
    out.strokeCap = props.strokeCap as PaintInput['strokeCap']
  }
  if (props.strokeJoin !== undefined) {
    out.strokeJoin = props.strokeJoin as PaintInput['strokeJoin']
  }
  if (props.strokeMiter !== undefined) {
    out.strokeMiter = props.strokeMiter as number
  }
  if (props.opacity !== undefined) {
    out.opacity = props.opacity as PaintInput['opacity']
  }
  if (props.antiAlias !== undefined) {
    out.antiAlias = Boolean(props.antiAlias)
  }
  if (props.blendMode !== undefined) {
    out.blendMode = props.blendMode as BlendMode
  }
  return out
}
