/**
 * Host element type tags understood by the tgfx reconciler. Each declarative
 * component (`<Rect>`, `<Circle>`, ...) creates a host element with one of these
 * string types; the reconciler stores them as plain {@link Node}s and the
 * compiler turns a tree of them into the JSON draw-program.
 */
export const NodeType = {
  Group: 'tgfx_group',
  Rect: 'tgfx_rect',
  RoundedRect: 'tgfx_rrect',
  Oval: 'tgfx_oval',
  Circle: 'tgfx_circle',
  Line: 'tgfx_line',
  Path: 'tgfx_path',
  Image: 'tgfx_image',
  Text: 'tgfx_text',
  Span: 'tgfx_span',
  Glyphs: 'tgfx_glyphs',
  TextPath: 'tgfx_textpath',
  Paint: 'tgfx_paint',
  LinearGradient: 'tgfx_lineargradient',
  RadialGradient: 'tgfx_radialgradient',
  SweepGradient: 'tgfx_sweepgradient',
  DiamondGradient: 'tgfx_diamondgradient',
  FractalNoise: 'tgfx_fractalnoise',
  Turbulence: 'tgfx_turbulence',
  Shader: 'tgfx_shader',
  ImageShader: 'tgfx_imageshader',
  ColorMatrix: 'tgfx_colormatrix',
  BlendColor: 'tgfx_blendcolor',
  Blur: 'tgfx_blur',
  DropShadow: 'tgfx_dropshadow',
  Mask: 'tgfx_mask',
  MaskSource: 'tgfx_masksource',
  Blend: 'tgfx_blend',
  ColorShader: 'tgfx_colorshader',
  Luma: 'tgfx_luma',
  DashPathEffect: 'tgfx_dash',
  CornerPathEffect: 'tgfx_corner',
  Fill: 'tgfx_fill',
  CameraFrame: 'tgfx_cameraframe',
  Atlas: 'tgfx_atlas',
  Vertices: 'tgfx_vertices',
  Backdrop: 'tgfx_backdrop',
  Glass: 'tgfx_glass',
} as const

export type NodeTypeName = (typeof NodeType)[keyof typeof NodeType]

/** A reconciled host node: a type tag, its props, and its children. */
export interface Node {
  type: NodeTypeName
  props: Record<string, unknown>
  children: Node[]
}

export function createNode(
  type: NodeTypeName,
  props: Record<string, unknown>
): Node {
  return { type, props, children: [] }
}
