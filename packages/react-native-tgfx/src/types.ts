import type { ReactNode } from 'react'
import type { Color } from './compiler/colors'
import type { Transform, Vector } from './compiler/transform'

export type { Color } from './compiler/colors'
export type { Transform, TransformOp, Vector } from './compiler/transform'

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
  /** Paint-wide alpha multiplier in [0, 1]. */
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
  /** SVG path data string. */
  path: Animated<string>
}

export interface ImageProps {
  x: Animated<number>
  y: Animated<number>
  width: Animated<number>
  height: Animated<number>
  /** Base64-encoded (PNG/JPEG/WebP) image bytes — see `useImage`. */
  image: Animated<string>
  fit?: 'fill' | 'contain' | 'cover'
}

export interface TextProps extends PaintProps {
  x: Animated<number>
  y: Animated<number>
  text: Animated<string>
  fontSize?: Animated<number>
  fontFamily?: string
}

export interface CanvasProps {
  style?: object
  children?: ReactNode
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

export interface ShaderProps {
  /** SkSL source with a `vec4 main(vec2 pos)` entry point. */
  source: string
  uniforms?: Record<string, number | number[]>
}

export interface NoiseProps {
  freqX?: number
  freqY?: number
  octaves?: number
  seed?: number
}

export type PaintComponentProps = PaintProps
