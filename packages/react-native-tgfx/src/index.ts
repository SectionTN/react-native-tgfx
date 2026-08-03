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
} from './components/drawings'
export {
  DiamondGradient,
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
  CanvasHandle,
  CanvasProps,
  CircleProps,
  Color,
  Fit,
  GroupProps,
  ImageProps,
  ImageShaderProps,
  LinearGradientProps,
  LineProps,
  NoiseProps,
  OvalProps,
  PaintComponentProps,
  PaintProps,
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
  TextProps,
  TgfxImage,
  TileMode,
  Transform,
  TransformOp,
  Vector,
} from './types'
