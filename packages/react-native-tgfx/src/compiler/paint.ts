import { resolveColor, type Color } from './colors'
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
  kind: 'linear' | 'radial'
  start?: Vector
  end?: Vector
  center?: Vector
  radius?: number
  colors: Color[]
  positions?: number[]
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

function compileGradient(g: GradientInput): CompiledGradient {
  const cs = g.colors.map((c) => resolveColor(resolveValue(c)))
  const ps = g.positions != null ? g.positions.map((p) => resolveNumber(p)) : undefined
  if (g.kind === 'radial') {
    return {
      k: 1,
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
