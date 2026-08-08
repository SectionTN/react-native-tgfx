import { createElement, type FC } from 'react'
import { NodeType } from '../reconciler/types'
import type { MaskProps } from '../types'

const MaskNode = NodeType.Mask as unknown as FC<{
  mode?: string
  children?: unknown
}>
const MaskSource = NodeType.MaskSource as unknown as FC<{ children?: unknown }>

/**
 * Hides its children through another drawing's alpha or luminance. The mask
 * arrives as a prop, as in react-native-skia, and is put into its own host node
 * so the compiler can tell the two child lists apart.
 */
export const Mask: FC<MaskProps> = ({ mode, mask, children }) =>
  createElement(
    MaskNode,
    { mode },
    createElement(MaskSource, { key: 'mask' }, mask),
    children
  )
