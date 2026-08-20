// Bidi resolution and complex-script shaping for TextLayout, per #143.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "tgfx/core/Font.h"

namespace tgfxrn {

/// One shaped glyph. A cluster of codepoints can shape to several glyphs, and
/// several codepoints can shape to one, so this maps back to the source by byte
/// range rather than by position.
struct ShapedGlyph {
  tgfx::GlyphID id = 0;
  /// Index into the font stack this run was shaped with.
  uint8_t font = 0;
  float advance = 0;
  /// Mark positioning, in px, relative to the pen.
  float offsetX = 0;
  float offsetY = 0;
  /// The cluster's UTF-8 byte offset in the paragraph, and how many bytes it
  /// covers. Several glyphs of one cluster share both.
  int32_t index = 0;
  int32_t length = 0;
  /// The bidi embedding level of the run. Odd is right-to-left.
  uint8_t level = 0;
  /// The cluster's first codepoint, which is what line breaking looks at.
  int32_t code = 0;
  /// UAX#9 L1 resets these to the paragraph level at the end of a line.
  bool whitespace = false;
};

/// A paragraph's resolved bidi levels, one per byte of its text.
struct BidiLevels {
  /// The base direction, from the first strong character (UAX#9 P2/P3).
  bool rtl = false;
  /// Indexed by byte offset. A byte inside a codepoint carries that
  /// codepoint's level, so a lookup never has to find the boundary first.
  std::vector<uint8_t> byByte;
  /// True where the byte's codepoint is whitespace L1 may reset.
  std::vector<uint8_t> whitespaceByByte;

  uint8_t levelAt(int32_t index) const {
    auto at = static_cast<size_t>(index);
    return at < byByte.size() ? byByte[at] : (rtl ? 1 : 0);
  }
  bool whitespaceAt(int32_t index) const {
    auto at = static_cast<size_t>(index);
    return at < whitespaceByByte.size() && whitespaceByByte[at] != 0;
  }
};

/**
 * Resolve one paragraph — every `<Span>` of a `<Text>` concatenated, not one
 * run — into bidi levels. Resolving per run would let a span that changes only
 * a colour change the layout, because sos and eos would reset at its seam.
 */
BidiLevels resolveParagraph(const std::string& text);

/**
 * Shape `paragraph[begin, end)` through HarfBuzz, split by the levels above,
 * then by script, then by which font in `fonts` covers the text.
 *
 * The whole paragraph goes into the buffer with the run marked by an item
 * range, so a letter at a run boundary still sees its neighbours and takes the
 * right joined form. The result is in **logical** order, each glyph carrying
 * the level it has to be reordered by once its line is known. `letterSpacing`
 * lands on the last glyph of each cluster, so a mark does not get one of its
 * own.
 */
std::vector<ShapedGlyph> shapeRun(const std::string& paragraph, int32_t begin, int32_t end,
                                  const std::vector<tgfx::Font>& fonts, float letterSpacing,
                                  const BidiLevels& levels);

}  // namespace tgfxrn
