import type { FC } from 'react'
import { NodeType } from '../reconciler/types'
import type {
  CameraFrameProps,
  CircleProps,
  ImageProps,
  AtlasProps,
  LineProps,
  OvalProps,
  PaintComponentProps,
  PathProps,
  RectProps,
  RoundedRectProps,
  GlyphsProps,
  SpanProps,
  TextPathProps,
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

/**
 * One styled stretch inside a `<Text>` or `<TextPath>`. Spans lay out as one
 * paragraph — they wrap and align together — and each draws with the face and
 * colour it overrides. A `<Text>` with spans ignores its own `text` prop.
 */
export const Span = NodeType.Span as unknown as FC<SpanProps>

/**
 * Glyphs you positioned yourself, drawn in one run. See {@link GlyphsProps}: no
 * shaping and no fallback, which is the point — `<Text>` does all of that.
 */
export const Glyphs = NodeType.Glyphs as unknown as FC<GlyphsProps>

/** Bitmap image drawn into the destination rect with the given `fit`. */
export const Image = NodeType.Image as unknown as FC<ImageProps>

/**
 * Many sprites from one image in a single node — the fast path for particle
 * systems and tile maps, where N `<Image>` nodes would be N nodes to compile,
 * paint and read. The GPU batches either form the same way.
 */
export const Atlas = NodeType.Atlas as unknown as FC<AtlasProps>

/**
 * Text with its first baseline at (`x`, `y`). Breaks at `\n`, and wraps inside
 * `width` when one is given.
 */
export const Text = NodeType.Text as unknown as FC<TextProps>

/** Text laid along an SVG path, one glyph per tangent. */
export const TextPath = NodeType.TextPath as unknown as FC<TextPathProps>

/**
 * Fills the whole canvas, so a runtime shader does not need to be told the
 * canvas size to cover it. The tgfx counterpart of Skia's `<Fill>`.
 *
 * Coverage comes from the device-space clip, so a transform on an enclosing
 * `<Group>` moves the paint but not the area filled, as it does in Skia.
 */
export const Fill = NodeType.Fill as unknown as FC<PaintComponentProps>

/**
 * A live camera frame, scaled to cover the canvas, with the scene drawn over it.
 *
 * Its children are laid out in **frame pixel** coordinates and share the one
 * matrix that places the frame, so an overlay derived from the frame — a
 * detector's box, a face contour — cannot drift from the image whatever the
 * canvas size is. Pass detector output through unchanged; do not scale it.
 *
 * The frame arrives as a hardware-buffer handle
 * (`imageFromNativeBuffer` + `image.setNativeBuffer`), which is imported
 * straight to a GPU texture: the pixels are never copied, never encoded and
 * never touched by the CPU.
 */
export const CameraFrame =
  NodeType.CameraFrame as unknown as FC<CameraFrameProps>
