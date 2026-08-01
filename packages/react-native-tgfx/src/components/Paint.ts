import type { FC } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  LinearGradientProps,
  NoiseProps,
  PaintComponentProps,
  RadialGradientProps,
  ShaderProps,
  SweepGradientProps,
} from '../types'

/**
 * Declarative paint. As a child of a shape it overrides that shape's paint; as
 * a child of a `<Group>` it sets the inherited default paint for descendants. A
 * gradient child (`<LinearGradient>` / `<RadialGradient>`) sets its shader.
 */
export const Paint = NodeType.Paint as unknown as FC<PaintComponentProps>

/** Linear gradient shader; use inside a shape or `<Paint>`. */
export const LinearGradient = NodeType.LinearGradient as unknown as FC<LinearGradientProps>

/** Radial gradient shader; use inside a shape or `<Paint>`. */
export const RadialGradient = NodeType.RadialGradient as unknown as FC<RadialGradientProps>

/** Sweep (conic) gradient shader. `start`/`end` are in degrees, as in Skia. */
export const SweepGradient = NodeType.SweepGradient as unknown as FC<SweepGradientProps>

/** Diamond gradient shader, drawn from the center to the diamond's vertices. */
export const DiamondGradient = NodeType.DiamondGradient as unknown as FC<RadialGradientProps>

/** Perlin fractal-noise shader. */
export const FractalNoise = NodeType.FractalNoise as unknown as FC<NoiseProps>

/**
 * A runtime shader. `source` is SkSL (the subset tgfx can translate); `uniforms`
 * supplies a value per declared uniform.
 */
export const Shader = NodeType.Shader as unknown as FC<ShaderProps>

/** Perlin turbulence shader — like fractal noise but with sharper patterns. */
export const Turbulence = NodeType.Turbulence as unknown as FC<NoiseProps>
