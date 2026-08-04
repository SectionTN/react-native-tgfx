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
