import type { FC } from 'react'
import { NodeType } from '../reconciler/types'
import type { GroupProps } from '../types'

/**
 * Groups children under a shared transform / opacity and supplies inherited
 * paint defaults (color, style, strokeWidth, ...) to descendants.
 */
export const Group = NodeType.Group as unknown as FC<GroupProps>
