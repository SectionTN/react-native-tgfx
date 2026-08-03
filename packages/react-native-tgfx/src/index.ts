// Public API for react-native-tgfx — a declarative GPU 2D canvas for React
// Native backed by Tencent's tgfx, built with Nitro.

export { Canvas } from './components/Canvas'
export { Group } from './components/Group'
export {
  Circle,
  Fill,
  Image,
  Line,
  Oval,
  Path,
  Rect,
  RoundedRect,
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

export { useClock } from './hooks/useClock'
export {
  loadFont,
  loadFonts,
  measureText,
  registeredFontFamilies,
  useFonts,
} from './hooks/useFonts'
export type { FontSource, TextMeasurement, TextStyle } from './hooks/useFonts'
export {
  imageFromNativeBuffer,
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
  CanvasHandle,
  CanvasProps,
  CircleProps,
  Color,
  ColorMatrixProps,
  DropShadowProps,
  Fit,
  FontProps,
  FontWeight,
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
  RadialGradientProps,
  RectProps,
  RoundedRectProps,
  Sampling,
  ShaderProps,
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
