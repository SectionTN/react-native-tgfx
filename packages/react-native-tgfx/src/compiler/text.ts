import type { FontProps, ParagraphProps } from '../types'
import { resolveNumber } from './values'
import type { SceneWriter } from './writer'

/** Mirrored by TextAlign in cpp/TextLayout.hpp. */
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
  w.push(p.fontStyle === 'italic' ? 1 : 0)
  w.push(resolveNumber(p.letterSpacing, 0))
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
    letterSpacing: props.letterSpacing ?? 0,
    width: props.width ?? 0,
    align: alignCode(props.textAlign),
    lineHeight: props.lineHeight ?? 0,
    maxLines: props.maxLines ?? 0,
    ellipsis: props.ellipsis ?? '',
  }
}
