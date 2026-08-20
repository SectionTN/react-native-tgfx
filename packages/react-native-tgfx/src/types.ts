import type { ReactNode, Ref } from 'react'
import type { Color } from './compiler/colors'
import type { BlendMode } from './compiler/filters'
import type { Fit, Sampling, SrcRect, TileMode } from './compiler/image'
import type { Transform, Vector } from './compiler/transform'
import type { SharedValueLike } from './compiler/values'
import type { FontSource } from './hooks/useFonts'
import type { NodeHandle } from './imperative'

export type { Color, ColorComponents } from './compiler/colors'
export type { BlendMode } from './compiler/filters'
export type { Fit, Sampling, SrcRect, TileMode } from './compiler/image'
export type {
  Transform,
  TransformAngle,
  TransformNumber,
  TransformOp,
  Vector,
} from './compiler/transform'
export type { SharedValueLike } from './compiler/values'
export type { PixelFormat, TgfxImage } from './specs/TgfxImage.nitro'

/**
 * What a drawable image has to expose: a registry id and its size. A
 * {@link TgfxImage} from `useImage` is one, and so is a video's frame from
 * `useVideo` — that one is owned natively and has no handle to dispose.
 */
export interface ImageLike {
  readonly handle: number
  readonly width: number
  readonly height: number
}

export type Animated<T> = T | SharedValueLike<T>

/** Paint attributes shared by every drawing component, `<Group>`, and `<Paint>`. */
export interface PaintProps {
  /**
   * A handle from `useNode()`, for changing this node without a React render.
   * See {@link NodeHandle}.
   */
  ref?: NodeHandle
  /**
   * Skip drawing (and hit-testing) this node. A value slot, so a handle or a
   * SharedValue toggles it with no re-encode — the supported way to pool
   * mounted nodes for particle systems and variable-count scenes.
   */
  visible?: Animated<boolean | number>
  color?: Animated<Color>
  /** `'fill'` (default) or `'stroke'`. */
  style?: 'fill' | 'stroke'
  strokeWidth?: Animated<number>
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  /** Past this length-over-width ratio a `'miter'` join falls back to bevel. Defaults to 4. */
  strokeMiter?: Animated<number>
  /** Paint-wide alpha multiplier in [0, 1]; only one per chain can animate. */
  opacity?: Animated<number>
  antiAlias?: boolean
  /** How this drawing composites onto what is already there. `'srcOver'` by default. */
  blendMode?: BlendMode
  children?: ReactNode
}

/** A clip shape: a rect, a rounded rect when `r`/`rx`/`ry` is set, or SVG path data. */
export interface ClipRect {
  x: number
  y: number
  width: number
  height: number
  r?: number
  rx?: number
  ry?: number
}

export interface GroupProps extends PaintProps {
  transform?: Transform
  origin?: Vector
  /** Confines the subtree to this shape. Read once per commit, like `<Path path>`. */
  clip?: ClipRect | string
  /** Keep what falls *outside* `clip` instead of inside. */
  invertClip?: boolean
  /**
   * Composite the subtree once into an offscreen layer. Without it `opacity`
   * multiplies into each child, so overlapping children double-blend.
   */
  layer?: boolean
  /**
   * Record this subtree once and replay the recording every frame, for a static
   * background a scene redraws but never changes — a map, a chart grid.
   *
   * Ignored, with a warning, if anything under it changes between frames — an
   * animated value, a video or camera frame, an image still decoding. A
   * recording would freeze those. Cheap to leave on otherwise; the recording is
   * rebuilt whenever the scene recommits.
   *
   * It replays recorded draw calls, not rasterized pixels, so it avoids walking
   * the recorded subtree again without changing its resolution.
   */
  picture?: boolean
}

export interface RectProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
}

export interface RoundedRectProps extends RectProps {
  /** Uniform corner radius; overridden by `rx`/`ry` when provided. */
  r?: Animated<number>
  rx?: Animated<number>
  ry?: Animated<number>
}

export interface OvalProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
}

export interface CircleProps extends PaintProps {
  cx: Animated<number>
  cy: Animated<number>
  r: Animated<number>
}

