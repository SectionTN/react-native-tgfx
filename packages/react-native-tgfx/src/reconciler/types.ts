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
  Paint: 'tgfx_paint',
  LinearGradient: 'tgfx_lineargradient',
  RadialGradient: 'tgfx_radialgradient',
  SweepGradient: 'tgfx_sweepgradient',
  DiamondGradient: 'tgfx_diamondgradient',
  FractalNoise: 'tgfx_fractalnoise',
  Turbulence: 'tgfx_turbulence',
  Shader: 'tgfx_shader',
  Fill: 'tgfx_fill',
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
