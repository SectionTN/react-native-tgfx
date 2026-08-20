// Element factories: the imperative constructors behind every JSX component.
// Each returns the same plain host node the reconciler would produce, with no
// normalization of its own — the compiler is the single normalizer — so a
// factory tree and its JSX equivalent compile to byte-identical programs.
import { NodeType, type Node, type NodeTypeName } from './reconciler/types'
import type {
  AlphaThresholdProps,
  AtlasProps,
  BackdropProps,
  BlendColorProps,
  BlendProps,
  BlurProps,
  CameraFrameProps,
  CircleProps,
  ColorMatrixProps,
  ColorShaderProps,
  CornerPathEffectProps,
  DashPathEffectProps,
  DropShadowProps,
  FilmGrainProps,
  GlassProps,
  GlyphsProps,
  GroupProps,
  ImageProps,
  ImageShaderProps,
  ImageSVGProps,
  LinearGradientProps,
  LineProps,
  LumaProps,
  NoiseProps,
  OvalProps,
  PaintComponentProps,
  PathProps,
  RadialGradientProps,
  RectProps,
  RoundedRectProps,
  ShaderProps,
  SpanProps,
  SweepGradientProps,
  TextPathProps,
  TextProps,
  VerticesProps,
} from './types'

/**
 * A plain scene node: a type tag, its props, and its children. The imperative
 * counterpart of a rendered JSX element — what the factories below return, what
 * a `Scene` holds, and what the offscreen renderers accept.
 */
export type SceneNode = Node

type ElementProps<P> = Omit<P, 'children'>

/** Factories whose props are all optional can be called with no arguments. */
type Factory<P> =
  Record<string, never> extends ElementProps<P>
    ? (props?: ElementProps<P>, children?: SceneNode[]) => SceneNode
    : (props: ElementProps<P>, children?: SceneNode[]) => SceneNode

const element = <P>(type: NodeTypeName): Factory<P> =>
  ((props?: ElementProps<P>, children?: SceneNode[]): SceneNode => {
    if (
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      props != null &&
      typeof props !== 'object'
    ) {
      // Catches text('hi') — and plain-JS callers of the renamed font utility:
      // textPath(text, style) is now textToPath; this textPath builds a node.
      throw new Error(
        `[tgfx] the ${type.slice(5)} factory takes a props object, got ${typeof props}.` +
          (type === NodeType.TextPath
            ? ' For SVG path data from text, call textToPath().'
            : '')
      )
    }
    return {
      type,
      props: (props ?? {}) as Record<string, unknown>,
      children: children ?? [],
    }
  }) as Factory<P>

/** Imperative `<Group>`: shared transform / opacity / inherited paint. */
export const group = element<GroupProps>(NodeType.Group)
/** Imperative `<Rect>`. */
export const rect = element<RectProps>(NodeType.Rect)
/** Imperative `<RoundedRect>`. */
export const rrect = element<RoundedRectProps>(NodeType.RoundedRect)
/** Imperative `<Oval>`. */
export const oval = element<OvalProps>(NodeType.Oval)
/** Imperative `<Circle>`. */
export const circle = element<CircleProps>(NodeType.Circle)
/** Imperative `<Line>`. */
export const line = element<LineProps>(NodeType.Line)
/** Imperative `<Path>`. */
export const path = element<PathProps>(NodeType.Path)
/** Imperative `<Image>`. */
export const image = element<ImageProps>(NodeType.Image)
/**
 * Imperative `<ImageSVG>`. The same host node as {@link image} — an SVG source
 * already becomes an image handle at load — typed for SVG props.
 */