export interface LineProps extends PaintProps {
  x1: Animated<number>
  y1: Animated<number>
  x2: Animated<number>
  y2: Animated<number>
}

export interface PathProps extends PaintProps {
  /**
   * SVG path data. A SharedValue (or a `handle.set({ path })` write) gets a
   * string slot: the engine re-parses on the render thread when the value
   * changes, with no scene re-encode.
   */
  path: Animated<string>
  /** Where along the path to start drawing, 0-1. Animatable — this is line-drawing. */
  start?: Animated<number>
  /** Where to stop, 0-1. `end` below `start` draws the segment reversed. */
  end?: Animated<number>
  /** How the path decides what is inside. `'winding'` by default. */
  fillType?: 'winding' | 'evenOdd'
}

/** Dashes a stroked path. A child of `<Path>`, like a gradient is a child of a shape. */
export interface DashPathEffectProps {
  /** Alternating on/off lengths in px. Needs at least two, and an even count. */
  intervals: number[]
  /** Offset into the interval pattern; animate it to march the dashes. */
  phase?: Animated<number>
}

/** Rounds every corner of a path by `r`, before any stroke is applied. */
export interface CornerPathEffectProps {
  r: number
}

export interface ImageProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
  /**
   * A native image handle from `useImage`. `null` draws nothing. Swappable
   * through a node handle — `handle.set({ image })` patches the registry id in
   * place, no re-encode.
   */
  image: ImageLike | null
  /** Defaults to `'contain'`. Same semantics as Skia's `fit`. */
  fit?: Fit
  /** Defaults to `'linear'`. Use `'mipmap'` for large images in small boxes. */
  sampling?: Sampling
  /** Source sub-rect, in image pixels — animatable, for sprite-sheet stepping. */
  rect?: SrcRect
}

/**
 * Props for {@link ImageSVG}. The same props as {@link ImageProps}, because it
 * is the same node: an SVG source becomes an image handle at load, carrying a
 * picture the renderer replays at draw resolution.
 *
 * Because it replays rather than resamples, `width`/`height` are a destination,
 * not a raster size: a 24pt icon drawn at 240pt is redrawn, not blown up.
 *
 * Skia's `<ImageSVG>` takes `svg=` rather than `image=`, so migrating code needs
 * that one rename; everything else carries over.
 */
export type ImageSVGProps = ImageProps

/** One sprite placement in an `<Atlas>`. Every field is animatable. */
export interface AtlasSprite {
  /** The sprite's rect in the atlas image, in image pixels. */
  rect: SrcRect
  /** Where the sprite's centre lands on the canvas. */
  x: Animated<number>
  y: Animated<number>
  /** Uniform scale. Defaults to 1. */
  scale?: Animated<number>
}

/**
 * Sprites are placed axis-aligned: tgfx's `drawAtlas` maps each sprite's
 * bounding box, so a rotation would stretch the sprite rather than turn it.
 * Rotate a `<Group>` around the whole batch, or use `<Image>` per sprite.
 */
export interface AtlasProps extends PaintProps {
  /** The sprite sheet. `null` draws nothing. */
  image: ImageLike | null
  /** Inline sprite list; ignored when `buffer` is given. */
  sprites?: AtlasSprite[]
  /**
   * A shared sprite buffer from `useSpriteBuffer`: seven floats per sprite,
   * written in place from JS or a worklet and read by the renderer at draw.
   * The zero-allocation path for particle systems.
   */
  buffer?: { id: number; capacity: number }
  /** How many buffer sprites to draw. A value slot; defaults to the capacity. */
  count?: Animated<number>
  /** Defaults to `'linear'`. */
  sampling?: Sampling
}

/** `'triangles'` takes vertices in threes; `'triangleStrip'` shares two per triangle. */
export type MeshTopology = 'triangles' | 'triangleStrip'

