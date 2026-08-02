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
  LinearGradient,
  Paint,
  RadialGradient,
  Shader,
  SweepGradient,
  Turbulence,
} from './components/Paint'

export { useClock } from './hooks/useClock'
export { useImage, useImageState } from './hooks/useImage'
export type { ImageState } from './hooks/useImage'

export { TgfxNativeView } from './views/TgfxNativeView'
export type { TgfxViewRef } from './views/TgfxNativeView'

export type {
  Animated,
  CanvasProps,
  CircleProps,
  Color,
  GroupProps,
  ImageProps,
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
  ShaderProps,
  SweepGradientProps,
  SharedValueLike,
  TextProps,
  Transform,
  TransformOp,
  Vector,
} from './types'
