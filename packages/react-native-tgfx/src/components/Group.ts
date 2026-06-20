import { createElement, type ReactElement } from 'react'
import { NodeType } from '../reconciler/types'
import type { GroupProps } from '../types'

/**
 * Groups children under a shared transform / opacity and supplies inherited
 * paint defaults (color, style, strokeWidth, ...) to descendants.
 */
export function Group(props: GroupProps): ReactElement {
  return createElement(NodeType.Group, props)
}
