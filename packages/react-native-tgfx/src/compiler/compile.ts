import { NodeType, type Node } from '../reconciler/types'
import type { Color } from './colors'
import {
  compilePaint,
  mergePaint,
  pickPaintInput,
  type GradientInput,
  type PaintInput,
} from './paint'
import { toRadians, type Transform, type Vector } from './transform'
import {
  isSharedValue,
  num,
  resolveNumber,
  resolveValue,
  SlotAllocator,
  type MaybeSharedValue,
  type Slot,
} from './values'

/** Compiled scene wire format (mirrored by the native C++ parser). */
export interface Scene {
  v: 1
  root: CompiledNode
}

/** Result of compiling: the JSON program plus the ordered animated values. */
export interface CompileResult {
  json: string
  values: MaybeSharedValue<unknown>[]
}

type CompiledNode = Record<string, unknown> & { t: string }
type Num = number | Slot

interface CompileCtx {
  paint: PaintInput
  opacity: number
}

function vec(input: unknown): Vector | undefined {
  if (input == null) {
    return undefined
  }
  const v = input as { x?: unknown; y?: unknown }
  return { x: resolveNumber(v.x), y: resolveNumber(v.y) }
}

function extractGradient(node: Node): GradientInput | undefined {
  const p = node.props
  if (node.type === NodeType.LinearGradient) {
    return {
      kind: 'linear',
      start: vec(p.start),
      end: vec(p.end),
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as number[] | undefined,
    }
  }
  if (node.type === NodeType.RadialGradient || node.type === NodeType.DiamondGradient) {
    return {
      kind: node.type === NodeType.RadialGradient ? 'radial' : 'diamond',
      center: vec(p.center) ?? vec({ x: p.cx, y: p.cy }),
      radius: resolveNumber(p.r),
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as number[] | undefined,
    }
  }
  if (node.type === NodeType.SweepGradient) {
    return {
      kind: 'sweep',
      center: vec(p.c) ?? vec(p.center) ?? vec({ x: p.cx, y: p.cy }),
      startAngle: resolveNumber(p.start, 0),
      endAngle: resolveNumber(p.end, 360),
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as number[] | undefined,
    }
  }
  if (node.type === NodeType.Shader) {
    return {
      kind: 'runtime',
      colors: [],
      source: String(resolveValue(p.source) ?? ''),
      uniforms: (p.uniforms as Record<string, number | number[]>) ?? {},
    }
  }
  if (node.type === NodeType.FractalNoise || node.type === NodeType.Turbulence) {
    return {
      kind: node.type === NodeType.FractalNoise ? 'fractalNoise' : 'turbulence',
      colors: [],
      freqX: resolveNumber(p.freqX, 0.05),
      freqY: resolveNumber(p.freqY, 0.05),
      octaves: resolveNumber(p.octaves, 1),
      seed: resolveNumber(p.seed, 0),
    }
  }
  return undefined
}

function localPaint(node: Node): {
  paint: PaintInput
  drawingChildren: Node[]
} {
  let paint: PaintInput = pickPaintInput(node.props)
  const ownGradient = node.props.gradient as GradientInput | undefined
  if (ownGradient != null) {
    paint.gradient = ownGradient
  }
  const drawingChildren: Node[] = []
  for (const child of node.children) {
    if (child.type === NodeType.Paint) {
      const childPaint = pickPaintInput(child.props)
      for (const g of child.children) {
        const grad = extractGradient(g)
        if (grad != null) {
          childPaint.gradient = grad
        }
      }
      paint = mergePaint(paint, childPaint)
    } else {
      const grad = extractGradient(child)
      if (grad != null) {
        paint.gradient = grad
      } else {
        drawingChildren.push(child)
      }
    }
  }
  return { paint, drawingChildren }
}

function compileDrawing(
  node: Node,
  ctx: CompileCtx,
  alloc: SlotAllocator
): CompiledNode | null {
  const p = node.props
  const { paint: local } = localPaint(node)
  const cp = compilePaint(mergePaint(ctx.paint, local))

  // Final alpha = inherited group opacity * own opacity. When there is no group
  // opacity and the own opacity is animated, emit it as a live slot.
  if (ctx.opacity === 1 && isSharedValue(p.opacity)) {
    cp.a = { __s: alloc.slot(p.opacity as MaybeSharedValue<unknown>) }
  } else {
    cp.a = ctx.opacity * resolveNumber(p.opacity, 1)
  }

  const n = (v: unknown, fallback = 0): Num => num(v, alloc, fallback)

  switch (node.type) {
    case NodeType.Rect:
      return { t: 'r', x: n(p.x), y: n(p.y), w: n(p.width), h: n(p.height), p: cp }
    case NodeType.RoundedRect: {
      const hasR = p.r !== undefined
      return {
        t: 'rr',
        x: n(p.x),
        y: n(p.y),
        w: n(p.width),
        h: n(p.height),
        rx: p.rx !== undefined ? n(p.rx) : hasR ? n(p.r) : 0,
        ry: p.ry !== undefined ? n(p.ry) : hasR ? n(p.r) : 0,
        p: cp,
      }
    }
    case NodeType.Oval:
      return { t: 'o', x: n(p.x), y: n(p.y), w: n(p.width), h: n(p.height), p: cp }
    case NodeType.Circle:
      return { t: 'c', cx: n(p.cx), cy: n(p.cy), r: n(p.r), p: cp }
    case NodeType.Line:
      return {
        t: 'ln',
        x1: n(p.x1),
        y1: n(p.y1),
        x2: n(p.x2),
        y2: n(p.y2),
        p: cp,
      }
    case NodeType.Path:
      return { t: 'pa', d: String(resolveValue(p.path) ?? ''), p: cp }
    case NodeType.Image:
      return {
        t: 'im',
        x: n(p.x),
        y: n(p.y),
        w: n(p.width),
        h: n(p.height),
        src: String(resolveValue(p.image) ?? ''),
        fit: { fill: 0, contain: 1, cover: 2 }[(p.fit as string) ?? 'contain'] ?? 1,
      }
    case NodeType.Text:
      return {
        t: 'tx',
        x: n(p.x),
        y: n(p.y),
        s: String(resolveValue(p.text) ?? ''),
        fs: n(p.fontSize, 14),
        ...(p.fontFamily != null ? { ff: String(p.fontFamily) } : {}),
        p: cp,
      }
    default:
      return null
  }
}

