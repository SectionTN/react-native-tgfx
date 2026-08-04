import { isNodeHandle, nodeInternals, type NodeHandle } from '../imperative'
import { NodeType, type Node } from '../reconciler/types'
import type { Color } from './colors'
import type { BlendMode } from './filters'
import {
  fitCode,
  imageHandle,
  samplingCode,
  writeSrcRect,
  type Fit,
  type Sampling,
  type SrcRect,
  type TileMode,
} from './image'
import {
  mergePaint,
  NO_PAINT_PROPS,
  pickPaintInput,
  writePaint,
  type GradientInput,
  type PaintInput,
} from './paint'
import { alignCode, writeFont } from './text'
import { toRadians, type Transform, type Vector } from './transform'
import {
  isSharedValue,
  resolveNumber,
  resolveValue,
  type MaybeSharedValue,
} from './values'
import { Kind, type SceneWriter } from './writer'

/** Result of compiling: the binary program plus the ordered animated values. */
export interface CompileResult {
  buffer: ArrayBuffer
  strings: string[]
  values: MaybeSharedValue<unknown>[]
  /** The handles the scene was written through, for imperative writes. */
  refs: NodeHandle[]
}

/** An accumulated opacity: a literal, or the one SharedValue still driving it. */
type Opacity = number | MaybeSharedValue<number>

interface CompileCtx {
  paint: PaintInput
  opacity: Opacity
}

let warnedFrozenOpacity = false

/** Combine opacities; one alpha slot per command, so only one can stay live. */
function mulOpacity(inherited: Opacity, own: unknown): Opacity {
  if (own === undefined) {
    return inherited
  }
  const ownLive = isSharedValue(own)
  if (!isSharedValue(inherited)) {
    if (!ownLive) {
      return inherited * resolveNumber(own, 1)
    }
    if (inherited === 1) {
      return own as MaybeSharedValue<number>
    }
  } else if (!ownLive && resolveNumber(own, 1) === 1) {
    return inherited
  }
  if (!warnedFrozenOpacity) {
    warnedFrozenOpacity = true
    console.warn(
      '[tgfx] two opacities in one chain, at least one animated: a draw command has a single alpha slot, so their product is frozen at the last commit. Animate one opacity per chain.'
    )
  }
  return resolveNumber(inherited, 1) * resolveNumber(own, 1)
}

/** Transform op codes, mirrored by the native parser. */
const Op = { translate: 0, scale: 1, rotate: 2, skewX: 3, skewY: 4 } as const

/**
 * Node type to binary kind. One lookup per node replaces a chain of string
 * comparisons; `<Paint>` and the gradient types are absent, which is what marks
 * them as "contributes paint, draws nothing".
 */
const KIND_OF: Record<string, number | undefined> = {
  [NodeType.Group]: Kind.Group,
  [NodeType.Rect]: Kind.Rect,
  [NodeType.RoundedRect]: Kind.RRect,
  [NodeType.Oval]: Kind.Oval,
  [NodeType.Circle]: Kind.Circle,
  [NodeType.Line]: Kind.Line,
  [NodeType.Path]: Kind.Path,
  [NodeType.Image]: Kind.Image,
  [NodeType.Text]: Kind.Text,
  [NodeType.TextPath]: Kind.TextPath,
  [NodeType.Fill]: Kind.Fill,
  [NodeType.CameraFrame]: Kind.CameraFrame,
}