export interface VerticesProps extends PaintProps {
  /**
   * A shared mesh buffer from `useVertexBuffer`: positions (and reserved
   * texture/colour/index sections) written in place and read at draw — the
   * zero-allocation path for per-frame mesh deformation. Replaces the inline
   * arrays below when given.
   */
  buffer?: {
    id: number
    maxVertices: number
    maxIndices: number
    hasTextures: boolean
    hasColors: boolean
  }
  /** How many buffer vertices to draw. A value slot; defaults to the capacity. */
  vertexCount?: Animated<number>
  /** How many buffer indices to draw. A value slot; defaults to the capacity. */
  indexCount?: Animated<number>
  /** Vertex positions, in canvas points. */
  vertices?: Vector[]
  /** One colour per vertex, interpolated across each triangle. */
  colors?: Color[]
  /**
   * One texture coordinate per vertex, in the **pixels** of the image behind an
   * `<ImageShader>` on this node's paint. Without a shader they do nothing.
   */
  textures?: Vector[]
  /**
   * Indices into `vertices`. Without them the vertices are taken in order.
   * Indexed meshes are capped at 65536 vertices, and every index must be in
   * range — one that is not skips the whole mesh.
   */
  indices?: number[]
  /** Defaults to `'triangles'`. */
  mode?: MeshTopology
}

export interface HitTestOptions {
  /**
   * Test the filled region rather than the bounding box. Defaults to false,
   * which is what a tap target usually wants and is much cheaper on paths.
   */
  precise?: boolean
}

export interface HitTestResult {
  /** The handle on the node, or null if it was never given one. */
  node: NodeHandle | null
  /** Child indices from the root down to the node, so anonymous hits stay distinct. */
  path: number[]
}

/**
 * A frosted or refractive panel over whatever is already drawn beneath it.
 *
 * Backdrop effects read the pixels below, so the node must come **after** the
 * content it frosts, and the region is its `clip` rect.
 *
 * The panel is not painted, it is sampled, so of the inherited paint only
 * `opacity`, `visible` and `ref` apply, plus the alpha of `color` — its RGB,
 * the stroke props and any paint or shader child are all ignored. A `ref`
 * patches values; a backdrop has no hit bounds, so it is never pressable.
 */
export interface BackdropProps extends PaintProps {
  /** The panel's rect, and what it samples from beneath. */
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
  /** Corner radius. Defaults to 0. Static: the writer does not give it a slot. */
  r?: number
  /** Gaussian blur of the backdrop. Defaults to 12. */
  blur?: Animated<number>
}

/**
 * `blur` is absent: glass frosts with `frost`, and the blur word is ignored on
 * this path.
 *
 * Every field here is animatable and every one is a value slot, so driving the
 * material from a SharedValue — a highlight that tracks device tilt, a frost
 * that fades in — costs one slot write per frame and no scene re-encode. Only
 * the inherited `r` is static: it is a clip, not a material parameter.
 */
export interface GlassProps extends Omit<BackdropProps, 'blur'> {
  /** Edge refraction strength, 0–100. Defaults to 40. */
  refraction?: Animated<number>
  /** How far the refraction reaches in from the edge, 1–100. Defaults to 20. */
  depth?: Animated<number>
  /** Background frost, 0–100. Defaults to 20. */
  frost?: Animated<number>
  /** Chromatic aberration at the edge, 0–100. Defaults to 0. */
  dispersion?: Animated<number>
  /**
   * How the refraction is aimed, 0–100. At 0 it follows the panel's edge
   * curvature; at 100 it points at the panel's centre. Defaults to 0.
   */
  splay?: Animated<number>
  /**
   * Where the edge highlight comes from, in degrees. 0 is straight above and
   * positive turns clockwise, −179 to 180. Defaults to 45.
   */
  lightAngle?: Animated<number>
  /**
   * How bright the edge highlight is, 0–100 (values above 100 are not clamped).
   * Defaults to 50 — tgfx's own default is 80, which reads as chrome rather
   * than glass over most content. 0 removes the highlight and leaves the
   * refraction and frost alone.
   */
  lightIntensity?: Animated<number>
}

