import { NodeType, type Node } from '../reconciler/types'
import type { FontProps, ParagraphProps } from '../types'
import { resolveColor } from './colors'
import { resolveNumber, resolveValue } from './values'
import type { SceneWriter } from './writer'

const ALIGN = { left: 0, center: 1, right: 2 } as const

export function alignCode(align: unknown): number {
  return ALIGN[align as keyof typeof ALIGN] ?? 0
}

/** CSS weight for a `fontWeight` prop. Unknown values fall back to normal. */
export function weightValue(weight: unknown): number {
  if (weight === 'bold') {
    return 700
  }
  if (typeof weight === 'number' && weight >= 1 && weight <= 1000) {
    return Math.round(weight)
  }
  return 400
}

/**
 * The family/weight/style block `<Text>` and `<TextPath>` share, in the order
 * SceneRenderer::readTextSpec reads it.
 */
export function writeFont(w: SceneWriter, p: Record<string, unknown>): void {
  w.pushString(p.fontFamily != null ? String(p.fontFamily) : '')
  w.push(weightValue(p.fontWeight))
  // Bit 1 italic, 2 forced faux bold, 4 forced faux italic — one word instead of three.
  w.push(
    (p.fontStyle === 'italic' ? 1 : 0) |
      (p.fauxBold === true ? 2 : 0) |
      (p.fauxItalic === true ? 4 : 0)
  )
  w.push(resolveNumber(p.letterSpacing, 0))
}

/**
 * The run list, read by SceneRenderer::readTextRuns: a count, then per run its
 * string and what it overrides of the paragraph's face. A `<Text>` with no
 * `<Span>` children writes exactly one run that overrides nothing, so a plain
 * label costs one extra word plus a zeroed style block.
 *
 * A run's own `fontSize` is deliberately not animated: the layout is memoised
 * against the paragraph's size, and a second moving size would miss that memo on
 * every frame. 0 means "the paragraph's size", which is the animated one.
 */
export function writeTextRuns(
  w: SceneWriter,
  node: Node,
  props: Record<string, unknown>
): void {
  const spans = node.children.filter((child) => child.type === NodeType.Span)
  if (spans.length === 0) {
    w.push(1)
    writeRun(w, props.text, {})
    return
  }
  w.push(spans.length)
  for (const span of spans) {
    writeRun(w, span.props.text, span.props)
  }
}

function writeRun(
  w: SceneWriter,
  text: unknown,
  p: Record<string, unknown>
): void {
  // A SharedValue string gets a string slot: content changes without a re-encode.
  w.pushStringAnim(text)
  w.pushString(p.fontFamily != null ? String(p.fontFamily) : '')
  // 0, not 400: the paragraph's weight is what an unset span inherits.
  w.push(p.fontWeight !== undefined ? weightValue(p.fontWeight) : 0)
  // 0 inherit, 1 italic, 2 upright — a flag could not say "unset", and an implicit run always is.
  w.push(p.fontStyle === 'italic' ? 1 : p.fontStyle === 'normal' ? 2 : 0)
  w.push(resolveNumber(p.letterSpacing, 0))
  w.push(resolveNumber(p.fontSize, 0))
  const hasColor = p.color !== undefined
  w.push(hasColor ? 1 : 0)
  w.push(hasColor ? resolveColor(resolveValue(p.color) as never) : 0)
}

/** The style block for `measureText`, defaulted the same way the writer does. */
export function fontStyleOf(
  props: Omit<FontProps, 'fontSize'> &
    ParagraphProps & { fontSize?: number } = {}
) {
  return {
    fontSize: props.fontSize ?? 14,
    fontFamily: props.fontFamily ?? '',
    fontWeight: weightValue(props.fontWeight),
    italic: props.fontStyle === 'italic',
    fauxBold: props.fauxBold ?? false,
    fauxItalic: props.fauxItalic ?? false,
    letterSpacing: props.letterSpacing ?? 0,
    width: props.width ?? 0,
    align: alignCode(props.textAlign),
    lineHeight: props.lineHeight ?? 0,
    maxLines: props.maxLines ?? 0,
    ellipsis: props.ellipsis ?? '',
  }
}