/** `rotation` in degrees to clockwise quarter turns, 0-3. */
function quarterTurns(input: unknown): number {
  const turns = Math.round(resolveNumber(input, 0) / 90)
  return ((turns % 4) + 4) % 4
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
  if (
    node.type === NodeType.RadialGradient ||
    node.type === NodeType.DiamondGradient
  ) {
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
  if (node.type === NodeType.ImageShader) {
    return {
      kind: 'image',
      colors: [],
      image: p.image,
      tx: p.tx as TileMode | undefined,
      ty: p.ty as TileMode | undefined,
      sampling: p.sampling as Sampling | undefined,
      fit: p.fit as Fit | undefined,
      rect: p.rect as SrcRect | undefined,
    }
  }
  if (node.type === NodeType.Shader) {
    // Shader children of a <Shader> fill its `uniform shader` slots, in order.
    const children: GradientInput[] = []
    for (const child of node.children) {
      const shader = extractGradient(child)
      if (shader != null) {
        children.push(shader)
      }
    }
    return {
      kind: 'runtime',
      colors: [],
      source: String(resolveValue(p.source) ?? ''),
      uniforms: (p.uniforms as Record<string, number | number[]>) ?? {},
      children,
    }
  }
  if (
    node.type === NodeType.FractalNoise ||
    node.type === NodeType.Turbulence
  ) {
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

/** What a `<ColorMatrix>` / `<BlendColor>` / `<Blur>` / `<DropShadow>` adds. */
function extractFilter(node: Node): Partial<PaintInput> | undefined {
  const p = node.props
  switch (node.type) {
    case NodeType.ColorMatrix:
      return {
        colorFilter: { kind: 'matrix', matrix: p.matrix as number[] },
      }
    case NodeType.BlendColor:
      return {
        colorFilter: {
          kind: 'blend',
          color: p.color as Color,
          mode: p.mode as BlendMode,
        },
      }
    case NodeType.Blur:
      return {
        imageFilter: {
          kind: 'blur',
          blur: p.blur as number,
          blurX: p.blurX as number,
          blurY: p.blurY as number,
          tileMode: p.tileMode as TileMode,
        },
      }
    case NodeType.DropShadow:
      return {
        imageFilter: {
          kind: 'dropShadow',
          dx: p.dx as number,
          dy: p.dy as number,
          blur: p.blur as number,
          blurX: p.blurX as number,
          blurY: p.blurY as number,
          color: p.color as Color,
          shadowOnly: p.shadowOnly as boolean,
        },
      }
    default:
      return undefined
  }
}

/** What a paint-source child contributes, or undefined if it is not one. */
function paintFromChild(child: Node): Partial<PaintInput> | undefined {
  const gradient = extractGradient(child)
  return gradient != null ? { gradient } : extractFilter(child)
}

/** Object.assign, warning in dev when a filter overwrites one of its own class. */
function addPaintSource(
  paint: Partial<PaintInput>,
  contribution: Partial<PaintInput>
): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    for (const key of ['colorFilter', 'imageFilter'] as const) {
      if (contribution[key] != null && paint[key] != null) {
        console.warn(
          `[tgfx] two ${key === 'colorFilter' ? 'colour' : 'image'} filters on one paint; only the last one is drawn. A paint carries at most one of each class, and they do not compose.`
        )
      }
    }
  }
  Object.assign(paint, contribution)
}

/**
 * Merge a node's `<Paint>`, gradient and filter children into its own paint.
 * Returns null when it has none, which is the common case — the caller then
 * reads the node's props directly instead of allocating a merged paint per node.
 */
function paintFromChildren(node: Node): PaintInput | null {
  let paint: PaintInput | null = null
  for (const child of node.children) {
    // A drawable child never yields a paint source, so skip probing it.
    if (KIND_OF[child.type] !== undefined) {
      continue
    }
    if (child.type === NodeType.Paint) {
      const childPaint = pickPaintInput(child.props)
      for (const g of child.children) {
        const contribution = paintFromChild(g)
        if (contribution != null) {
          addPaintSource(childPaint, contribution)
        }
      }
      paint = mergePaint(paint ?? pickPaintInput(node.props), childPaint)
    } else {
      const contribution = paintFromChild(child)
      if (contribution != null) {
        paint = paint ?? pickPaintInput(node.props)
        addPaintSource(paint, contribution)
      }
    }
  }
  return paint
}

/** A group's own paint, merged with whatever its paint-bearing children add. */
function localPaint(node: Node): PaintInput {
  const paint = paintFromChildren(node) ?? pickPaintInput(node.props)
  const ownGradient = node.props.gradient as GradientInput | undefined
  if (ownGradient != null && paint.gradient == null) {
    paint.gradient = ownGradient
  }
  return paint
}

/** Write one drawing node of the given kind. */
function writeDrawing(
  w: SceneWriter,
  node: Node,
  ctx: CompileCtx,
  kind: number
): void {
  const p = node.props
  // A `<Paint>` child overrides the node's own opacity, as it does every field.
  const own = paintFromChildren(node)
  const alpha = mulOpacity(ctx.opacity, own == null ? p.opacity : own.opacity)

  w.push(kind)
  switch (kind) {
    case Kind.Rect:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      break
    case Kind.RRect: {
      const radius = p.r
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      w.pushAnim(p.rx !== undefined ? p.rx : radius)
      w.pushAnim(p.ry !== undefined ? p.ry : radius)
      break
    }
    case Kind.Oval:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      break
    case Kind.Circle:
      w.pushAnim(p.cx)
      w.pushAnim(p.cy)
      w.pushAnim(p.r)
      break
    case Kind.Line:
      w.pushAnim(p.x1)
      w.pushAnim(p.y1)
      w.pushAnim(p.x2)
      w.pushAnim(p.y2)
      break
    case Kind.Path:
      w.pushString(String(resolveValue(p.path) ?? ''))
      break
    case Kind.Image:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      // An integer, not a payload: the string table no longer scales with the
      // bytes on screen and a re-commit rehashes nothing.
      w.push(imageHandle(p.image))
      w.push(fitCode(p.fit))
      w.push(samplingCode(p.sampling))
      writeSrcRect(w, p.rect)
      break
    case Kind.Text:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushString(String(resolveValue(p.text) ?? ''))
      w.pushAnim(p.fontSize, 14)
      writeFont(w, p)
      w.push(resolveNumber(p.width, 0))
      w.push(alignCode(p.textAlign))
      w.push(resolveNumber(p.lineHeight, 0))
      w.push(resolveNumber(p.maxLines, 0))
      w.pushString(p.ellipsis != null ? String(p.ellipsis) : '')
      break
    case Kind.TextPath:
      w.pushString(String(resolveValue(p.path) ?? ''))
      w.pushString(String(resolveValue(p.text) ?? ''))
      w.pushAnim(p.fontSize, 14)
      writeFont(w, p)
      w.push(resolveNumber(p.startOffset, 0))
      break
    default:
      break
  }
  const line = kind === Kind.Line
  if (own == null) {
    writePaint(w, p, ctx.paint, alpha, line)
  } else {
    writePaint(w, NO_PAINT_PROPS, mergePaint(ctx.paint, own), alpha, line)
  }
}

function angle(w: SceneWriter, v: unknown): void {
  if (isSharedValue(v)) {
    w.pushAnim(v)
  } else {
    w.push(toRadians(v as number | string))
  }
}

/** Write a group's transform ops; returns the number written. */
function writeOps(
  w: SceneWriter,
  transform: Transform,
  origin: Vector | undefined
): number {
  let count = 0
  const shift =
    origin != null && (origin.x !== 0 || origin.y !== 0) ? origin : null
  if (shift != null) {
    w.push(Op.translate)
    w.push(shift.x)
    w.push(shift.y)
    count++
  }
  for (const op of transform) {
    const o = op as Record<string, unknown>
    if ('translateX' in o) {
      w.push(Op.translate)
      w.pushAnim(o.translateX)
      w.push(0)
    } else if ('translateY' in o) {
      w.push(Op.translate)
      w.push(0)
      w.pushAnim(o.translateY)
    } else if ('translate' in o) {
      const t = o.translate as [unknown, unknown]
      w.push(Op.translate)
      w.pushAnim(t[0])
      w.pushAnim(t[1])
    } else if ('scale' in o) {
      // One animated scale drives both axes, so it is written into both slots.
      w.push(Op.scale)
      w.pushAnim(o.scale, 1)
      w.pushAnim(o.scale, 1)
    } else if ('scaleX' in o) {
      w.push(Op.scale)
      w.pushAnim(o.scaleX, 1)
      w.push(1)
    } else if ('scaleY' in o) {
      w.push(Op.scale)
      w.push(1)
      w.pushAnim(o.scaleY, 1)
    } else if ('rotate' in o || 'rotateZ' in o) {
      w.push(Op.rotate)
      angle(w, 'rotate' in o ? o.rotate : o.rotateZ)
      w.push(0)
    } else if ('skewX' in o) {
      w.push(Op.skewX)
      angle(w, o.skewX)
      w.push(0)
    } else if ('skewY' in o) {
      w.push(Op.skewY)
      angle(w, o.skewY)
      w.push(0)
    } else {
      continue
    }
    count++
  }
  if (shift != null) {
    w.push(Op.translate)
    w.push(-shift.x)
    w.push(-shift.y)
    count++
  }
  return count
}

function writeGroup(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const local = localPaint(node)
  const childCtx: CompileCtx = {
    paint: mergePaint(ctx.paint, local),
    opacity: mulOpacity(ctx.opacity, local.opacity),
  }
  w.push(Kind.Group)
  const opCountAt = w.reserve()
  w.patch(
    opCountAt,
    writeOps(
      w,
      (node.props.transform as Transform) ?? [],
      vec(node.props.origin)
    )
  )
  const childCountAt = w.reserve()
  // writeNodes already skips everything absent from KIND_OF.
  w.patch(childCountAt, writeNodes(w, node.children, childCtx))
}

/**
 * A live camera frame plus everything drawn over it, in *frame pixels*.
 *
 * No geometry of its own: the frame covers the canvas, and the matrix that puts
 * it there is derived natively from the frame the handle currently points at —
 * which changes with no re-commit behind it, so it cannot be computed here.
 * Children ride that same matrix, which is what keeps an overlay locked to the
 * image it marks up.
 */
function writeCameraFrame(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const p = node.props
  const local = localPaint(node)
  const paint = mergePaint(ctx.paint, local)
  const alpha = mulOpacity(ctx.opacity, local.opacity)
  w.push(Kind.CameraFrame)
  w.push(imageHandle(p.image))
  w.push(fitCode(p.fit, 'cover'))
  w.push(samplingCode(p.sampling))
  w.push(quarterTurns(p.rotation))
  w.push(p.mirror === true ? 1 : 0)
  writePaint(w, NO_PAINT_PROPS, paint, alpha, false)
  const childCountAt = w.reserve()
  w.patch(childCountAt, writeNodes(w, node.children, { paint, opacity: alpha }))
}

/** Write a node list; returns how many nodes were actually written. */
function writeNodes(w: SceneWriter, nodes: Node[], ctx: CompileCtx): number {
  let count = 0
  for (let node of nodes) {
    const kind = KIND_OF[node.type]
    if (kind === undefined) {
      continue
    }
    // A `ref` is a handle onto this node: it can have written props since the
    // last commit, and they sit over the ones the element carries.
    const ref = node.props.ref
    if (isNodeHandle(ref)) {
      w.refs.push(ref)
      node = nodeInternals(ref).apply(node, w.reseed)
    }
    if (kind === Kind.Group) {
      writeGroup(w, node, ctx)
    } else if (kind === Kind.CameraFrame) {
      writeCameraFrame(w, node, ctx)
    } else {
      writeDrawing(w, node, ctx, kind)
    }
    count++
  }
  return count
}

const ROOT_CTX: CompileCtx = { paint: {}, opacity: 1 }

/**
 * Compile a list of root nodes into the binary draw program plus the ordered
 * list of SharedValues backing its animated slots. The writer is reused across
 * commits, so compiling allocates nothing beyond the occasional buffer growth.
 */
export function compileScene(
  roots: Node[],
  w: SceneWriter,
  reseed = true
): CompileResult {
  w.reset()
  w.reseed = reseed
  const countAt = w.reserve()
  w.patch(countAt, writeNodes(w, roots, ROOT_CTX))
  return {
    buffer: w.finish(),
    strings: w.strings,
    values: w.values,
    refs: w.refs,
  }
}