export interface CameraFrameProps extends PaintProps {
  /**
   * A hardware-buffer handle from `imageFromNativeBuffer`, re-pointed at each
   * new frame with `image.setNativeBuffer(...)`. `null` draws nothing at all,
   * children included — there is no frame to place them against.
   */
  image: ImageLike | null
  /**
   * How the frame is scaled into the canvas. Defaults to `'cover'`, which fills
   * the canvas and lets the overflowing axis run off it.
   */
  fit?: Fit
  /** Defaults to `'linear'`. */
  sampling?: Sampling
  /**
   * Clockwise degrees to rotate the buffer by so it is the right way up. This
   * *counters* `frame.orientation`: a frame reporting `'right'` (pixels rotated
   * +90° from upright) needs `270`.
   *
   * Rounded to the nearest quarter turn and wrapped, so `-90` and `270` are the
   * same thing — a detector or camera API that reports signed degrees can be
   * passed straight through.
   */
  rotation?: number
  /** Flip the buffer horizontally. Pass `frame.isMirrored` straight through. */
  mirror?: boolean
}

/**
 * An image as the paint source for any shape: put it inside a `<Paint>` or
 * directly under the shape, the way a gradient goes.
 */
export interface ImageShaderProps {
  image: ImageLike | null
  /** How the image repeats outside its bounds. Both default to `'clamp'`. */
  tx?: TileMode
  ty?: TileMode
  sampling?: Sampling
  /** Destination rect the image is fitted into; omit to sample 1:1. */
  rect?: SrcRect
  /** How the image fits `rect`. Ignored without one. Defaults to `'contain'`. */
  fit?: Fit
}

/** CSS font weights. `'normal'` is 400 and `'bold'` is 700. */
export type FontWeight =
  | 'normal'
  | 'bold'
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900

/** Everything that selects a face and shapes its glyphs. */
export interface FontProps {
  fontSize?: Animated<number>
  /**
   * A family registered with `useFonts`/`loadFont`, or one the platform knows.
   * Unregistered and unknown falls back to the platform's default text font.
   */
  fontFamily?: string
  /** Picks the nearest face in the family; synthesised when none is close. */
  fontWeight?: FontWeight
  fontStyle?: 'normal' | 'italic'
  /** Force the embolden/shear the face match only applies when nothing close enough exists. */
  fauxBold?: boolean
  fauxItalic?: boolean
  /** Extra px between glyphs. */
  letterSpacing?: number
}

/**
 * How the lines of a paragraph are broken and placed.
 *
 * Declared apart from `<Text>` because `measureText` has to accept exactly this
 * set: "a width measured here is the width drawn" only holds while the two lists
 * are identical, and this is what keeps them from drifting.
 */
export interface ParagraphProps {
  /**
   * Wrap width in px. Without it, text is only broken at explicit `\n` — which
   * is the cheap single-line path, unchanged.
   */
  width?: number
  /** How lines sit inside `width` (or inside the widest line without one). */
  textAlign?: 'left' | 'center' | 'right'
  /** Baseline-to-baseline distance in px. Defaults to the font's own spacing. */
  lineHeight?: number
  /** Stop after this many lines. Omitted or 0 means unlimited. */
  maxLines?: number
  /** Appended to the last line when `maxLines` truncates. */
  ellipsis?: string
}

export interface TextProps extends PaintProps, FontProps, ParagraphProps {
  x: Animated<number>
  y: Animated<number>
  /**
   * A SharedValue (or a `handle.set({ text })` write) gets a string slot: the
   * engine re-shapes on the render thread when the value changes, with no
   * re-encode — the live-counter path.
   *
   * Optional because `<Span>` children (inherited from {@link PaintProps}) are
   * the other way to give a `<Text>` its content, and they replace this when
   * present. A `<Text>` with neither draws nothing.
   */
  text?: Animated<string>
}

/**
 * Text laid along an SVG path: each glyph is placed at its own advance along the
 * curve and rotated to the tangent there. The path is the baseline, so there is
 * no `x`/`y` — and no wrapping, since the path is the line.
 */
