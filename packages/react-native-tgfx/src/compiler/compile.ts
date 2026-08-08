import { isNodeHandle, nodeInternals, type NodeHandle } from '../imperative'
import { NodeType, type Node } from '../reconciler/types'
import { resolveColor, type Color } from './colors'
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
import { alignCode, writeFont, writeTextRuns } from './text'
import { toRadians, type Transform, type Vector } from './transform'
import {
  isSharedValue,
  resolveNumber,
  resolveValue,
  type MaybeSharedValue,
} from './values'
import { Kind, type SceneWriter } from './writer'
import type { AtlasSprite, ClipRect, UniformValue, Vector as Vec } from '../types'

interface GlyphInput {
  id: number
  x: number
  y: number
}

/** Result of compiling: the binary program plus the ordered animated values. */
export interface CompileResult {
  buffer: ArrayBuffer
  strings: string[]
  values: MaybeSharedValue<unknown>[]
  refs: NodeHandle[]
}

type Opacity = number | MaybeSharedValue<number>

interface CompileCtx {
  paint: PaintInput
  opacity: Opacity
}

let warnedFrozenOpacity = false

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

const Op = { translate: 0, scale: 1, rotate: 2, skewX: 3, skewY: 4 } as const

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
  [NodeType.Glyphs]: Kind.Glyphs,
  [NodeType.Fill]: Kind.Fill,
  [NodeType.CameraFrame]: Kind.CameraFrame,
  [NodeType.Mask]: Kind.Mask,
  [NodeType.Atlas]: Kind.Atlas,
  [NodeType.Vertices]: Kind.Vertices,
}

/**
 * N sprites, one node. The translation is pre-biased by half the scaled sprite
 * here rather than natively, so the reader stays a straight copy and `x`/`y`
 * mean the sprite's centre.
 */
function writeAtlas(w: SceneWriter, p: Record<string, unknown>): void {
  const sprites = Array.isArray(p.sprites) ? (p.sprites as AtlasSprite[]) : []
  w.push(imageHandle(p.image))
  w.push(samplingCode(p.sampling))
  w.push(sprites.length)
  for (const sprite of sprites) {
    const rect = (sprite?.rect ?? {}) as SrcRect
    const width = resolveNumber(rect.width)
    const height = resolveNumber(rect.height)
    w.push(resolveNumber(rect.x))
    w.push(resolveNumber(rect.y))
    w.push(width)
    w.push(height)
    const scale = resolveNumber(sprite?.scale, 1)
    w.push(scale)
    w.push(resolveNumber(sprite?.x) - (scale * width) / 2)
    w.push(resolveNumber(sprite?.y) - (scale * height) / 2)
  }
}

/**
 * Positions, then optional texture coordinates and colours, then optional
 * indices — each block preceded by its own count so the reader never has to
 * guess which are present.
 */
function writeVertices(w: SceneWriter, p: Record<string, unknown>): void {
  const vertices = Array.isArray(p.vertices) ? (p.vertices as Vec[]) : []
  const colors = Array.isArray(p.colors) ? (p.colors as Color[]) : undefined
  const textures = Array.isArray(p.textures) ? (p.textures as Vec[]) : undefined
  const indices = Array.isArray(p.indices) ? (p.indices as number[]) : undefined
  const count = vertices.length
  w.push(p.mode === 'triangleStrip' ? 1 : 0)
  w.push(count)
  for (const vertex of vertices) {
    w.push(resolveNumber(vertex?.x))
    w.push(resolveNumber(vertex?.y))
  }
  // A short attribute array would desync the reader: it reads one entry per vertex regardless.
  const hasTextures = textures != null && textures.length >= count
  w.push(hasTextures ? 1 : 0)
  if (hasTextures) {
    for (let i = 0; i < count; i++) {
      w.push(resolveNumber(textures[i]?.x))
      w.push(resolveNumber(textures[i]?.y))
    }
  }
  const hasColors = colors != null && colors.length >= count
  w.push(hasColors ? 1 : 0)
  if (hasColors) {
    for (let i = 0; i < count; i++) {
      w.push(resolveColor(colors[i]!))
    }
  }
  const list = indices ?? []
  w.push(list.length)
  // Hoisted: a release bundle folds it away, but a dev one would pay it per index.
  const dev = typeof __DEV__ !== 'undefined' && __DEV__
  for (let i = 0; i < list.length; i++) {
    const at = Math.trunc(resolveNumber(list[i], -1))
    if (dev && (at < 0 || at >= count)) {
      console.warn(
        `[tgfx] <Vertices indices> holds ${at}, which is outside the ${count} vertices given. The mesh is skipped.`
      )
    }
    w.push(at)
  }
}

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

