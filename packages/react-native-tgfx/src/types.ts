import type { ReactNode, Ref } from 'react'
import type { Color } from './compiler/colors'
import type { BlendMode } from './compiler/filters'
import type { Fit, Sampling, SrcRect, TileMode } from './compiler/image'
import type { Transform, Vector } from './compiler/transform'
import type { NodeHandle } from './imperative'
import type { TgfxImage } from './specs/TgfxImage.nitro'

export type { Color } from './compiler/colors'
export type { BlendMode } from './compiler/filters'
export type { Fit, Sampling, SrcRect, TileMode } from './compiler/image'
export type { Transform, TransformOp, Vector } from './compiler/transform'
export type { PixelFormat, TgfxImage } from './specs/TgfxImage.nitro'

/**
 * A value that may be a plain value or a Reanimated `SharedValue` (anything with
 * a `.value`). All geometric and paint props accept this so a single prop can be
 * static or animated on the UI thread.
 */
export type SharedValueLike<T> = { value: T }
export type Animated<T> = T | SharedValueLike<T>

/** Paint attributes shared by every drawing component, `<Group>`, and `<Paint>`. */
export interface PaintProps {
  /**
   * A handle from `useNode()`, for changing this node without a React render.
   * See {@link NodeHandle}.
   */
  ref?: NodeHandle
  color?: Animated<Color>
  /** `'fill'` (default) or `'stroke'`. */
  style?: 'fill' | 'stroke'
  strokeWidth?: Animated<number>
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  /** Paint-wide alpha multiplier in [0, 1]; only one per chain can animate. */
  opacity?: Animated<number>
  antiAlias?: boolean
  /** How this drawing composites onto what is already there. `'srcOver'` by default. */
  blendMode?: BlendMode
  children?: ReactNode
}

export interface GroupProps extends PaintProps {
  transform?: Transform
  origin?: Vector
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
   * SVG path data. Read once per commit: there is no path value slot, so a
   * SharedValue here would never animate.
   */
  path: string
}

export interface ImageProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
  /** A native image handle from `useImage`. `null` draws nothing. */
  image: TgfxImage | null
  /** Defaults to `'contain'`. Same semantics as Skia's `fit`. */
  fit?: Fit
  /** Defaults to `'linear'`. Use `'mipmap'` for large images in small boxes. */
  sampling?: Sampling
  /** Source sub-rect, in image pixels — for sprite sheets. */
  rect?: SrcRect
}

export interface CameraFrameProps extends PaintProps {
  /**
   * A hardware-buffer handle from `imageFromNativeBuffer`, re-pointed at each
   * new frame with `image.setNativeBuffer(...)`. `null` draws nothing at all,
   * children included — there is no frame to place them against.
   */
  image: TgfxImage | null
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
  image: TgfxImage | null
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
   * Read once per commit: there is no text value slot, so a SharedValue here
   * would never animate.
   *
   * Optional because `<Span>` children (inherited from {@link PaintProps}) are
   * the other way to give a `<Text>` its content, and they replace this when
   * present. A `<Text>` with neither draws nothing.
   */
  text?: string
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
  /** Multiplier on the cropped region's device-pixel size. Defaults to 1. */
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
   * Read the canvas back into memory. Resolves with a zero-copy `ArrayBuffer` —
   * never a base64 string.
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
}

export interface CanvasProps {
  style?: object
  children?: ReactNode
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
   * Render without an alpha channel: the layer composites without blending and
   * the engine clears to opaque black. Anything behind the canvas stops showing
   * through.
   *
   * Measured neutral on a Mali-G68 with 400 animated shapes (main-thread FPS
   * 57.5 → 56.7), so treat it as a correctness/appearance switch rather than an
   * optimisation, and measure before enabling it for speed.
   */
  opaque?: boolean
  /** Device-pixel debugging overlay hook (reserved). */
  debug?: boolean
}

export interface GradientStops {
  colors: Color[]
  positions?: number[]
}

export interface LinearGradientProps extends GradientStops {
  start: Vector
  end: Vector
}

export interface RadialGradientProps extends GradientStops {
  center: Vector
  r: number
}

export interface SweepGradientProps extends GradientStops {
  /** Center of the sweep. `center` is accepted as an alias. */
  c?: Vector
  center?: Vector
  /** Angular range in degrees; defaults to a full 0-360 turn (as in Skia). */
  start?: number
  end?: number
}

/**
 * A uniform value. A SharedValue element becomes an animation slot the native
 * engine patches on the UI thread, so animating it costs no JS per frame.
 */
export type UniformValue = Animated<number> | Array<Animated<number>>

export interface ShaderProps {
  /** SkSL source with a `vec4 main(vec2 pos)` entry point. */
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
 * Anything but exactly 20 numbers is treated as the identity.
 */
export interface ColorMatrixProps {
  matrix: number[]
}

export interface BlendColorProps {
  color: Color
  /** How `color` (src) blends with the drawing (dst). Defaults to `'srcOver'`. */
  mode?: BlendMode
}

export interface BlurProps {
  /** Gaussian sigma for both axes; `blurX`/`blurY` override it per axis. */
  blur?: number
  blurX?: number
  blurY?: number
  /** How the kernel samples outside the drawing. Defaults to `'decal'`. */
  tileMode?: TileMode
}

export interface DropShadowProps {
  dx?: number
  dy?: number
  blur?: number
  blurX?: number
  blurY?: number
  color?: Color
  /** Draw only the shadow, dropping the content that cast it. */
  shadowOnly?: boolean
}

export interface NoiseProps {
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
}

export type PaintComponentProps = PaintProps