export interface TextPathProps extends PaintProps, FontProps {
  /** SVG path data, read once per commit, exactly as `<Path>` reads it. */
  path: string
  /** Optional only because `<Span>` children replace it, as in `<Text>`. */
  text?: string
  /** Distance along the path where the first glyph starts. */
  startOffset?: number
}

/**
 * A styled run inside a `<Text>` or `<TextPath>`. Everything it does not set is
 * the paragraph's — so a bold word is `<Span text="..." fontWeight={700} />`.
 *
 * `fontSize` here is static on purpose. The paragraph's `fontSize` is the one
 * with an animation slot; the layout is memoised against it, and a second
 * moving size would miss that memo on every frame.
 */
export interface SpanProps {
  text: string
  color?: Color
  fontSize?: number
  fontFamily?: string
  fontWeight?: FontWeight
  fontStyle?: 'normal' | 'italic'
  letterSpacing?: number
}

/** One glyph of a `<Glyphs>`, positioned relative to the node's `x`/`y`. */
export interface PlacedGlyph {
  /** An id from `glyphIds()`, in the same face this node names. */
  id: number
  x: number
  y: number
}

/**
 * Explicitly positioned glyphs: the escape hatch for a caller doing its own
 * layout. There is no shaping, no line breaking and no font fallback here — an
 * id the face does not have draws `.notdef`.
 *
 * Get the ids from `glyphIds()` with the same font props.
 */
export interface GlyphsProps extends PaintProps, FontProps {
  x: Animated<number>
  y: Animated<number>
  glyphs: PlacedGlyph[]
}

export type SnapshotFormat = 'png' | 'jpeg' | 'webp' | 'raw'

export interface SnapshotOptions {
  /** Defaults to `'png'`. `'raw'` returns straight-alpha RGBA8888 rows. */
  format?: SnapshotFormat
  /** 1–100, for `'jpeg'` and `'webp'`. Defaults to 100. */
  quality?: number
  /** Crop, in the same logical pixels the scene is drawn in. Defaults to the whole canvas. */
  rect?: { x: number; y: number; width: number; height: number }
  /**
   * Multiplier on the cropped region's device-pixel size. Defaults to 1. Must be
   * positive and finite; the ceiling is whatever target the GPU can allocate, so
   * a large canvas times a large scale rejects rather than resolving.
   */
  scale?: number
}

export interface Snapshot {
  /** Encoded image bytes, or straight-alpha RGBA8888 rows for `format: 'raw'`. */
  data: ArrayBuffer
  /** Size in pixels, which is the logical size times the device pixel ratio times `scale`. */
  width: number
  height: number
  format: SnapshotFormat
}

/** What a `ref` on `<Canvas>` gives you. */
export interface CanvasHandle {
  /**
   * Read the canvas back into memory. Resolves with an `ArrayBuffer`, never a
   * base64 string. iOS wraps the encoded native buffer without copying;
   * Android copies the temporary JNI buffer into Nitro-owned memory once.
   *
   * The readback is issued on the render thread inside a frame it forces, and
   * the encode runs on a worker, so the animation loop keeps its cadence.
   * Rejects (rather than resolving a black frame) if the canvas has no surface
   * yet or is unmounted before the frame lands.
   */
  snapshot(options?: SnapshotOptions): Promise<Snapshot>
  /**
   * The same readback, encoded and written to `path` natively. The image bytes
   * never enter JS, so a large canvas costs nothing on the JS heap.
   */
  save(path: string, options?: SnapshotOptions): Promise<void>
  /**
   * Force a frame without a React commit. Only needed for state the scene
   * points at rather than holds — an image handle re-pointed at new pixels, say.
   * A `NodeHandle.set` already redraws on its own.
   */
  redraw(): void

  /**
   * The nodes under a canvas-space point, topmost first.
   *
   * Answered natively from the geometry the renderer is drawing this frame, so
   * it follows animated values rather than the last committed props, and it
   * inverse-transforms through each `<Group>` the same way the renderer
   * transforms forward.
   *
   * Only nodes carrying a `useNode()` handle can be named, so a hit on an
   * unnamed node reports `node: null` — the `path` is still there if you want
   * to tell two anonymous hits apart.
   */
  hitTest(x: number, y: number, options?: HitTestOptions): HitTestResult[]

