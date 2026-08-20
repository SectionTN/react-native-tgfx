import { isNodeHandle, nodeInternals, type NodeHandle } from '../imperative'
import { NodeType, type Node } from '../reconciler/types'
import { isColorComponents, resolveColor, type Color } from './colors'
import {
  blendCode,
  type BlendMode,
  type ColorFilterInput,
  type ImageFilterInput,
} from './filters'
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
  type AnimVector,
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
import type {
  AtlasSprite,
  ClipRect,
  UniformValue,
  Vector as Vec,
} from '../types'

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
  stringValues: MaybeSharedValue<string>[]
  refs: NodeHandle[]
  refPaths: { path: number[]; ref: NodeHandle }[]
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

/** Bit 64 on the kind word: a visibility word follows. Absent costs nothing. */
const KIND_VISIBLE = 64

/**
 * The node's kind word, plus its `visible` word when the prop is present. A
 * hidden node is skipped at draw *and* hit-test, which is what makes a
 * mounted-but-idle pool node free.
 */
function pushKind(
  w: SceneWriter,
  kind: number,
  p: Record<string, unknown>
): void {
  const visible = p.visible
  if (visible === undefined) {
    w.push(kind)
    return
  }
  w.push(kind | KIND_VISIBLE)
  w.pushAnim(
    isSharedValue(visible)
      ? visible
      : visible === false
        ? 0
        : visible === true
          ? 1
          : visible,
    1
  )
}

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
  [NodeType.Backdrop]: Kind.Backdrop,
  [NodeType.Glass]: Kind.Backdrop,
}

/** A shared-buffer attachment from `useSpriteBuffer` / `useVertexBuffer`. */
interface BufferLike {
  id: number
  capacity?: number
  maxVertices?: number
  maxIndices?: number
  hasTextures?: boolean
  hasColors?: boolean
}

function bufferOf(value: unknown): BufferLike | null {
  // id 0 is "no native module": fall back to the inline stream.
  return value != null &&
    typeof value === 'object' &&
    typeof (value as BufferLike).id === 'number' &&
    (value as BufferLike).id > 0
    ? (value as BufferLike)
    : null
}

/**
 * N sprites, one node. `x`/`y` mean the sprite's centre; the reader applies the
 * half-sprite bias, so a live scale or size stays correct. A shared buffer
 * replaces the inline list entirely: seven floats per sprite, read at draw.
 */
function writeAtlas(w: SceneWriter, p: Record<string, unknown>): void {
  w.pushAnim(isSharedValue(p.image) ? p.image : imageHandle(p.image))
  w.push(samplingCode(p.sampling))
  const buffer = bufferOf(p.buffer)
  if (buffer != null) {
    w.push(buffer.id)
    w.pushAnim(p.count ?? buffer.capacity ?? 0)
    return
  }
  w.push(0)
  const sprites = Array.isArray(p.sprites) ? (p.sprites as AtlasSprite[]) : []
  w.push(sprites.length)
  for (const sprite of sprites) {
    const rect = (sprite?.rect ?? {}) as SrcRect
    w.pushAnim(rect.x)
    w.pushAnim(rect.y)
    w.pushAnim(rect.width)
    w.pushAnim(rect.height)
    w.pushAnim(sprite?.scale, 1)
    w.pushAnim(sprite?.x)
    w.pushAnim(sprite?.y)
  }
}

/**
 * A leading buffer id, then either the shared-buffer header (topology, section
 * capacities, live counts) or the inline stream: positions, then optional
 * texture coordinates and colours, then optional indices — each block preceded
 * by its own count so the reader never has to guess which are present.
 */
