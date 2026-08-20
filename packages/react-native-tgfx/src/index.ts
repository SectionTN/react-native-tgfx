// Public API for react-native-tgfx: a declarative GPU 2D canvas backed by Tencent's tgfx.

export { Canvas } from './components/Canvas'
export { Group } from './components/Group'
export { Mask } from './components/Mask'
export {
  useCanvasPress,
  type CanvasPress,
  type CanvasPressOptions,
} from './hooks/useCanvasPress'
export {
  useOffscreenImage,
  useOffscreenSvg,
  useOffscreenPdf,
  type PdfExportState,
  useDerivedImage,
  type Derivation,
} from './hooks/useOffscreen'
export {
  renderToImage,
  renderToPdf,
  renderToSvg,
  type RenderToImageOptions,
  type PdfPage,
  type RenderToSvgOptions,
  type PdfMetadata,
} from './offscreen'
export {
  CameraFrame,
  Circle,
  Glyphs,
  Fill,
  Image,
  ImageSVG,
  Atlas,
  Vertices,
  BackdropBlur,
  Glass,
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
  Blend,
  Blur,
  ColorShader,
  CornerPathEffect,
  DashPathEffect,
  AlphaThreshold,
  Luma,
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

export { createHandle, useNode } from './imperative'
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
export {
  pathBounds,
  pathContains,
  pathLength,
  pathOp,
  pathPointAtLength,
  pathSegment,
  pathTransform,
} from './hooks/usePath'
export type { ClipRect } from './types'
export type { PathBounds, PathMatrix, PathOp, PathPoint } from './hooks/usePath'
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
export { loadVideo, useVideo } from './hooks/useVideo'
export type { Video, VideoOptions } from './hooks/useVideo'
export {
  SPRITE_FLOATS,
  meshViews,
  useSpriteBuffer,
  useVertexBuffer,
} from './hooks/useBuffers'
export type {
  MeshViews,
  SpriteBuffer,
  VertexBuffer,
  VertexBufferOptions,
} from './hooks/useBuffers'
export type {
  ImageSampling,
  PixelFormat,
  Orientation,
} from './specs/TgfxImage.nitro'
export type { TgfxVideo } from './specs/TgfxVideo.nitro'
export type {
  NativeSnapshot,
  NativeSnapshotOptions,
  TgfxViewMethods,
  TgfxViewProps,
} from './specs/TgfxView.nitro'

export { TgfxNativeView } from './views/TgfxNativeView'
export type { TgfxViewRef } from './views/TgfxNativeView'

export type {
  Animated,
  BlendColorProps,
  BlendMode,
  BlendProps,
  MaskProps,
  HitTestOptions,
  HitTestResult,
  BlurProps,
  ColorShaderProps,
  CornerPathEffectProps,
  DashPathEffectProps,
  AlphaThresholdProps,
  LumaProps,
  CameraFrameProps,
  CanvasHandle,
  CanvasProps,
  CircleProps,
  Color,
  ColorComponents,
  ColorMatrixProps,
  ColorSpace,
  DropShadowProps,
  Fit,
  FontProps,
  FontWeight,
  GlyphsProps,
  GroupProps,
  ImageProps,
  ImageSVGProps,
  ImageLike,
  AtlasProps,
  AtlasSprite,
  VerticesProps,
  BackdropProps,
  GlassProps,
  MeshTopology,
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
  TransformAngle,
  TransformNumber,
  TransformOp,
  UniformValue,
  Vector,
  Viewport,
  AnimatedVector,
} from './types'