function extractGradient(
  w: SceneWriter,
  node: Node
): GradientInput | undefined {
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
  if (node.type === NodeType.ColorShader) {
    return { kind: 'color', colors: [], color: p.color as Color }
  }
  if (node.type === NodeType.Blend) {
    const children: GradientInput[] = []
    for (const child of node.children) {
      const shader = extractGradient(w, child)
      if (shader != null) {
        children.push(shader)
      }
    }
    return {
      kind: 'blend',
      colors: [],
      mode: p.mode as BlendMode,
      children,
    }
  }
  if (node.type === NodeType.Shader) {
    const children: GradientInput[] = []
    for (const child of node.children) {
      const shader = extractGradient(w, child)
      if (shader != null) {
        children.push(shader)
      }
    }
    // A `ref` on a <Shader> addresses its uniforms, swapping in its own live values.
    const declared = p.uniforms as Record<string, UniformValue> | undefined
    const ref = p.ref
    let uniforms = declared ?? {}
    if (isNodeHandle(ref)) {
      w.refs.push(ref)
      uniforms = nodeInternals(ref).applyUniforms(declared, w.reseed)
    }
    return {
      kind: 'runtime',
      colors: [],
      source: String(resolveValue(p.source) ?? ''),
      uniforms,
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
    case NodeType.Luma:
      return { colorFilter: { kind: 'luma' } }
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
          inner: p.inner as boolean,
        },
      }
    default:
      return undefined
  }
}

function paintFromChild(
  w: SceneWriter,
  child: Node
): Partial<PaintInput> | undefined {
  const gradient = extractGradient(w, child)
  return gradient != null ? { gradient } : extractFilter(child)
}

/// Two filters of a class compose in declaration order: the earlier one runs first.
function addPaintSource(
  paint: Partial<PaintInput>,
  contribution: Partial<PaintInput>
): void {
  const color = contribution.colorFilter
  if (color != null && paint.colorFilter != null) {
    contribution = {
      ...contribution,
      colorFilter: { kind: 'compose', inner: paint.colorFilter, outer: color },
    }
  }
  const image = contribution.imageFilter
  if (image != null && paint.imageFilter != null) {
    contribution = {
      ...contribution,
      imageFilter: { kind: 'compose', first: paint.imageFilter, then: image },
    }
  }
  Object.assign(paint, contribution)
}

function paintFromChildren(w: SceneWriter, node: Node): PaintInput | null {
  let paint: PaintInput | null = null
  for (const child of node.children) {
    if (KIND_OF[child.type] !== undefined) {
      continue
    }
    if (child.type === NodeType.Paint) {
      const childPaint = pickPaintInput(child.props)
      for (const g of child.children) {
        const contribution = paintFromChild(w, g)
        if (contribution != null) {
          addPaintSource(childPaint, contribution)
        }
      }
      paint = mergePaint(paint ?? pickPaintInput(node.props), childPaint)
    } else {
      const contribution = paintFromChild(w, child)
      if (contribution != null) {
        paint = paint ?? pickPaintInput(node.props)
        addPaintSource(paint, contribution)
      }
    }
  }
  return paint
}

function localPaint(w: SceneWriter, node: Node): PaintInput {
  const paint = paintFromChildren(w, node) ?? pickPaintInput(node.props)
  const ownGradient = node.props.gradient as GradientInput | undefined
  if (ownGradient != null && paint.gradient == null) {
    paint.gradient = ownGradient
  }
  return paint
}

function writeDrawing(
  w: SceneWriter,
  node: Node,
  ctx: CompileCtx,
  kind: number
): void {
  const p = node.props
  const own = paintFromChildren(w, node)
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
      writePathEffects(w, node, p)
      break
    case Kind.Image:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      // An integer, not a payload: the string table no longer scales with the bytes on screen.
      w.push(imageHandle(p.image))
      w.push(fitCode(p.fit))
      w.push(samplingCode(p.sampling))
      writeSrcRect(w, p.rect)
      break
    case Kind.Atlas:
      writeAtlas(w, p)
      break
    case Kind.Vertices:
      writeVertices(w, p)
      break
    case Kind.Text:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.fontSize, 14)
      writeFont(w, p)
      writeTextRuns(w, node, p)
      w.push(resolveNumber(p.width, 0))
      w.push(alignCode(p.textAlign))
      w.push(resolveNumber(p.lineHeight, 0))
      w.push(resolveNumber(p.maxLines, 0))
      w.pushString(p.ellipsis != null ? String(p.ellipsis) : '')
      break
    case Kind.Glyphs: {
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.fontSize, 14)
      writeFont(w, p)
      const glyphs = (p.glyphs as GlyphInput[] | undefined) ?? []
      w.push(glyphs.length)
      for (const glyph of glyphs) {
        w.push(resolveNumber(glyph?.id, 0))
        w.push(resolveNumber(glyph?.x, 0))
        w.push(resolveNumber(glyph?.y, 0))
      }
      break
    }
    case Kind.TextPath:
      w.pushString(String(resolveValue(p.path) ?? ''))
      w.pushAnim(p.fontSize, 14)
      writeFont(w, p)
      writeTextRuns(w, node, p)
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

