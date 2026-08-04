// Paragraph layout for <Text> and <TextPath>.
//
// The output is a single tgfx::TextBlob holding every line and every fallback
// run, positioned relative to the first baseline at (0, 0), memoised on the
// command against a quarter-pixel-quantised size.
//
// Against Canvas::drawSimpleText, which rebuilt a TextBlob on every draw, that
// is a large win for a size that holds still and a **loss** for one that moves
// faster than a quantum per frame. Mean allocations per frame, 100 nodes over
// 37 frames, from cpp/tests/AllocBench (record time tracked these closely):
//
//     size            old      new
//     static          1114      467
//     0.05 px/frame   1229      864
//     0.10 px/frame   1170     1272   <- crossover
//     0.25 px/frame   1182     2511
//     1.00 px/frame   1198     2511
//
// So: static text, which is nearly all text, costs less than half what it did;
// a fontSize animating faster than ~6 px/s at 60 Hz costs about 2.2x the
// allocations of the old path. Coarsening the quantum would only trade that for
// visible size stepping. The real fix is to stop re-laying out at all when only
// the size moved — draw the memoised blob under a canvas scale — which is a
// design change, tracked in #145.
//
// Laying out here also unblocks three things drawSimpleText cannot do at all:
// line breaks, width-constrained wrapping with alignment, and per-glyph fallback,
// which is what makes an emoji draw instead of leaving the blank gap that
// TextBlob::MakeFrom's `glyphID == 0` drop produces.
//
// Not here: bidi reordering and complex-script shaping. A run of Arabic or
// Devanagari lays out in logical order with unshaped glyphs, which is wrong, and
// needs a shaper rather than a wider loop here.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "tgfx/core/Font.h"
#include "tgfx/core/Path.h"

namespace tgfx {
class TextBlob;
}

namespace tgfxrn {

/// How the lines of a paragraph sit inside its box.
enum class TextAlign { Left = 0, Center = 1, Right = 2 };

/// The face and per-glyph spacing one stretch of text is drawn with. A <Text>
/// with no <Span> children is one run; a <Span> is a run of its own, and may
/// override any of these.
struct TextRun {
  std::string text;
  std::string family;
  /// 0 means "the paragraph's", for every field that has a natural zero.
  int weight = 0;
  /// 0 inherits the paragraph's, 1 forces italic, 2 forces upright. A plain
  /// bool could not say "unset", which is what an implicit run always is.
  int italic = 0;
  float letterSpacing = 0;
  /// 0 means "the paragraph's size", which is the one that can animate. A span
  /// sets this to pick its own, and that one is static: the layout is memoised
  /// against the animated size, so a second moving size would defeat the memo.
  float size = 0;
  /// Packed ARGB, or absent when the run draws with the node's own paint.
  bool hasColor = false;
  uint32_t color = 0;
};

/// Everything about a <Text> that is not its position, its paint or its runs.
struct TextSpec {
  std::string family;
  int weight = 400;
  bool italic = false;
  float letterSpacing = 0;
  /// Wrap width in px. 0 means no wrapping: only explicit '\n' breaks a line.
  float wrapWidth = 0;
  TextAlign align = TextAlign::Left;
  /// Baseline-to-baseline distance in px. 0 means the font's own line spacing.
  float lineHeight = 0;
  /// 0 means unlimited.
  int maxLines = 0;
  /// Appended to the last line when maxLines truncates. Empty means a hard cut.
  std::string ellipsis;
  /// <TextPath> only: distance along the path where the first glyph starts.
  float startOffset = 0;
};

/// One glyph a caller placed itself, for <Glyphs>: an id from the face it names
/// and a position relative to the node's own origin.
struct PlacedGlyph {
  uint16_t id = 0;
  float x = 0;
  float y = 0;
};

/// One laid-out line, in the paragraph's own coordinates: x is where the line
/// starts after alignment, baseline is its distance below the first baseline.
struct LineMetrics {
  float width = 0;
  float x = 0;
  float baseline = 0;
  /// Negative, as in tgfx and Skia: the extent above this line's baseline.
  float ascent = 0;
  float descent = 0;
  /// Byte offsets into the concatenated run text, for hit testing.
  int32_t startIndex = 0;
  int32_t endIndex = 0;
};

/// What a laid-out paragraph occupies, in px, with the first baseline at y = 0.
struct TextMetrics {
  float width = 0;
  float height = 0;
  /// Negative, as in tgfx and Skia: the extent above the baseline.
  float ascent = 0;
  float descent = 0;
  float lineCount = 0;
  std::vector<LineMetrics> lines;
};

/// A stretch of the paragraph sharing one paint. Runs that draw with the node's
/// own paint carry no colour, and consecutive ones are packed into a single blob.
struct TextBlobRun {
  std::shared_ptr<tgfx::TextBlob> blob;
  bool hasColor = false;
  uint32_t color = 0;
};

struct TextLayout {
  /// Empty when the text is empty or no typeface resolved.
  std::vector<TextBlobRun> runs;
  TextMetrics metrics;
};

/// Lay `runs` out as one paragraph at `size`, resolving each run's typeface
/// through the FontRegistry. Returns an empty layout when nothing resolved,
/// which draws nothing.
TextLayout layoutText(const std::vector<TextRun>& runs, const TextSpec& spec, float size);

/// One id per codepoint of `text` in the face `spec` names, with no fallback:
/// 0 where that face has no glyph. What a caller placing its own glyphs needs.
std::vector<double> glyphIdsFor(const std::string& text, const TextSpec& spec, float size);

/// Glyphs the caller placed: no shaping, no line breaking, no fallback — the
/// escape hatch for a caller doing its own layout. Metrics describe the extent
/// the ids occupy, so it can still be measured like anything else.
TextLayout layoutGlyphs(const std::vector<PlacedGlyph>& glyphs, const TextSpec& spec, float size);

/// The same paragraph as an outline: every glyph's contours, placed where the
/// layout puts them, in one path. Empty for a face with no outlines — a colour
/// emoji is a bitmap and has none.
tgfx::Path textToPath(const std::vector<TextRun>& runs, const TextSpec& spec, float size);

/// The same text bent along `path`: each glyph is placed at its own advance
/// along the curve and rotated to the tangent there. Wrapping and alignment do
/// not apply — the path is the line.
TextLayout layoutTextOnPath(const std::vector<TextRun>& runs, const TextSpec& spec,
                            float size, const tgfx::Path& path);

}  // namespace tgfxrn
