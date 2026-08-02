import type { FC } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  CircleProps,
  ImageProps,
  LineProps,
  OvalProps,
  PaintComponentProps,
  PathProps,
  RectProps,
  RoundedRectProps,
  TextProps,
} from '../types'

/** Axis-aligned rectangle. */
export const Rect = NodeType.Rect as unknown as FC<RectProps>

/** Rounded rectangle (`r`, or independent `rx`/`ry`). */
export const RoundedRect =
  NodeType.RoundedRect as unknown as FC<RoundedRectProps>

/** Ellipse inscribed in the given rectangle. */
export const Oval = NodeType.Oval as unknown as FC<OvalProps>

/** Circle centered at (`cx`, `cy`) with radius `r`. */
export const Circle = NodeType.Circle as unknown as FC<CircleProps>

/** Straight line from (`x1`, `y1`) to (`x2`, `y2`). */
export const Line = NodeType.Line as unknown as FC<LineProps>

/** Vector path from SVG path data. */
export const Path = NodeType.Path as unknown as FC<PathProps>

/** Bitmap image drawn into the destination rect with the given `fit`. */
export const Image = NodeType.Image as unknown as FC<ImageProps>

/** A run of text with its baseline at (`x`, `y`). */
export const Text = NodeType.Text as unknown as FC<TextProps>

/**
 * Fills the whole canvas, so a runtime shader does not need to be told the
 * canvas size to cover it. The tgfx counterpart of Skia's `<Fill>`.
 *
 * Coverage comes from the device-space clip, so a transform on an enclosing
 * `<Group>` moves the paint but not the area filled, as it does in Skia.
 */
export const Fill = NodeType.Fill as unknown as FC<PaintComponentProps>
