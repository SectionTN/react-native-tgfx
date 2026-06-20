// Public API for react-native-tgfx — a declarative GPU 2D canvas for React
// Native backed by Tencent's tgfx, built with Nitro.

export { Canvas } from './components/Canvas'
export { Group } from './components/Group'
export {
  Circle,
  Image,
  Line,
  Oval,
  Path,
  Rect,
  RoundedRect,
  Text,
} from './components/drawings'
export { LinearGradient, Paint, RadialGradient } from './components/Paint'

export { useImage } from './hooks/useImage'

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
  OvalProps,
  PaintComponentProps,
  PaintProps,
  PathProps,
  RadialGradientProps,
  RectProps,
  RoundedRectProps,
  SharedValueLike,
  TextProps,
  Transform,
  TransformOp,
  Vector,
} from './types'
