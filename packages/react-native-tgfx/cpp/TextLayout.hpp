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

/// Everything about a <Text> that is not its position or its paint.
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

/// What a laid-out paragraph occupies, in px, with the first baseline at y = 0.
struct TextMetrics {
  float width = 0;
  float height = 0;
  /// Negative, as in tgfx and Skia: the extent above the baseline.
  float ascent = 0;
  float descent = 0;
  float lineCount = 0;
};

struct TextLayout {
  /// Null when the text is empty or no typeface resolved.
  std::shared_ptr<tgfx::TextBlob> blob;
  TextMetrics metrics;
};

/// Lay `text` out at `size`, resolving the typeface through the FontRegistry.
/// Returns an empty layout when nothing resolved, which draws nothing.
TextLayout layoutText(const std::string& text, const TextSpec& spec, float size);

/// The same text bent along `path`: each glyph is placed at its own advance
/// along the curve and rotated to the tangent there. Wrapping and alignment do
/// not apply — the path is the line.
TextLayout layoutTextOnPath(const std::string& text, const TextSpec& spec, float size,
                            const tgfx::Path& path);

}  // namespace tgfxrn
