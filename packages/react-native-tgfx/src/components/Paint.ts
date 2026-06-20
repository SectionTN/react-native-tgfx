import { createElement, type ReactElement } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  LinearGradientProps,
  PaintComponentProps,
  RadialGradientProps,
} from '../types'

/**
 * Declarative paint. As a child of a shape it overrides that shape's paint; as
 * a child of a `<Group>` it sets the inherited default paint for descendants. A
 * gradient child (`<LinearGradient>` / `<RadialGradient>`) sets its shader.
 */
export function Paint(props: PaintComponentProps): ReactElement {
  return createElement(NodeType.Paint, props)
}

/** Linear gradient shader; use inside a shape or `<Paint>`. */
export function LinearGradient(props: LinearGradientProps): ReactElement {
  return createElement(NodeType.LinearGradient, props)
}

/** Radial gradient shader; use inside a shape or `<Paint>`. */
export function RadialGradient(props: RadialGradientProps): ReactElement {
  return createElement(NodeType.RadialGradient, props)
}