/** Build a list of transform ops with animated values resolved to slots. */
function buildOps(
  transform: Transform,
  origin: Vector | undefined,
  alloc: SlotAllocator
): Record<string, unknown>[] {
  const ops: Record<string, unknown>[] = []
  const angle = (v: unknown): Num =>
    isSharedValue(v)
      ? { __s: alloc.slot(v as MaybeSharedValue<unknown>) }
      : toRadians(v as number | string)
  const n = (v: unknown, fallback = 0): Num => num(v, alloc, fallback)

  if (origin != null && (origin.x !== 0 || origin.y !== 0)) {
    ops.push({ t: 'translate', x: origin.x, y: origin.y })
  }
  for (const op of transform) {
    const o = op as Record<string, unknown>
    if ('translateX' in o) {
      ops.push({ t: 'translate', x: n(o.translateX), y: 0 })
    } else if ('translateY' in o) {
      ops.push({ t: 'translate', x: 0, y: n(o.translateY) })
    } else if ('translate' in o) {
      const t = o.translate as [unknown, unknown]
      ops.push({ t: 'translate', x: n(t[0]), y: n(t[1]) })
    } else if ('scale' in o) {
      const s = n(o.scale, 1)
      ops.push({ t: 'scale', x: s, y: s })
    } else if ('scaleX' in o) {
      ops.push({ t: 'scale', x: n(o.scaleX, 1), y: 1 })
    } else if ('scaleY' in o) {
      ops.push({ t: 'scale', x: 1, y: n(o.scaleY, 1) })
    } else if ('rotate' in o || 'rotateZ' in o) {
      ops.push({ t: 'rotate', r: angle('rotate' in o ? o.rotate : o.rotateZ) })
    } else if ('skewX' in o) {
      ops.push({ t: 'skewX', v: angle(o.skewX) })
    } else if ('skewY' in o) {
      ops.push({ t: 'skewY', v: angle(o.skewY) })
    }
  }
  if (origin != null && (origin.x !== 0 || origin.y !== 0)) {
    ops.push({ t: 'translate', x: -origin.x, y: -origin.y })
  }
  return ops
}

function compileGroup(
  node: Node,
  ctx: CompileCtx,
  alloc: SlotAllocator
): CompiledNode {
  const { paint: local, drawingChildren } = localPaint(node)
  const childCtx: CompileCtx = {
    paint: mergePaint(ctx.paint, local),
    opacity: ctx.opacity * resolveNumber(node.props.opacity, 1),
  }
  const transform = node.props.transform
  const origin = vec(node.props.origin)
  const out: CompiledNode = { t: 'g', ch: compileNodes(drawingChildren, childCtx, alloc) }
  const ops = buildOps((transform as Transform) ?? [], origin, alloc)
  if (ops.length > 0) {
    out.ops = ops
  }
  return out
}

function compileNodes(
  nodes: Node[],
  ctx: CompileCtx,
  alloc: SlotAllocator
): CompiledNode[] {
  const out: CompiledNode[] = []
  for (const node of nodes) {
    if (node.type === NodeType.Group) {
      out.push(compileGroup(node, ctx, alloc))
    } else if (
      node.type === NodeType.Paint ||
      node.type === NodeType.LinearGradient ||
      node.type === NodeType.RadialGradient ||
      node.type === NodeType.SweepGradient ||
      node.type === NodeType.DiamondGradient ||
      node.type === NodeType.FractalNoise ||
      node.type === NodeType.Turbulence ||
      node.type === NodeType.Shader
    ) {
      continue
    } else {
      const compiled = compileDrawing(node, ctx, alloc)
      if (compiled != null) {
        out.push(compiled)
      }
    }
  }
  return out
}

const ROOT_CTX: CompileCtx = { paint: {}, opacity: 1 }

/**
 * Compile a list of root nodes into the serialized scene JSON plus the ordered
 * list of SharedValues whose live values back the scene's `{ __s }` slots.
 */
export function compileScene(roots: Node[]): CompileResult {
  const alloc = new SlotAllocator()
  const scene: Scene = {
    v: 1,
    root: { t: 'g', ch: compileNodes(roots, ROOT_CTX, alloc) },
  }
  return { json: JSON.stringify(scene), values: alloc.values }
}
