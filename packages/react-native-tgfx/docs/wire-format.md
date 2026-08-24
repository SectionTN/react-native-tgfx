# Draw-program wire format

The binary program `src/compiler/writer.ts` writes and `cpp/Scene/TgfxScene.cpp` reads.
`SCENE_VERSION` in the writer is the current version; the reader rejects anything
else outright, so every entry below is a break rather than a negotiation.

## Layout

A flat `Float64Array` written in tree preorder, in words:

    [0]         VERSION
    [1]         total word count
    [2]         first word of the slot-patch table
    [3..]       node stream
    [patch]     count, then (wordIndex, slotIndex) pairs
    [strings]   count, then (wordIndex, stringSlot) pairs

Strings (path data, text, image sources, shader source) are rare and
variable-width, so they travel beside the buffer in a string table and the buffer
holds their indices. A field backed by a Reanimated SharedValue is written as 0
and recorded in the patch table, so the engine knows which words to resolve
against the live value array each frame. A string word backed by a SharedValue
is recorded in the string-patch table the same way, resolved against the live
string array pushed with `setStringValues`.

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
- **22** — adds the mask kind (14): a luminance flag, then a mask child list and a
  content child list, each a count followed by that many nodes. An older reader
  would take the flag for a transform-op count.
- **23** — adds the atlas kind (15): an image handle, a sampling code, a sprite
  count, then seven words per sprite (the source rect's `x, y, width, height`,
  a uniform scale, and the destination `x, y` of the sprite's top-left). One
  node, N sprites — 7 words each against ~16 for an `<Image>`. An older reader
  would take the handle for a
  group's transform-op count.
- **24** — adds the vertices kind (16): a topology word (0 triangles, 1 strip), a
  vertex count, then two words per position; a flag and, if set, two words per
  texture coordinate; a flag and, if set, one packed colour per vertex; then an
  index count and that many indices. Each optional block carries its own flag, so
  the reader never infers presence from a length. Indices are read through the
  same range guard as any other integer and the whole mesh is dropped if one
  points past the vertices. An older reader would take the topology for a group's
  transform-op count.
- **25** — the group flags word gains bit 8: record this subtree once and replay
  the recording. The bit is intent only — the reader clears it when the subtree
  holds anything that resolves per frame — and a group that asks for it becomes a
  `GroupLayer` (13) so the flags word exists at all. An
  older reader ignores the bit and draws the children directly, which is the
  same picture.
- **26** — the imperative-coverage release (#204), all in one break:
  - A **string-patch table** follows the numeric patch table: a count, then
    (wordIndex, stringSlot) pairs. Path data and text-run content words may
    carry entries; the engine resolves them against `setStringValues` pushes,
    re-parsing the path or re-shaping the paragraph on the render thread. An
    older reader would report the program not fully consumed.
  - The **kind word carries bit 64**: a `visible` word (a value slot) follows
    it. A node that resolves below 0.5 is skipped at draw and hit-test — the
    supported pool pattern for variable-count scenes. Absent, a node is
    byte-identical to 25.
  - **Gradient geometry animates**: linear start/end, radial and diamond
    centre/radius, and sweep centre/angles are anim words. The stops block
    gains a leading flags word — bit 1 means each stop colour travels as four
    anim channels instead of one packed word — and stop positions are anim
    words either way.
  - **Filter parameters animate**: blur sigmas, drop-shadow offset and sigmas,
    every colour-matrix entry and the paint's blend-mode word are anim words. A
    drop-shadow flags word gains bit 4 (four live colour channels follow);
    colour-filter kind 5 is kind 1 with four live channels after the packed
    word. A filter with a live parameter is rebuilt per frame; a literal one is
    still built exactly once, at setScene.
  - **Paint enums animate**: the cap and join words are anim words, the miter
    word too, and paint flags gain bit 32 — a style word and an antiAlias word
    (both animatable) follow the flags when either is live.
  - **Image handles are anim words** — on `<Image>`, `<Atlas>` and the image
    shader — so swapping which image a node draws is one slot write. The image
    source rect's four words are anim words, for sprite-sheet stepping.
  - **Atlas** writes a buffer id after the sampling word: 0 keeps the inline
    sprite list (whose seven per-sprite words are now anim words, and whose
    x/y now mean the sprite's centre — the reader applies the half-sprite
    bias); a positive id names a shared float block in the BufferRegistry,
    followed by a live sprite count instead of any inline data.
  - **Vertices** writes a buffer id after the kind: 0 keeps the inline stream
    (unchanged past that word); a positive id is followed by topology, vertex
    and index capacities, a texture/colour flags word, and live vertex and
    index counts. The mesh is rebuilt from the shared block at draw.
- **27** — adds the backdrop kind (17): x, y, width, height, corner radius, blur,
  refraction, depth, frost and dispersion. One node covers both `<BackdropBlur>`
  and `<Glass>`; a zero refraction is a plain blur. It samples the surface, so the
  reader marks it dynamic and a `<Group picture>` holding one is never recorded.
- **28** — the backdrop kind gains three words after dispersion: splay, light
  angle and light intensity, so `<Glass>`'s edge lighting is writable rather
  than fixed at what the reader hardcoded. They carry tgfx's own splay and angle
  and a light intensity of 50, so a scene naming none of them draws exactly as
  it did. All eight material words — blur, refraction, depth, frost, dispersion
  and the three above — are now **anim** words, so the whole material animates
  from value slots instead of re-encoding; the corner radius stays a literal
  because it is a clip. An older reader would take the splay word for the next
  node's kind, and would walk the patch cursor past the new entries.
- **29** — two filter kinds fill the gaps left in 10's block. Colour filter kind
  **3** is `alphaThreshold`, followed by one anim word for the threshold. Image
  filter kind **3** is `colorFilter`, followed by a whole colour filter — that is
  how a colour filter runs *after* an image filter instead of on the paint
  before the draw, which is what a `<Luma>` declared after a `<Blur>` now
  compiles to. The version word is the only protection here: a v28 reader drops
  colour kind 3 as unknown and then eats the threshold word as the image-filter
  kind, and on image kind 3 it desynchronises on the nested colour filter.
- **30** — the group flags word gains bit 16: a `<FilmGrain>` block follows the
  layer alpha. It is mode (0 mono, 1 duo, 2 multi), then **anim** size, density,
  seed and blend mode. Mode 2 then takes an **anim** opacity; mode 0 takes one
  packed colour and mode 1 takes two, each colour followed by a live flag and,
  when that flag is set, its four **anim** channels. A grained group is recorded
  into a picture and dusted with tgfx's `NoiseStyle` over its own pixels, so bit
  16 puts a group on the same recording path as bit 8 without caching it. Its
  slots also count as dynamic, so an ancestor `<Group picture>` stops recording
  rather than freezing the grain at a recorder's identity matrix. An older
  reader would take the mode word for the child count.
