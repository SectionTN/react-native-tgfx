// Public API for react-native-tgfx: a declarative GPU 2D canvas backed by Tencent's tgfx.

export { Canvas } from './components/Canvas'
export { Group } from './components/Group'
export {
  CameraFrame,
  Circle,
  Glyphs,
  Fill,
  Image,
  Line,
  Oval,
  Path,
  Rect,
  RoundedRect,
  Span,
  Text,
  TextPath,
} from './components/drawings'
export {
  BlendColor,
  Blur,
  ColorMatrix,
  DiamondGradient,
  DropShadow,
  FractalNoise,
  ImageShader,
  LinearGradient,
  Paint,
  RadialGradient,
  Shader,
  SweepGradient,
  Turbulence,
} from './components/Paint'

export { useNode } from './imperative'
export type { NodeHandle } from './imperative'

export { useCameraFrame } from './hooks/useCameraFrame'
export type {
  CameraFrameOptions,
  CameraFramePosture,
  CameraFrameSource,
  FrameLike,
  NativeBufferLike,
} from './hooks/useCameraFrame'
export { useClock } from './hooks/useClock'
export {
  loadFont,
  loadFonts,
  measureText,
  glyphIds,
  registeredFontFamilies,
  textPath,
  useFonts,
  useFontsState,
} from './hooks/useFonts'
export type {
  FontsState,
  FontSource,
  LineMeasurement,
  TextMeasurement,
  TextStyle,
} from './hooks/useFonts'
export {
  imageFromNativeBuffer,
  loadImage,
  setImageCacheLimit,
  useImage,
  useImageState,
} from './hooks/useImage'
export type { ImageState } from './hooks/useImage'
export type { PixelFormat } from './specs/TgfxImage.nitro'

export { TgfxNativeView } from './views/TgfxNativeView'
export type { TgfxViewRef } from './views/TgfxNativeView'

export type {
  Animated,
  BlendColorProps,
  BlendMode,
  BlurProps,
  CameraFrameProps,
  CanvasHandle,
  CanvasProps,
  CircleProps,
  Color,
  ColorComponents,
  ColorMatrixProps,
  DropShadowProps,
  Fit,
  FontProps,
  FontWeight,
  GlyphsProps,
  GroupProps,
  ImageProps,
  ImageShaderProps,
  LinearGradientProps,
  LineProps,
  NoiseProps,
  OvalProps,
  PaintComponentProps,
  PaintProps,
  ParagraphProps,
  PathProps,
  PlacedGlyph,
  RadialGradientProps,
  RectProps,
  RoundedRectProps,
  Sampling,
  ShaderProps,
  SpanProps,
  SrcRect,
  SweepGradientProps,
  SharedValueLike,
  Snapshot,
  SnapshotFormat,
  SnapshotOptions,
  TextPathProps,
  TextProps,
  TgfxImage,
  TileMode,
  Transform,
  TransformOp,
  Vector,
} from './types'
