import { resolveColor, type Color } from './colors'
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
import type { Vector } from './transform'
import { resolveNumber, resolveValue, type MaybeSharedValue } from './values'
import type { SceneWriter } from './writer'

/** Public paint inputs shared by every drawing component and `<Paint>`. */
export interface PaintInput {
  color?: Color
  /** `'fill'` (default) or `'stroke'`. */
  style?: 'fill' | 'stroke'
  strokeWidth?: number | MaybeSharedValue<number>
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  /** Kept unresolved so an animated opacity can stay a live alpha slot. */
  opacity?: number | MaybeSharedValue<number>
  antiAlias?: boolean
  gradient?: GradientInput
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
  /** Image shader: the native handle plus how it tiles and fits. */
  image?: unknown
  tx?: TileMode
  ty?: TileMode
  sampling?: Sampling
  fit?: Fit
  rect?: SrcRect
  start?: Vector
  end?: Vector
  center?: Vector
  radius?: number
  colors: Color[]
  positions?: number[]
  /** Sweep gradient angular range, in degrees (same convention as Skia). */
  startAngle?: number
  endAngle?: number
  /** Perlin noise parameters. */
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
  /** Runtime shader source (SkSL subset) and its uniform values. */
  source?: string
  uniforms?: Record<string, UniformValue>
}

const CAPS = { butt: 0, round: 1, square: 2 } as const
const JOINS = { miter: 0, round: 1, bevel: 2 } as const

const SHADER_KIND = {
  linear: 0,
  radial: 1,
  sweep: 2,
  diamond: 3,
  fractalNoise: 4,
  turbulence: 5,
  runtime: 6,
  image: 7,
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

function writeStops(w: SceneWriter, g: GradientInput): void {
  w.push(g.colors.length)
  for (const color of g.colors) {
    w.push(resolveColor(resolveValue(color)))
  }
  const positions = g.positions
  w.push(positions?.length ?? 0)
  for (const position of positions ?? []) {
    w.push(resolveNumber(position))
  }
}

function writeGradient(w: SceneWriter, g: GradientInput): void {
  w.push(SHADER_KIND[g.kind])
  switch (g.kind) {
    case 'image': {
      w.push(imageHandle(g.image))
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
      const { body, uniformNames, uniformSizes, childNames } = transpileShader(
        g.source ?? ''
      )
      // The body would carry a `TGFX_CHILD_n` call that no native code declares,
      // so the GLSL would fail to compile on device. Fail loudly here instead.
      if (childNames.length > 0) {
        throw new Error(
          `[tgfx] shader: 'uniform shader ${childNames[0]}' is not supported yet — there is no native child processor to bind it to`
        )
      }
      w.pushString(body)
      w.push(uniformNames.length)
      for (const name of uniformNames) {
        const raw = g.uniforms?.[name]
        // Left unresolved: pushAnim turns a SharedValue element into a slot the
        // engine patches on the UI thread, so an animated uniform costs no JS.
        const values = Array.isArray(raw) ? raw : raw != null ? [raw] : []
        const size = uniformSizes[name] ?? 1
        w.pushString(name)
        w.push(size)
        for (let i = 0; i < size; i++) {
          w.pushAnim(values[i] ?? 0)
        }
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
      w.push(resolveNumber(g.center?.x))
      w.push(resolveNumber(g.center?.y))
      w.push(resolveNumber(g.startAngle, 0))
      w.push(resolveNumber(g.endAngle, 360))
      writeStops(w, g)
      return
    case 'radial':
    case 'diamond':
      w.push(resolveNumber(g.center?.x))
      w.push(resolveNumber(g.center?.y))
      w.push(resolveNumber(g.radius))
      writeStops(w, g)
      return
    default:
      w.push(resolveNumber(g.start?.x))
      w.push(resolveNumber(g.start?.y))
      w.push(resolveNumber(g.end?.x))
      w.push(resolveNumber(g.end?.y))
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
  const antiAlias =
    props.antiAlias !== undefined ? props.antiAlias : inherited.antiAlias
  const gradient =
    props.gradient !== undefined ? props.gradient : inherited.gradient

  w.push(resolveColor(resolveValue(color as Color | undefined)))
  w.push(
    (forceStroke || style === 'stroke' ? 1 : 0) | (antiAlias !== false ? 2 : 0)
  )
  w.pushAnim(strokeWidth, 1)
  w.push(CAPS[(cap as PaintInput['strokeCap']) ?? 'butt'])
  w.push(JOINS[(join as PaintInput['strokeJoin']) ?? 'miter'])
  w.pushAnim(alpha, 1)
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
  if (props.opacity !== undefined) {
    out.opacity = props.opacity as PaintInput['opacity']
  }
  if (props.antiAlias !== undefined) {
    out.antiAlias = Boolean(props.antiAlias)
  }
  return out
}
