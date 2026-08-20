import type { FC } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  BlendColorProps,
  BlendProps,
  BlurProps,
  ColorShaderProps,
  CornerPathEffectProps,
  DashPathEffectProps,
  AlphaThresholdProps,
  LumaProps,
  ColorMatrixProps,
  DropShadowProps,
  ImageShaderProps,
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
export const LinearGradient =
  NodeType.LinearGradient as unknown as FC<LinearGradientProps>

/** Radial gradient shader; use inside a shape or `<Paint>`. */
export const RadialGradient =
  NodeType.RadialGradient as unknown as FC<RadialGradientProps>

/** Sweep (conic) gradient shader. `start`/`end` are in degrees, as in Skia. */
export const SweepGradient =
  NodeType.SweepGradient as unknown as FC<SweepGradientProps>

/** Diamond gradient shader, drawn from the center to the diamond's vertices. */
export const DiamondGradient =
  NodeType.DiamondGradient as unknown as FC<RadialGradientProps>

/** Perlin fractal-noise shader. */
export const FractalNoise = NodeType.FractalNoise as unknown as FC<NoiseProps>

/**
 * A runtime shader. `source` is SkSL (the subset tgfx can translate); `uniforms`
 * supplies a value per declared uniform.
 */
export const Shader = NodeType.Shader as unknown as FC<ShaderProps>

/** Perlin turbulence shader — like fractal noise but with sharper patterns. */
export const Turbulence = NodeType.Turbulence as unknown as FC<NoiseProps>

/**
 * An image as a paint source: textured fills, image-backed masks, tiled
 * patterns. Use it wherever a gradient goes — inside a shape or a `<Paint>`.
 */
export const ImageShader =
  NodeType.ImageShader as unknown as FC<ImageShaderProps>

/**
 * A 4x5 colour matrix — saturation, hue rotation, greyscale, channel swaps.
 * A paint child, like a gradient. Cheap: it is one more stage in the fragment
 * shader, with no offscreen and no bounds change.
 */
export const ColorMatrix =
  NodeType.ColorMatrix as unknown as FC<ColorMatrixProps>

/** Blends a constant colour into the drawing's own colours — a tint. */
export const BlendColor = NodeType.BlendColor as unknown as FC<BlendColorProps>

/**
 * Gaussian blur. An *image* filter: the drawing goes through an offscreen layer
 * and grows past its geometry, so it costs a render target per drawing.
 */
export const Blur = NodeType.Blur as unknown as FC<BlurProps>

/** Drop shadow under the drawing. Same offscreen cost as `<Blur>`. */
export const DropShadow = NodeType.DropShadow as unknown as FC<DropShadowProps>

/** Folds its shader children together with `mode`. */
export const Blend = NodeType.Blend as unknown as FC<BlendProps>

/** A solid colour as a shader input. */
export const ColorShader = NodeType.ColorShader as unknown as FC<ColorShaderProps>

/** Luminance as alpha. A colour filter, so it costs no offscreen. */
export const Luma = NodeType.Luma as unknown as FC<LumaProps>

/** Translucency to a hard edge. A colour filter, so it costs no offscreen. */
export const AlphaThreshold =
  NodeType.AlphaThreshold as unknown as FC<AlphaThresholdProps>

/** Dashes its `<Path>`. Reshapes the geometry, so it needs no offscreen. */
export const DashPathEffect =
  NodeType.DashPathEffect as unknown as FC<DashPathEffectProps>

/** Rounds the corners of its `<Path>`, before any stroke. */
export const CornerPathEffect =
  NodeType.CornerPathEffect as unknown as FC<CornerPathEffectProps>
