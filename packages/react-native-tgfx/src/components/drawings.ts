import { createElement, type ReactElement } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  CircleProps,
  ImageProps,
  LineProps,
  OvalProps,
  PathProps,
  RectProps,
  RoundedRectProps,
  TextProps,
} from '../types'

/** Axis-aligned rectangle. */
export function Rect(props: RectProps): ReactElement {
  return createElement(NodeType.Rect, props)
}

/** Rounded rectangle (`r`, or independent `rx`/`ry`). */
export function RoundedRect(props: RoundedRectProps): ReactElement {
  return createElement(NodeType.RoundedRect, props)
}

/** Ellipse inscribed in the given rectangle. */
export function Oval(props: OvalProps): ReactElement {
  return createElement(NodeType.Oval, props)
}

/** Circle centered at (`cx`, `cy`) with radius `r`. */
export function Circle(props: CircleProps): ReactElement {
  return createElement(NodeType.Circle, props)
}

/** Straight line from (`x1`, `y1`) to (`x2`, `y2`). */
export function Line(props: LineProps): ReactElement {
  return createElement(NodeType.Line, props)
}

/** Vector path from SVG path data. */
export function Path(props: PathProps): ReactElement {
  return createElement(NodeType.Path, props)
}

/** Bitmap image drawn into the destination rect with the given `fit`. */
export function Image(props: ImageProps): ReactElement {
  return createElement(NodeType.Image, props)
}

/** A run of text with its baseline at (`x`, `y`). */
export function Text(props: TextProps): ReactElement {
  return createElement(NodeType.Text, props)
}