  /**
   * Move the root viewport — the zoom/pan the renderer owns.
   *
   * One native write and a redraw: no React render, no scene recommit, no wire
   * traffic, because the transform sits above the whole draw program. That is
   * the entire point of it over a `<Group transform>`, which re-encodes the
   * scene on every tick.
   *
   * Omitted fields keep their current value, so `setViewport({ zoom: 2 })`
   * pans nowhere. A non-finite `x`/`y` or a non-positive `zoom` is ignored as
   * a whole rather than collapsing the scene.
   *
   * `hitTest` follows it: a hit at (10, 10) under `zoom: 2` reports the node at
   * scene (5, 5), and `snapshot()` reads back the zoomed frame.
   *
   * The path a gesture should use: it costs one native write per tick, with no
   * React render and no scene re-encode. The `viewport` prop is the same write
   * driven from a commit instead.
   */
  setViewport(viewport: { zoom?: number; x?: number; y?: number }): void
}

/**
 * A root zoom/pan applied above the whole scene.
 *
 * `zoom` scales about the scene origin and `x`/`y` translate in canvas points
 * *after* it, the order a scroll view uses. To pinch about a focal point
 * `(fx, fy)` — the gesture centroid, in canvas points — hold the scene point
 * under it still:
 *
 * ```ts
 * const sceneX = (fx - x) / zoom
 * const sceneY = (fy - y) / zoom
 * canvas.current.setViewport({
 *   zoom: nextZoom,
 *   x: fx - nextZoom * sceneX,
 *   y: fy - nextZoom * sceneY,
 * })
 * ```
 *
 * Fields are plain numbers — the viewport is a native write above the draw
 * program, never a value slot. To drive it from a gesture without touching the
 * JS thread, pass the whole object as one `SharedValue<Viewport>` to
 * `<Canvas viewport>` and write it from the gesture worklet; the update is
 * atomic, so a pinch never presents a zoom with last frame's pan.
 * {@link CanvasHandle.setViewport} is the same write from the JS thread.
 */
export interface Viewport {
  /** Scale about the scene origin. Defaults to 1; a non-positive value is ignored. */
  zoom?: number
  /** Canvas-point pan, applied after the zoom. Defaults to 0. */
  x?: number
  /** Canvas-point pan, applied after the zoom. Defaults to 0. */
  y?: number
}

/**
 * A drawing surface's colour space. `'display-p3'` keeps wide-gamut content
 * instead of clamping it; `'srgb'` is the default everywhere.
 */
export type ColorSpace = 'srgb' | 'display-p3'