export const imageSvg = element<ImageSVGProps>(NodeType.Image)
/** Imperative `<Text>`: `text({ text: 'hi' })`, or spans as children. */
export const text = element<TextProps>(NodeType.Text)
/** Imperative `<Span>`: one styled stretch inside `text()` or `textPath()`. */
export const span = element<SpanProps>(NodeType.Span)
/** Imperative `<Glyphs>`: glyphs you positioned yourself. */
export const glyphs = element<GlyphsProps>(NodeType.Glyphs)
/** Imperative `<TextPath>`: text laid along an SVG path. */
export const textPath = element<TextPathProps>(NodeType.TextPath)
/** Imperative `<Fill>`: fills the whole canvas. */
export const fill = element<PaintComponentProps>(NodeType.Fill)
/** Imperative `<Atlas>`: many sprites from one image in a single node. */
export const atlas = element<AtlasProps>(NodeType.Atlas)
/** Imperative `<Vertices>`: an arbitrary triangle mesh. */
export const vertices = element<VerticesProps>(NodeType.Vertices)
/** Imperative `<BackdropBlur>`: a frosted panel over what is drawn beneath. */
export const backdropBlur = element<BackdropProps>(NodeType.Backdrop)
/** Imperative `<Glass>`: liquid glass from tgfx's own material. */
export const glass = element<GlassProps>(NodeType.Glass)
/** Imperative `<CameraFrame>`: a live camera frame under the scene. */
export const cameraFrame = element<CameraFrameProps>(NodeType.CameraFrame)
/** Imperative `<Paint>`: overrides a shape's paint or a group's defaults. */
export const paint = element<PaintComponentProps>(NodeType.Paint)
/** Imperative `<LinearGradient>`; use as a shape or `paint()` child. */
export const linearGradient = element<LinearGradientProps>(
  NodeType.LinearGradient
)
/** Imperative `<RadialGradient>`; use as a shape or `paint()` child. */
export const radialGradient = element<RadialGradientProps>(
  NodeType.RadialGradient
)
/** Imperative `<SweepGradient>`. `start`/`end` are in degrees. */
export const sweepGradient = element<SweepGradientProps>(NodeType.SweepGradient)
/** Imperative `<DiamondGradient>`. */
export const diamondGradient = element<RadialGradientProps>(
  NodeType.DiamondGradient
)
/** Imperative `<Shader>`: a runtime SkSL shader with uniforms. */
export const shader = element<ShaderProps>(NodeType.Shader)
/** Imperative `<ImageShader>`: an image as a paint source. */
export const imageShader = element<ImageShaderProps>(NodeType.ImageShader)
/** Imperative `<ColorShader>`: a solid colour as a shader input. */
export const colorShader = element<ColorShaderProps>(NodeType.ColorShader)
/** Imperative `<Blend>`: folds its shader children together with `mode`. */
export const blend = element<BlendProps>(NodeType.Blend)
/** Imperative `<BlendColor>`: tints the drawing with a constant colour. */
export const blendColor = element<BlendColorProps>(NodeType.BlendColor)
/** Imperative `<Blur>`: Gaussian blur image filter. */
export const blur = element<BlurProps>(NodeType.Blur)
/** Imperative `<DropShadow>`. */
export const dropShadow = element<DropShadowProps>(NodeType.DropShadow)
/** Imperative `<ColorMatrix>`: a 4x5 colour matrix. */
export const colorMatrix = element<ColorMatrixProps>(NodeType.ColorMatrix)
/** Imperative `<Luma>`: luminance as alpha. */
export const luma = element<LumaProps>(NodeType.Luma)
/** Imperative `<AlphaThreshold>`: translucency to a hard edge. */
export const alphaThreshold = element<AlphaThresholdProps>(
  NodeType.AlphaThreshold
)
/** Imperative `<FilmGrain>`: film grain over a `group()`. */
export const filmGrain = element<FilmGrainProps>(NodeType.FilmGrain)
/** Imperative `<FractalNoise>`. */
export const fractalNoise = element<NoiseProps>(NodeType.FractalNoise)
/** Imperative `<Turbulence>`. */
export const turbulence = element<NoiseProps>(NodeType.Turbulence)
/** Imperative `<DashPathEffect>`: dashes its `path()`. */
export const dashPathEffect = element<DashPathEffectProps>(
  NodeType.DashPathEffect
)
/** Imperative `<CornerPathEffect>`: rounds its `path()`'s corners. */
export const cornerPathEffect = element<CornerPathEffectProps>(
  NodeType.CornerPathEffect
)

/** {@link mask}'s props: {@link MaskProps} with scene nodes for the matte. */
export interface MaskElementProps {
  mode?: 'alpha' | 'luminance'
  /** The drawing whose alpha or luminance does the masking. */
  mask: SceneNode | SceneNode[]
}

/**
 * Imperative `<Mask>`: hides its children through another drawing. Builds the
 * same MaskSource wrapper the component does, so the compiler can tell the
 * matte and the content apart.
 */
export const mask = (
  props: MaskElementProps,
  children?: SceneNode[]
): SceneNode => ({
  type: NodeType.Mask,
  props: { mode: props.mode },
  children: [
    {
      type: NodeType.MaskSource,
      props: {},
      children: ([] as SceneNode[]).concat(props.mask),
    },
    ...(children ?? []),
  ],
})
