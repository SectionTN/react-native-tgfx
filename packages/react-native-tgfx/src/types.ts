import type { ReactNode, Ref } from 'react'
import type { Color } from './compiler/colors'
import type { Fit, Sampling, SrcRect, TileMode } from './compiler/image'
import type { Transform, Vector } from './compiler/transform'
import type { TgfxImage } from './specs/TgfxImage.nitro'

export type { Color } from './compiler/colors'
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
  color?: Animated<Color>
  /** `'fill'` (default) or `'stroke'`. */
  style?: 'fill' | 'stroke'
  strokeWidth?: Animated<number>
  strokeCap?: 'butt' | 'round' | 'square'
  strokeJoin?: 'miter' | 'round' | 'bevel'
  /** Paint-wide alpha multiplier in [0, 1]; only one per chain can animate. */
  opacity?: Animated<number>
  antiAlias?: boolean
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

export interface TextProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  /**
   * Read once per commit: there is no text value slot, so a SharedValue here
   * would never animate.
   */
  text: string
  fontSize?: Animated<number>
  fontFamily?: string
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
}

export interface NoiseProps {
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
}

export type PaintComponentProps = PaintProps
