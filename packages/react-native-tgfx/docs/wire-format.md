# Draw-program wire format

The binary program `src/compiler/writer.ts` writes and `cpp/TgfxScene.cpp` reads.
`SCENE_VERSION` in the writer is the current version; the reader rejects anything
else outright, so every entry below is a break rather than a negotiation.

## Layout

A flat `Float64Array` written in tree preorder, in words:

    [0]         VERSION
    [1]         total word count
    [2]         first word of the slot-patch table
    [3..]       node stream
    [patch]     count, then (wordIndex, slotIndex) pairs

Strings (path data, text, image sources, shader source) are rare and
variable-width, so they travel beside the buffer in a string table and the buffer
holds their indices. A field backed by a Reanimated SharedValue is written as 0
and recorded in the patch table, so the engine knows which words to resolve
against the live value array each frame.

## Versions

- **6** — shader uniform floats may carry patch entries. The layout is unchanged,
  but a reader that walks them with a plain read leaves the patch cursor
  stranded, freezing every animated field after them.
- **7** — adds the Fill kind, which an older reader would not draw.
- **8** — images travel as an integer handle into the native ImageRegistry
  instead of a base64 string-table entry, and carry a full paint, the extended
  fit set, a sampling mode and an optional source rect. Adds the image shader
  kind.
- **9** — a runtime shader carries a preamble string and its function names after
  the body, so an older reader would read them as the uniform count.
- **10** — a paint whose flags carry bit 4 writes a filter block (blend mode,
  colour filter, image filter) between the alpha and the shader. Unfiltered
  paints are byte-identical to 9, but an older reader would take the block for a
  shader.
- **11** — text carries a weight/style/spacing block and a paragraph block (wrap
  width, alignment, line height, maxLines, ellipsis) an older reader would walk
  straight past into the paint. Adds the text-path kind.
- **12** — a runtime shader carries a child count and that many nested shader
  payloads after its uniforms, which an older reader would take for a paint.
- **13** — adds the camera-frame kind, which carries children like a group but
  derives its transform from the live frame, so an older reader would take its
  image handle for a node kind.
- **14** — text carries a run list (a count, then per run the string, the face it
  overrides and an optional colour) where it used to carry one string before the
  font block. A `<Text>` with no `<Span>` children writes one run that overrides
  nothing, but the words moved either way, so an older reader would take the
  count for a string index.
- **15** — adds the glyph kind, whose ids and positions an older reader would
  take for a paragraph block.
- **16** — a paint whose flags carry bit 8 writes four animated colour channels
  (r, g, b, a in 0..1) between the flags and the stroke width. The packed colour
  word is still there and still correct, but an older reader would take the first
  channel for the stroke width.
- **17** — a paint whose flags carry bit 16 writes a miter limit between the join
  and the alpha, and the font block's italic word became a style bitfield (1
  italic, 2 faux bold, 4 faux italic). Text that sets neither faux bit is
  byte-identical to 16, but a paint with a miter limit shifts everything after it.
- **18** — adds the group-layer kind (13): a `<Group>` that clips or layers writes
  a flags word after its transform ops, then an optional clip block (kind, then a
  rect, a round rect, or a path string) and an optional layer alpha. A group that
  does neither still writes kind 0 and is byte-identical to 17, so only the groups
  that use the new props cost anything.
- **19** — a `<Path>` writes one effect-flags word after its path string (1 trim,
  2 dash, 4 corner, 8 even-odd fill), then the block each set bit needs. The word
  is always there, so an older reader would take it for the paint's colour; trim
  bounds and dash phase are value slots, since line-drawing is the point of trim.
- **20** — adds colour-filter kind 2 (luma, no payload), and the drop-shadow's
  shadow-only word became a flags word (1 shadow only, 2 inner). Neither shifts a
  word, so the cursor stays aligned either way: an older reader simply drops a
  luma filter, and renders an inner shadow as an ordinary shadow-only one.
- **21** — adds shader kinds 8 (blend: a mode, a child count, then that many nested
  shader payloads) and 9 (colour: one packed word). An older reader would take the
  blend mode for a gradient's first coordinate. Also adds colour-filter kind 4 and
  image-filter kind 2 (compose: two nested filter payloads), which an older reader
  would take for a matrix and a blur respectively.