function writeVertices(w: SceneWriter, p: Record<string, unknown>): void {
  const buffer = bufferOf(p.buffer)
  if (buffer != null) {
    w.push(buffer.id)
    w.push(p.mode === 'triangleStrip' ? 1 : 0)
    w.push(buffer.maxVertices ?? 0)
    w.push(buffer.maxIndices ?? 0)
    w.push((buffer.hasTextures ? 1 : 0) | (buffer.hasColors ? 2 : 0))
    w.pushAnim(p.vertexCount ?? buffer.maxVertices ?? 0)
    w.pushAnim(p.indexCount ?? buffer.maxIndices ?? 0)
    return
  }
  w.push(0)
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

/** Like {@link vec}, but keeps a SharedValue axis live for the anim writer. */
function animVec(input: unknown): AnimVector | undefined {
  if (input == null) {
    return undefined
  }
  const v = input as { x?: unknown; y?: unknown }
  return {
    x: v.x as AnimVector['x'],
    y: v.y as AnimVector['y'],
  }
}

/** Route a `ref` on a gradient or filter node through its handle's overrides. */
function applyRef(w: SceneWriter, node: Node): Node {
  const ref = node.props.ref
  if (!isNodeHandle(ref)) {
    return node
  }
  w.refs.push(ref)
  return nodeInternals(ref).apply(node, w.reseed)
}

function extractGradient(
  w: SceneWriter,
  node: Node
): GradientInput | undefined {
  if (node.type !== NodeType.Shader) {
    node = applyRef(w, node)
  }
  const p = node.props
  if (node.type === NodeType.LinearGradient) {
    return {
      kind: 'linear',
      start: animVec(p.start),
      end: animVec(p.end),
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as GradientInput['positions'],
    }
  }
  if (
    node.type === NodeType.RadialGradient ||
    node.type === NodeType.DiamondGradient
  ) {
    return {
      kind: node.type === NodeType.RadialGradient ? 'radial' : 'diamond',
      center: animVec(p.center) ?? animVec({ x: p.cx, y: p.cy }),
      radius: p.r as GradientInput['radius'],
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as GradientInput['positions'],
    }
  }
  if (node.type === NodeType.SweepGradient) {
    return {
      kind: 'sweep',
      center:
        animVec(p.c) ?? animVec(p.center) ?? animVec({ x: p.cx, y: p.cy }),
      startAngle: p.start as GradientInput['startAngle'],
      endAngle: p.end as GradientInput['endAngle'],
      colors: (p.colors as Color[]) ?? [],
      positions: p.positions as GradientInput['positions'],
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

function extractFilter(
  w: SceneWriter,
  node: Node
): Partial<PaintInput> | undefined {
  node = applyRef(w, node)
  const p = node.props
  switch (node.type) {
    case NodeType.ColorMatrix:
      return {
        colorFilter: {
          kind: 'matrix',
          matrix: p.matrix as ColorFilterInput['matrix'],
        },
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
    case NodeType.AlphaThreshold:
      return {
        colorFilter: {
          kind: 'alphaThreshold',
          threshold: p.threshold as ColorFilterInput['threshold'],
        },
      }
    case NodeType.Blur:
      return {
        imageFilter: {
          kind: 'blur',
          blur: p.blur as ImageFilterInput['blur'],
          blurX: p.blurX as ImageFilterInput['blurX'],
          blurY: p.blurY as ImageFilterInput['blurY'],
          tileMode: p.tileMode as TileMode,
        },
      }
    case NodeType.DropShadow:
      return {
        imageFilter: {
          kind: 'dropShadow',
          dx: p.dx as ImageFilterInput['dx'],
          dy: p.dy as ImageFilterInput['dy'],
          blur: p.blur as ImageFilterInput['blur'],
          blurX: p.blurX as ImageFilterInput['blurX'],
          blurY: p.blurY as ImageFilterInput['blurY'],
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
  return gradient != null ? { gradient } : extractFilter(w, child)
}

/**
 * Filters compose in declaration order: the earlier one runs first.
 *
 * That holds *across* the two classes too, which is the only way the order is
 * expressible at all. A colour filter is normally applied to the paint, before
 * the draw — so it can never run after an image filter, which works on the
 * rasterised result. When one is declared after an image filter, it joins the
 * image chain instead (tgfx's `ImageFilter::ColorFilter`), and then it does.
 *
 * ```tsx
 * <Luma /><Blur blur={8} />   // luminance, then blur it
 * <Blur blur={8} /><Luma />   // blur, then take the luminance of the result
 * ```
 *
 * A colour filter declared before any image filter stays on the paint, which is
 * cheaper: it costs no offscreen.
 *
 * The scope is one node's own children, in the order they are written. A
 * `<Paint>` child and an inherited group paint are merged, not chained, so a
 * colour filter arriving from either of those stays on the paint and runs
 * first whatever else the node declares. Nesting is what orders filters; which
 * side of a `<Paint>` they sit on is not.
 */
function addPaintSource(
  paint: Partial<PaintInput>,
  contribution: Partial<PaintInput>
): void {
  const next: Partial<PaintInput> = { ...contribution }
  // The chain built so far, which both branches below append to exactly once.
  let chain = paint.imageFilter

  const color = next.colorFilter
  if (color != null) {
    if (chain != null) {
      // Ordering, not preference: left on the paint it would run *before* the
      // image filter declared ahead of it, which is not what was written.
      chain = {
        kind: 'compose',
        first: chain,
        then: { kind: 'colorFilter', colorFilter: color },
      }
      delete next.colorFilter
    } else if (paint.colorFilter != null) {
      next.colorFilter = {
        kind: 'compose',
        inner: paint.colorFilter,
        outer: color,
      }
    }
  }

  if (next.imageFilter != null) {
    chain =
      chain != null
        ? { kind: 'compose', first: chain, then: next.imageFilter }
        : next.imageFilter
  }
  if (chain != null) {
    next.imageFilter = chain
  }
  Object.assign(paint, next)
}

function paintFromChildren(w: SceneWriter, node: Node): PaintInput | null {
  let paint: PaintInput | null = null
  for (const child of node.children) {
    if (child.type === NodeType.FilmGrain) {
      // Grain is a group's own style, not a paint contribution, and writeGroup
      // routes its ref itself — walking it here would register the handle
      // twice. Reaching it here at all means it is not a group's direct child,
      // which is the only place it draws anything.
      if (!warnedStrandedGrain && inDev()) {
        warnedStrandedGrain = true
        console.warn(
          '[tgfx] <FilmGrain> applies only as a direct child of a <Group>: it dusts what that group drew. Anywhere else it draws nothing.'
        )
      }
      continue
    }
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

  pushKind(w, kind, p)
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
      // A SharedValue path gets a string slot: re-parsed natively on change, never re-encoded.
      w.pushStringAnim(p.path)
      writePathEffects(w, node, p)
      break
    case Kind.Image:
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      // An integer, not a payload — and a slot when live, so swapping images is a patch.
      w.pushAnim(isSharedValue(p.image) ? p.image : imageHandle(p.image))
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
    case Kind.Backdrop:
      // Glass is a superset of blur, so one wire kind carries both: zero refraction is a plain
      // blur. Two node types feed it only so <Glass> can default refraction to something visible.
      w.pushAnim(p.x)
      w.pushAnim(p.y)
      w.pushAnim(p.width)
      w.pushAnim(p.height)
      // The corner radius is a clip, so it stays a literal; every material word
      // is an anim word — the style object is rebuilt per draw either way, so a
      // slot write costs nothing a literal does not.
      w.push(resolveNumber(p.r, 0))
      w.pushAnim(p.blur, 12)
      w.pushAnim(p.refraction, node.type === NodeType.Glass ? 40 : 0)
      w.pushAnim(p.depth, 20)
      w.pushAnim(p.frost, 20)
      w.pushAnim(p.dispersion, 0)
      // tgfx's own splay and angle; its light intensity is 80, dimmed to 50
      // here because over most content 80 reads as chrome rather than glass.
      w.pushAnim(p.splay, 0)
      w.pushAnim(p.lightAngle, 45)
      w.pushAnim(p.lightIntensity, 50)
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
    if (
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      intervals.length % 2 !== 0
    ) {
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
  pushKind(w, Kind.Mask, node.props)
  w.push(node.props.mode === 'luminance' ? 1 : 0)
  const maskCountAt = w.reserve()
  // The mask is a matte, not part of the picture: it inherits neither paint nor opacity.
  // Under -1 so a handle in the source cannot collide with the content child at the same index.
  w.pathStack.push(-1)
  w.patch(maskCountAt, writeNodes(w, source?.children ?? [], ROOT_CTX))
  w.pathStack.pop()
  const contentCountAt = w.reserve()
  w.patch(contentCountAt, writeNodes(w, content, contentCtx))
}

/**
 * A grain colour: one packed word, then a live flag, then the four channels
 * when any of them is a value slot.
 */
function writeGrainColor(w: SceneWriter, color: unknown): void {
  const channels =
    isColorComponents(color) && color.some(isSharedValue) ? color : null
  w.push(resolveColor(resolveValue(color) as Color))
  w.push(channels != null ? 1 : 0)
  if (channels != null) {
    for (let i = 0; i < 4; i++) {
      w.pushAnim(channels[i], i === 3 ? 1 : 0)
    }
  }
}

let warnedGrainSecondColor = false
let warnedStrandedGrain = false

const inDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__

/// `<FilmGrain>` on a group. Mode 0 is one colour, 1 two, 2 the noise's own RGB.
function writeGrain(w: SceneWriter, p: Record<string, unknown>): void {
  const mode = p.color == null ? 2 : p.secondColor == null ? 0 : 1
  if (
    mode === 2 &&
    p.secondColor != null &&
    !warnedGrainSecondColor &&
    inDev()
  ) {
    warnedGrainSecondColor = true
    console.warn(
      '[tgfx] <FilmGrain secondColor> with no `color`: the second colour is the other half of a two-colour grain, so on its own it is dropped and the grain keeps the noise own RGB. Name `color` too.'
    )
  }
  w.push(mode)
  w.pushAnim(p.size, 4)
  w.pushAnim(p.density, 0.5)
  w.pushAnim(p.seed, 0)
  w.pushAnim(
    isSharedValue(p.blendMode) ? p.blendMode : blendCode(p.blendMode),
    3
  )
  if (mode === 2) {
    w.pushAnim(p.opacity, 1)
    return
  }
  writeGrainColor(w, p.color)
  if (mode === 1) {
    writeGrainColor(w, p.secondColor)
  }
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
  const picture = p.picture === true
  const grain = node.children.find((c) => c.type === NodeType.FilmGrain)
  const extended = clip != null || layer || picture || grain != null
  pushKind(w, extended ? Kind.GroupLayer : Kind.Group, p)
  const opCountAt = w.reserve()
  w.patch(
    opCountAt,
    writeOps(w, (p.transform as Transform) ?? [], vec(p.origin))
  )
  const flags =
    (clip != null ? 1 : 0) |
    (p.invertClip === true ? 2 : 0) |
    (layer ? 4 : 0) |
    (grain != null ? 16 : 0)
  let flagsAt = -1
  if (extended) {
    flagsAt = w.reserve()
    if (clip != null) {
      writeClip(w, clip)
    }
    if (layer) {
      w.pushAnim(alpha, 1)
    }
    if (grain != null) {
      writeGrain(w, applyRef(w, grain).props)
    }
  }
  const childCountAt = w.reserve()
  w.patch(childCountAt, writeNodes(w, node.children, childCtx))
  if (flagsAt >= 0) {
    // Intent only. Whether it is safe to record is the reader's call: a value slot the writer
    // deduped, a video handle and a pending decode all look static from here.
    w.patch(flagsAt, flags | (picture ? 8 : 0))
  }
}

function writeCameraFrame(w: SceneWriter, node: Node, ctx: CompileCtx): void {
  const p = node.props
  const local = localPaint(w, node)
  const paint = mergePaint(ctx.paint, local)
  const alpha = mulOpacity(ctx.opacity, local.opacity)
  pushKind(w, Kind.CameraFrame, p)
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
      w.refPaths.push({ path: [...w.pathStack, count], ref })
      node = nodeInternals(ref).apply(node, w.reseed)
    }
    w.pathStack.push(count)
    if (kind === Kind.Mask) {
      writeMask(w, node, ctx)
    } else if (kind === Kind.Group) {
      writeGroup(w, node, ctx)
    } else if (kind === Kind.CameraFrame) {
      writeCameraFrame(w, node, ctx)
    } else {
      writeDrawing(w, node, ctx, kind)
    }
    w.pathStack.pop()
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
    stringValues: w.stringValues,
    refs: w.refs,
    refPaths: w.refPaths,
  }
}
