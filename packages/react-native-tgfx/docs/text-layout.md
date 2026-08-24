# Text layout

`cpp/TextLayout/TextLayout.hpp` lays `<Text>` and `<TextPath>` out into a single
`tgfx::TextBlob` holding every line and every fallback run, positioned relative
to the first baseline at (0, 0), memoised on the command against a
quarter-pixel-quantised size.

## Why memoising beats `Canvas::drawSimpleText`, and when it does not

`drawSimpleText` rebuilt a `TextBlob` on every draw. Memoising is a large win
for a size that holds still and a **loss** for one that moves faster than a
quantum per frame. Mean allocations per frame, 100 nodes over 37 frames, from
`cpp/tests/AllocBench` (record time tracked these closely):

| size           | old  | new  |
| -------------- | ---- | ---- |
| static         | 1114 | 467  |
| 0.05 px/frame  | 1229 | 864  |
| 0.10 px/frame  | 1170 | 1272 | ← crossover
| 0.25 px/frame  | 1182 | 2511 |
| 1.00 px/frame  | 1198 | 2511 |

Static text, which is nearly all text, costs less than half what it did. A
`fontSize` animating faster than ~6 px/s at 60 Hz costs about 2.2× the
allocations of the old path. Coarsening the quantum would only trade that for
visible size stepping. The real fix is to stop re-laying out at all when only
the size moved — draw the memoised blob under a canvas scale — which is a design
change, tracked in [#145](https://github.com/riteshshukla04/react-native-tgfx/issues/145).

## What laying out here unblocks

Three things `drawSimpleText` cannot do at all: line breaks,
width-constrained wrapping with alignment, and per-glyph fallback — which is
what makes an emoji draw instead of leaving the blank gap that
`TextBlob::MakeFrom`'s `glyphID == 0` drop produces.

## Not here

Bidi reordering and complex-script shaping. A run of Arabic or Devanagari lays
out in logical order with unshaped glyphs, which is wrong, and needs a shaper
rather than a wider loop.