export interface CanvasProps {
  style?: object
  children?: ReactNode
  /**
   * Fonts this canvas needs, `useFonts`' argument shape:
   * `{ Family: [require('./Family-Regular.ttf'), ...] }`.
   *
   * The canvas registers them and withholds its children until every face is
   * in, so text never flashes in the platform fallback — no hook, no gating in
   * user code. Registration is process-wide and permanent, exactly as
   * `loadFonts` does it; a failed load warns and renders anyway, since
   * fallback text beats a canvas that stays blank forever.
   */
  fonts?: Record<string, FontSource[]>
  /** Imperative pixel readback: see {@link CanvasHandle}. */
  ref?: Ref<CanvasHandle>
  /**
   * How the canvas is composited on Android.
   *
   * - `'layer'` (default) gives it its own compositor layer, which is fastest,
   *   but it punches through the window: React Native content *behind* the
   *   canvas does not show through its transparent pixels, and view transforms
   *   do not apply to it. Content drawn on top composites normally.
   * - `'texture'` draws the canvas inside the view hierarchy, so transparency
   *   and transforms behave like any other view, at the cost of a window redraw
   *   per frame.
   *
   * Ignored on iOS, where the Metal layer already composites in-hierarchy.
   */
  composite?: 'layer' | 'texture'
  /**
   * The drawing surface's colour space. Defaults to `'srgb'`.
   *
   * `'display-p3'` creates a P3 surface, so wide-gamut images and gradients keep
   * their colour on a P3 screen instead of being clamped. Note that a `color`
   * prop is still carried as sRGB in the draw program, so `color(display-p3 …)`
   * remains a compile-time conversion — this widens what images and gradients
   * can show, not what a packed colour can express.
   *
   * **Read once, when the canvas mounts.** The surface takes its colour space
   * from the platform window, which is created with the view; changing this
   * prop later warns in dev and does nothing. Remount with a `key` to change it.
   */
  colorSpace?: ColorSpace
  /**
   * Render without an alpha channel: the layer composites without blending and
   * the engine clears to opaque black. Anything behind the canvas stops showing
   * through.
   *
   * Measured neutral on a Mali-G68 with 400 animated shapes (main-thread FPS
   * 57.5 → 56.7), so treat it as a correctness/appearance switch rather than an
   * optimisation, and measure before enabling it for speed.
   */
  opaque?: boolean
  /**
   * A root zoom/pan the renderer owns — see {@link Viewport}.
   *
   * Applied above the whole draw program, so moving it never re-encodes the
   * scene. A plain object is set from the commit. A `SharedValue<Viewport>` is
   * pushed from the UI thread whenever it is written — a gesture worklet can
   * drive it with no JS-thread hop and no React render. Drive it from one side
   * or the other, not both.
   */
  viewport?: Viewport | SharedValueLike<Viewport>
  /** Device-pixel debugging overlay hook (reserved). */
  debug?: boolean
}

/** A point whose axes are each animatable. */
export interface AnimatedVector {
  x: Animated<number>
  y: Animated<number>
}

export interface GradientStops {
  /**
   * Stop colours. An entry given as `[r, g, b, a]` components with a
   * SharedValue channel animates; a handle's `set({ colors })` patches them all.
   */
  colors: Color[]
  /** Stop offsets in 0..1. Animatable — each is a value slot when live. */
  positions?: Animated<number>[]
  /** A handle from `useNode()`, for patching this gradient without a render. */
  ref?: NodeHandle
}

export interface LinearGradientProps extends GradientStops {
  start: AnimatedVector
  end: AnimatedVector
}

export interface RadialGradientProps extends GradientStops {
  center: AnimatedVector
  r: Animated<number>
}

export interface SweepGradientProps extends GradientStops {
  /** Center of the sweep. `center` is accepted as an alias. */
  c?: AnimatedVector
  center?: AnimatedVector
  /** Angular range in degrees; defaults to a full 0-360 turn (as in Skia). */
  start?: Animated<number>
  end?: Animated<number>
}

/**
 * A uniform value. A SharedValue element becomes an animation slot the native
 * engine patches on the UI thread, so animating it costs no JS per frame.
 */
export type UniformValue = Animated<number> | Array<Animated<number>>

export interface ShaderProps {
  /**
   * A handle from `useNode()`, for patching `uniforms` without a React render.
   * See {@link NodeHandle}.
   */
  ref?: NodeHandle
  /** The supported SkSL subset, with a `half4`/`float4`/`vec4 main(vec2 pos)` entry point. */
  source: string
  uniforms?: Record<string, UniformValue>
  /**
   * One shader component per `uniform shader` the source declares, matched by
   * order. Sample them as `name.eval(coord)` or `sample(name, coord)`.
   */
  children?: ReactNode
}

/**
 * A 4x5 row-major colour matrix, applied as
 * `R' = a*R + b*G + c*B + d*A + e` (and so on per channel), then clamped.
 * Anything but exactly 20 numbers is treated as the identity. Each entry is
 * animatable, and a `ref` patches the whole matrix in place.
 */
export interface ColorMatrixProps {
  matrix: Animated<number>[]
  /** A handle from `useNode()`, for patching this filter without a render. */
  ref?: NodeHandle
}

export interface BlendColorProps {
  color: Color
  /** How `color` (src) blends with the drawing (dst). Defaults to `'srcOver'`. */
  mode?: BlendMode
  /** A handle from `useNode()`, for patching this filter without a render. */
  ref?: NodeHandle
}

