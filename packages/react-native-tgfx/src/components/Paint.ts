import { createElement, type ReactElement } from 'react'
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
export function Paint(props: PaintComponentProps): ReactElement {
  return createElement(NodeType.Paint, props)
}

/** Linear gradient shader; use inside a shape or `<Paint>`. */
export function LinearGradient(props: LinearGradientProps): ReactElement {
  return createElement(NodeType.LinearGradient, props)
}

/** Radial gradient shader; use inside a shape or `<Paint>`. */
export function RadialGradient(props: RadialGradientProps): ReactElement {
  return createElement(NodeType.RadialGradient, props)
}

/** Sweep (conic) gradient shader. `start`/`end` are in degrees, as in Skia. */
export function SweepGradient(props: SweepGradientProps): ReactElement {
  return createElement(NodeType.SweepGradient, props)
}

/** Diamond gradient shader, drawn from the center to the diamond's vertices. */
export function DiamondGradient(props: RadialGradientProps): ReactElement {
  return createElement(NodeType.DiamondGradient, props)
}

/** Perlin fractal-noise shader. */
export function FractalNoise(props: NoiseProps): ReactElement {
  return createElement(NodeType.FractalNoise, props)
}

/**
 * A runtime shader. `source` is SkSL (the subset tgfx can translate); `uniforms`
 * supplies a value per declared uniform.
 */
export function Shader(props: ShaderProps): ReactElement {
  return createElement(NodeType.Shader, props)
}

/** Perlin turbulence shader — like fractal noise but with sharper patterns. */
export function Turbulence(props: NoiseProps): ReactElement {
  return createElement(NodeType.Turbulence, props)
}
