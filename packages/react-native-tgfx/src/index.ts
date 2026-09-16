// Public API for react-native-tgfx: a declarative GPU 2D canvas backed by Tencent's tgfx.

export { Canvas } from './components/Canvas'
export { Group } from './components/Group'
export { Mask } from './components/Mask'
export { Image } from './components/Image'
import { TgfxImage as TgfxImageComponent } from './components/drawings'
import type { TgfxImage as TgfxImageHandle } from './types'
/** The host-tag image component; in type positions, the native image handle. */
const TgfxImage = TgfxImageComponent
// eslint-disable-next-line no-redeclare -- deliberate value+type merge
type TgfxImage = TgfxImageHandle
export { TgfxImage }
export type { ImageSourceProps } from './components/Image'
export {
  useCanvasPress,
  dispatchPress,
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
  FilmGrain,
  FractalNoise,
  ImageShader,
  LinearGradient,
  Paint,
  RadialGradient,
  Shader,
  SweepGradient,
  Turbulence,
} from './components/Paint'

export { createHandle } from './imperative'
export { useNode } from './hooks/useNode'
export type { NodeHandle } from './imperative'

export {
  group,
  rect,
  rrect,
  oval,
  circle,
  line,
  path,
  image,
  imageSvg,
  text,
  span,
  glyphs,
  textPath,
  fill,
  atlas,
  vertices,
  backdropBlur,
  glass,
  cameraFrame,
  paint,
  linearGradient,
  radialGradient,
  sweepGradient,
  diamondGradient,
  shader,
  imageShader,
  colorShader,
  blend,
  blendColor,
  blur,
  dropShadow,
  colorMatrix,
  luma,
  alphaThreshold,
  filmGrain,
  fractalNoise,
  turbulence,
  dashPathEffect,
  cornerPathEffect,
  mask,
} from './elements'
export type { SceneNode, MaskElementProps } from './elements'
export { Scene, createScene, sceneFrom } from './scene'
export type {
  SceneTarget,
  SceneOptions,
  SceneStillOptions,
  SceneVectorOptions,
} from './scene'
export { createOffscreenSurface } from './offscreenSurface'
export type { OffscreenSurfaceOptions } from './offscreenSurface'
export type { TgfxOffscreenSurface } from './specs/TgfxOffscreenSurface.nitro'

export { useCameraFrame, createCameraFrameSink } from './hooks/useCameraFrame'
export type {
  CameraFrameOptions,
  CameraFramePosture,
  CameraFrameSink,
  CameraFrameSinkOptions,
  CameraFrameSource,
  FrameLike,
  NativeBufferLike,
} from './hooks/useCameraFrame'
export { useClock, createClock } from './hooks/useClock'
export type { Clock } from './hooks/useClock'
export {
  loadFont,
  loadFonts,
  glyphPositionAtCoordinate,
  measureText,
  rectsForRange,
  glyphIds,
  registeredFontFamilies,
  textToPath,
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
  GlyphPosition,
  LineMeasurement,
  TextBox,
  TextMeasurement,
  TextStyle,
} from './hooks/useFonts'
export {
  getCacheInfo,
  imageFromNativeBuffer,
  imageFromPixels,
  loadImage,
  purgeCaches,
  setImageCacheLimit,
  useImage,
  useImageState,
} from './hooks/useImage'
export type { CacheInfo, ImageState } from './hooks/useImage'
export { loadVideo, useVideo, createVideoPlayer } from './hooks/useVideo'
export type { Video, VideoOptions, VideoPlayer } from './hooks/useVideo'
export {
  SPRITE_FLOATS,
  meshViews,
  useSpriteBuffer,
  useVertexBuffer,
  createSpriteBuffer,
  spriteFloats,
  createVertexBuffer,
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
  FilmGrainProps,
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