export interface BlurProps {
  /** Gaussian sigma for both axes; `blurX`/`blurY` override it per axis. Animatable. */
  blur?: Animated<number>
  blurX?: Animated<number>
  blurY?: Animated<number>
  /** How the kernel samples outside the drawing. Defaults to `'decal'`. */
  tileMode?: TileMode
  /** A handle from `useNode()`, for patching this filter without a render. */
  ref?: NodeHandle
}

export interface DropShadowProps {
  dx?: Animated<number>
  dy?: Animated<number>
  blur?: Animated<number>
  blurX?: Animated<number>
  blurY?: Animated<number>
  color?: Color
  /** Draw only the shadow, dropping the content that cast it. */
  shadowOnly?: boolean
  /** Cast the shadow *inside* the shape instead of under it. */
  inner?: boolean
  /** A handle from `useNode()`, for patching this filter without a render. */
  ref?: NodeHandle
}

/**
 * Procedural film grain over a `<Group>`, clipped to what the group actually
 * drew. A child of `Group`, not a paint: it reads the group's own pixels, so
 * the group is rasterised once per frame while one is attached.
 *
 * `color` alone gives single-colour grain; `color` with `secondColor` splits
 * the grain into two complementary halves; neither keeps the noise's own RGB
 * and takes its strength from `opacity`.
 */
export interface FilmGrainProps {
  /** Grain size in points — larger is coarser. Defaults to 4. */
  size?: Animated<number>
  /** How much of the group the grain reaches, 0–1. Defaults to 0.5. */
  density?: Animated<number>
  /** The pattern's seed. Defaults to 0. */
  seed?: Animated<number>
  /** Single-colour grain, its alpha the grain's opacity. */
  color?: Color
  /**
   * With `color`, the second half's colour. A handle keeps one colour pool, so
   * unlike `color` this one re-encodes rather than patching; live channels
   * still work, written as `[r, g, b, a]` with shared values in it.
   */
  secondColor?: Color
  /**
   * Colourless grain only: overall strength, 0–1. Defaults to 1. It is not
   * written in the other two modes, so a handle write there re-encodes and
   * changes nothing — set the colour's alpha instead.
   */
  opacity?: Animated<number>
  /**
   * How the grain composites over the group. Defaults to `'srcOver'`. Not
   * `Animated`: a value slot carries a number, and an enum only reaches one
   * through a handle write, which resolves the name to its wire code.
   */
  blendMode?: BlendMode
  /** A handle from `useNode()`, for patching the grain without a render. */
  ref?: NodeHandle
}

/**
 * Hides its children through another drawing. `'alpha'` keeps what the mask is
 * opaque under; `'luminance'` keeps what it is bright under.
 */
export interface MaskProps {
  mode?: 'alpha' | 'luminance'
  /** The drawing whose alpha or luminance does the masking. */
  mask: ReactNode
  children?: ReactNode
}

/**
 * Folds its shader children together with `mode`, left to right: the first is the
 * destination, each next one blends over it. A shader source, not a paint filter.
 */
export interface BlendProps {
  mode?: BlendMode
  children?: ReactNode
}

/** A solid colour as a shader, for use as a `<Blend>` input. */
export interface ColorShaderProps {
  color: Color
}

/** Replaces every colour with its luminance, carried into the alpha channel. */
export type LumaProps = Record<string, never>

/**
 * Cuts translucency to a hard edge: alpha below `threshold` becomes fully
 * transparent, alpha at or above it fully opaque. Colours are untouched.
 *
 * tgfx's own, with no Skia equivalent. Useful for turning a blurred alpha into
 * a solid shape — a sticker outline, a metaball — by blurring first and
 * thresholding after, which the ordering rule below makes expressible.
 */
export interface AlphaThresholdProps {
  /** 0–1. Defaults to 0.5. Animatable. */
  threshold?: Animated<number>
  /** A handle from `useNode()`, for patching this filter without a render. */
  ref?: NodeHandle
}

export interface NoiseProps {
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
}

export type PaintComponentProps = PaintProps
