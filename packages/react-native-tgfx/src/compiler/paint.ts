import { resolveColor, type Color } from './colors'
import { transpileShader } from './sksl'
import type { Vector } from './transform'
import { resolveNumber, resolveValue, type Slot } from './values'

/** Public paint inputs shared by every drawing component and `<Paint>`. */
export interface PaintInput {
  color?: Color
  /** `'fill'` (default) or `'stroke'`. */
  style?: 'fill' | 'stroke'
  strokeWidth?: number
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  antiAlias?: boolean
  gradient?: GradientInput
}

export interface GradientInput {
  kind: 'linear' | 'radial' | 'sweep' | 'diamond' | 'fractalNoise' | 'turbulence' | 'runtime'
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
  uniforms?: Record<string, number | number[]>
}

/** Compiled paint (the wire shape consumed by the native engine). */
export interface CompiledPaint {
  c: number
  st: 0 | 1
  sw: number
  cap: 0 | 1 | 2
  jn: 0 | 1 | 2
  aa: boolean
  /** Alpha multiplier: a literal, or a `{ __s }` slot when animated. */
  a: number | Slot
  g?: CompiledGradient
}

export type CompiledGradient =
  | { k: 0; sx: number; sy: number; ex: number; ey: number; cs: number[]; ps?: number[] }
  | { k: 1; cx: number; cy: number; r: number; cs: number[]; ps?: number[] }
  | { k: 2; cx: number; cy: number; sa: number; ea: number; cs: number[]; ps?: number[] }
  | { k: 3; cx: number; cy: number; r: number; cs: number[]; ps?: number[] }
  | { k: 4 | 5; fx: number; fy: number; oc: number; sd: number }
  | { k: 6; src: string; un: { n: string; v: number[] }[] }

const CAPS = { butt: 0, round: 1, square: 2 } as const
const JOINS = { miter: 0, round: 1, bevel: 2 } as const

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

function compileRuntime(g: GradientInput): CompiledGradient {
  const { body, uniformNames, uniformSizes } = transpileShader(g.source ?? '')
  const un = uniformNames.map((name) => {
    const raw = g.uniforms?.[name]
    const v = Array.isArray(raw) ? raw.map(Number) : raw != null ? [Number(raw)] : []
    const size = uniformSizes[name] ?? 1
    while (v.length < size) {
      v.push(0)
    }
    return { n: name, v: v.slice(0, size) }
  })
  return { k: 6, src: body, un }
}

function compileGradient(g: GradientInput): CompiledGradient {
  if (g.kind === 'runtime') {
    return compileRuntime(g)
  }
  const cs = g.colors.map((c) => resolveColor(resolveValue(c)))
  const ps = g.positions != null ? g.positions.map((p) => resolveNumber(p)) : undefined
  if (g.kind === 'fractalNoise' || g.kind === 'turbulence') {
    return {
      k: g.kind === 'fractalNoise' ? 4 : 5,
      fx: resolveNumber(g.freqX, 0.05),
      fy: resolveNumber(g.freqY, 0.05),
      oc: resolveNumber(g.octaves, 1),
      sd: resolveNumber(g.seed, 0),
    }
  }
  if (g.kind === 'sweep') {
    return {
      k: 2,
      cx: resolveNumber(g.center?.x),
      cy: resolveNumber(g.center?.y),
      sa: resolveNumber(g.startAngle, 0),
      ea: resolveNumber(g.endAngle, 360),
      cs,
      ...(ps != null ? { ps } : {}),
    }
  }
  if (g.kind === 'radial' || g.kind === 'diamond') {
    return {
      k: g.kind === 'radial' ? 1 : 3,
      cx: resolveNumber(g.center?.x),
      cy: resolveNumber(g.center?.y),
      r: resolveNumber(g.radius),
      cs,
      ...(ps != null ? { ps } : {}),
    }
  }
  return {
    k: 0,
    sx: resolveNumber(g.start?.x),
    sy: resolveNumber(g.start?.y),
    ex: resolveNumber(g.end?.x),
    ey: resolveNumber(g.end?.y),
    cs,
    ...(ps != null ? { ps } : {}),
  }
}

/** Resolve a merged paint input into the compiled wire shape. */
export function compilePaint(input: PaintInput): CompiledPaint {
  const stroke = input.style === 'stroke'
  const out: CompiledPaint = {
    c: resolveColor(resolveValue(input.color)),
    st: stroke ? 1 : 0,
    sw: resolveNumber(input.strokeWidth, 1),
    cap: CAPS[input.strokeCap ?? 'butt'],
    jn: JOINS[input.strokeJoin ?? 'miter'],
    aa: input.antiAlias !== false,
    // Alpha multiplier is threaded separately via ctx.opacity by the compiler.
    a: 1,
  }
  if (input.gradient != null) {
    out.g = compileGradient(input.gradient)
  }
  return out
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
    out.strokeWidth = resolveNumber(props.strokeWidth, 1)
  }
  if (props.strokeCap !== undefined) {
    out.strokeCap = props.strokeCap as PaintInput['strokeCap']
  }
  if (props.strokeJoin !== undefined) {
    out.strokeJoin = props.strokeJoin as PaintInput['strokeJoin']
  }
  if (props.antiAlias !== undefined) {
    out.antiAlias = Boolean(props.antiAlias)
  }
  return out
}