/// Flags word, then whatever each effect needs; trim and phase travel as value slots.
function writePathEffects(
  w: SceneWriter,
  node: Node,
  p: Record<string, unknown>
): void {
  let dash: Node | undefined
  let corner: Node | undefined
  for (const child of node.children) {
    if (child.type === NodeType.DashPathEffect) {
      dash = child
    } else if (child.type === NodeType.CornerPathEffect) {
      corner = child
    }
  }
  const trimmed = p.start !== undefined || p.end !== undefined
  w.push(
    (trimmed ? 1 : 0) |
      (dash != null ? 2 : 0) |
      (corner != null ? 4 : 0) |
      (p.fillType === 'evenOdd' ? 8 : 0)
  )
  if (trimmed) {
    w.pushAnim(p.start, 0)
    w.pushAnim(p.end, 1)
  }
  if (dash != null) {
    const intervals = (dash.props.intervals as number[] | undefined) ?? []
    if (typeof __DEV__ !== 'undefined' && __DEV__ && intervals.length % 2 !== 0) {
      console.warn(
        `[tgfx] <DashPathEffect intervals> needs an even count of at least two, got ${intervals.length}. The dash is skipped and the path draws solid.`
      )
    }
    w.push(intervals.length)
    for (const interval of intervals) {
      w.push(resolveNumber(interval, 0))
    }
    w.pushAnim(dash.props.phase, 0)
  }
  if (corner != null) {
    w.push(resolveNumber(corner.props.r, 0))
  }
}

function angle(w: SceneWriter, v: unknown): void {
  if (isSharedValue(v)) {
    w.pushAnim(v)
  } else {
    w.push(toRadians(v as number | string))
  }
}

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

const CLIP = { none: 0, rect: 1, rrect: 2, path: 3 } as const

/** A clip block: its kind, then the geometry that kind needs. */
function writeClip(w: SceneWriter, clip: ClipRect | string): void {
  if (typeof clip === 'string') {
    w.push(CLIP.path)
    w.pushString(clip)
    return
  }
  const rx = clip.rx !== undefined ? clip.rx : clip.r
  const ry = clip.ry !== undefined ? clip.ry : clip.r
  w.push(rx || ry ? CLIP.rrect : CLIP.rect)
  w.push(resolveNumber(clip.x))
  w.push(resolveNumber(clip.y))
  w.push(resolveNumber(clip.width))
  w.push(resolveNumber(clip.height))
  if (rx || ry) {
    w.push(resolveNumber(rx, 0))
    w.push(resolveNumber(ry, 0))
  }
}

/// A mask node: its mode, then the mask child list, then the content list.
function writeMask(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const source = node.children.find((c) => c.type === NodeType.MaskSource)
  const content = node.children.filter(
    (c) => c.type !== NodeType.MaskSource && KIND_OF[c.type] !== undefined
  )
  const local = localPaint(w, node)
  const contentCtx: CompileCtx = {
    paint: mergePaint(ctx.paint, local),
    opacity: mulOpacity(ctx.opacity, local.opacity),
  }
  w.push(Kind.Mask)
  w.push(node.props.mode === 'luminance' ? 1 : 0)
  const maskCountAt = w.reserve()
  // The mask is a matte, not part of the picture: it inherits neither paint nor opacity.
  w.patch(maskCountAt, writeNodes(w, source?.children ?? [], ROOT_CTX))
  const contentCountAt = w.reserve()
  w.patch(contentCountAt, writeNodes(w, content, contentCtx))
}

function writeGroup(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const p = node.props
  const local = localPaint(w, node)
  const clip = p.clip as ClipRect | string | undefined
  // A layer composites the subtree once, so the whole inherited alpha rides it, not the children.
  const layer = p.layer === true
  const alpha = mulOpacity(ctx.opacity, local.opacity)
  const childCtx: CompileCtx = {
    paint: mergePaint(ctx.paint, local),
    opacity: layer ? 1 : alpha,
  }
  const extended = clip != null || layer
  w.push(extended ? Kind.GroupLayer : Kind.Group)
  const opCountAt = w.reserve()
  w.patch(
    opCountAt,
    writeOps(w, (p.transform as Transform) ?? [], vec(p.origin))
  )
  if (extended) {
    w.push(
      (clip != null ? 1 : 0) |
        (p.invertClip === true ? 2 : 0) |
        (layer ? 4 : 0)
    )
    if (clip != null) {
      writeClip(w, clip)
    }
    if (layer) {
      w.pushAnim(alpha, 1)
    }
  }
  const childCountAt = w.reserve()
  w.patch(childCountAt, writeNodes(w, node.children, childCtx))
}

function writeCameraFrame(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const p = node.props
  const local = localPaint(w, node)
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

function writeNodes(w: SceneWriter, nodes: Node[], ctx: CompileCtx): number {
  let count = 0
  for (let node of nodes) {
    const kind = KIND_OF[node.type]
    if (kind === undefined) {
      continue
    }
    // A `ref` can have written props since the last commit, and they sit over the element's.
    const ref = node.props.ref
    if (isNodeHandle(ref)) {
      w.refs.push(ref)
      node = nodeInternals(ref).apply(node, w.reseed)
    }
    if (kind === Kind.Mask) {
      writeMask(w, node, ctx)
    } else if (kind === Kind.Group) {
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
