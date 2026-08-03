#include "TextLayout.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <mutex>
#include <unordered_set>

#include "FontRegistry.hpp"
#include "Log.hpp"
#include "tgfx/core/FontMetrics.h"
#include "tgfx/core/PathMeasure.h"
#include "tgfx/core/Point.h"
#include "tgfx/core/RSXform.h"
#include "tgfx/core/TextBlob.h"
#include "tgfx/core/TextBlobBuilder.h"
#include "tgfx/core/UTF.h"

namespace tgfxrn {
namespace {

/// Once per codepoint per process: a paragraph of an uncovered script would
/// otherwise log a line per character, every time its size changes.
void warnMissing(int32_t code) {
  static std::mutex mutex;
  static std::unordered_set<int32_t> seen;
  {
    std::lock_guard<std::mutex> lock(mutex);
    if (!seen.insert(code).second) {
      return;
    }
  }
  TGFXRN_LOGW(
      "no glyph for U+%04X in the matched face or any fallback; it draws as .notdef, which most "
      "fonts leave blank. Register a font that covers this script.",
      code);
}

/// One positioned glyph, tagged with which font in the run stack drew it.
struct Glyph {
  tgfx::GlyphID id = 0;
  uint8_t font = 0;
  float advance = 0;
  int32_t code = 0;
};

struct Line {
  std::vector<Glyph> glyphs;
  float width = 0;
};

/// The primary face plus the fallback chain, all at the same size. Index 0 is
/// always the primary, so a glyph the primary has never reaches a fallback.
struct FontStack {
  std::vector<tgfx::Font> fonts;

  /// The first font with a glyph for `code`, or the primary with .notdef — a
  /// box where the font has one, rather than the blank gap TextBlob::MakeFrom
  /// leaves when it drops glyph 0.
  ///
  /// Whichever it draws, an uncovered codepoint is logged: many fonts have a
  /// blank .notdef, so "nothing on screen" is otherwise indistinguishable from
  /// "the string was empty".
  /// letterSpacing lands on the last glyph's advance too, so a measured width
  /// carries one trailing gap. That is what CSS letter-spacing does, and what
  /// keeps a measured width equal to the advance the next run would start at.
  Glyph shape(int32_t code, float letterSpacing) const {
    for (size_t i = 0; i < fonts.size(); i++) {
      auto id = fonts[i].getGlyphID(code);
      if (id != 0) {
        return {id, static_cast<uint8_t>(i), fonts[i].getAdvance(id) + letterSpacing, code};
      }
    }
    warnMissing(code);
    return {0, 0, fonts[0].getAdvance(0) + letterSpacing, code};
  }
};

/// Null when no typeface resolved at all, in which case there is nothing to draw.
std::unique_ptr<FontStack> buildStack(const TextSpec& spec, float size) {
  auto& registry = FontRegistry::instance();
  auto match = registry.match(spec.family, spec.weight, spec.italic);
  if (match.typeface == nullptr || size <= 0) {
    return nullptr;
  }
  auto stack = std::make_unique<FontStack>();
  tgfx::Font primary(match.typeface, size);
  primary.setFauxBold(match.fauxBold);
  primary.setFauxItalic(match.fauxItalic);
  stack->fonts.push_back(std::move(primary));
  for (const auto& typeface : registry.fallbacks()) {
    stack->fonts.emplace_back(typeface, size);
  }
  return stack;
}

std::vector<Glyph> shapeAll(const std::string& text, const FontStack& stack,
                            float letterSpacing) {
  std::vector<Glyph> glyphs;
  glyphs.reserve(text.size());
  const char* cursor = text.data();
  const char* end = cursor + text.size();
  while (cursor < end) {
    auto code = tgfx::UTF::NextUTF8(&cursor, end);
    if (code < 0) {
      break;
    }
    if (code == '\r') {
      continue;
    }
    if (code == '\n') {
      glyphs.push_back({0, 0, 0, '\n'});
      continue;
    }
    glyphs.push_back(stack.shape(code, letterSpacing));
  }
  return glyphs;
}

/// Greedy line breaking: break at the last space that fits, or mid-word when a
/// single word is wider than the box.
std::vector<Line> breakLines(const std::vector<Glyph>& glyphs, float wrapWidth) {
  std::vector<Line> lines;
  auto emit = [&](size_t from, size_t to, float width) {
    Line line;
    line.glyphs.assign(glyphs.begin() + static_cast<long>(from), glyphs.begin() + static_cast<long>(to));
    line.width = width;
    lines.push_back(std::move(line));
  };
  size_t start = 0;
  size_t breakStart = std::string::npos;  // first glyph of the next line
  size_t breakEnd = 0;                    // one past the last glyph of this one
  float breakWidth = 0;
  float x = 0;
  for (size_t i = 0; i < glyphs.size(); i++) {
    const auto& glyph = glyphs[i];
    if (glyph.code == '\n') {
      emit(start, i, x);
      start = i + 1;
      x = 0;
      breakStart = std::string::npos;
      continue;
    }
    if (wrapWidth > 0 && i > start && x + glyph.advance > wrapWidth) {
      if (breakStart != std::string::npos) {
        emit(start, breakEnd, breakWidth);
        start = breakStart;
        i = start - 1;  // re-measure the tail of the word on the new line
        x = 0;
        breakStart = std::string::npos;
        continue;
      }
      // One word wider than the box: break inside it rather than overflow.
      emit(start, i, x);
      start = i;
      x = 0;
    }
    if (glyph.code == ' ') {
      // The space itself is trimmed off the end of the line it breaks.
      breakEnd = i;
      breakWidth = x;
      breakStart = i + 1;
    }
    x += glyph.advance;
  }
  emit(start, glyphs.size(), x);
  return lines;
}

float widthOf(const std::vector<Glyph>& glyphs) {
  float width = 0;
  for (const auto& glyph : glyphs) {
    width += glyph.advance;
  }
  return width;
}

/// Trim `lines` to maxLines, appending the ellipsis to the last one it keeps.
void truncate(std::vector<Line>& lines, const TextSpec& spec, const FontStack& stack) {
  if (spec.maxLines <= 0 || lines.size() <= static_cast<size_t>(spec.maxLines)) {
    return;
  }
  lines.resize(static_cast<size_t>(spec.maxLines));
  if (spec.ellipsis.empty()) {
    return;
  }
  auto tail = shapeAll(spec.ellipsis, stack, spec.letterSpacing);
  auto& last = lines.back();
  float tailWidth = widthOf(tail);
  // Drop glyphs off the end until the ellipsis fits beside them.
  while (!last.glyphs.empty() && spec.wrapWidth > 0 &&
         last.width + tailWidth > spec.wrapWidth) {
    last.width -= last.glyphs.back().advance;
    last.glyphs.pop_back();
  }
  last.glyphs.insert(last.glyphs.end(), tail.begin(), tail.end());
  last.width += tailWidth;
}

/// Pack positioned glyphs into one blob, one run per stretch sharing a font.
std::shared_ptr<tgfx::TextBlob> buildBlob(const std::vector<Glyph>& glyphs,
                                          const std::vector<tgfx::Point>& positions,
                                          const FontStack& stack) {
  tgfx::TextBlobBuilder builder;
  size_t run = 0;
  while (run < glyphs.size()) {
    size_t end = run;
    while (end < glyphs.size() && glyphs[end].font == glyphs[run].font) {
      end++;
    }
    size_t count = end - run;
    const auto& buffer = builder.allocRunPos(stack.fonts[glyphs[run].font], count);
    if (buffer.glyphs == nullptr || buffer.positions == nullptr) {
      return nullptr;
    }
    auto* points = reinterpret_cast<tgfx::Point*>(buffer.positions);
    for (size_t i = 0; i < count; i++) {
      buffer.glyphs[i] = glyphs[run + i].id;
      points[i] = positions[run + i];
    }
    run = end;
  }
  return builder.build();
}

}  // namespace

TextLayout layoutText(const std::string& text, const TextSpec& spec, float size) {
  TextLayout layout;
  auto stack = buildStack(spec, size);
  if (stack == nullptr || text.empty()) {
    return layout;
  }
  auto metrics = stack->fonts[0].getMetrics();
  layout.metrics.ascent = metrics.ascent;
  layout.metrics.descent = metrics.descent;
  float step = spec.lineHeight > 0 ? spec.lineHeight
                                   : metrics.descent - metrics.ascent + metrics.leading;

  auto glyphs = shapeAll(text, *stack, spec.letterSpacing);
  auto lines = breakLines(glyphs, spec.wrapWidth);
  truncate(lines, spec, *stack);

  float widest = 0;
  for (const auto& line : lines) {
    widest = std::max(widest, line.width);
  }
  float box = spec.wrapWidth > 0 ? spec.wrapWidth : widest;
  layout.metrics.width = widest;
  layout.metrics.lineCount = static_cast<float>(lines.size());
  layout.metrics.height =
      static_cast<float>(lines.size() - 1) * step + (metrics.descent - metrics.ascent);

  std::vector<Glyph> flat;
  std::vector<tgfx::Point> positions;
  for (size_t i = 0; i < lines.size(); i++) {
    const auto& line = lines[i];
    float x = spec.align == TextAlign::Center ? (box - line.width) / 2
              : spec.align == TextAlign::Right ? box - line.width
                                               : 0;
    float y = static_cast<float>(i) * step;
    for (const auto& glyph : line.glyphs) {
      if (glyph.code != '\n') {
        flat.push_back(glyph);
        positions.push_back({x, y});
      }
      x += glyph.advance;
    }
  }
  if (!flat.empty()) {
    layout.blob = buildBlob(flat, positions, *stack);
  }
  return layout;
}

TextLayout layoutTextOnPath(const std::string& text, const TextSpec& spec, float size,
                            const tgfx::Path& path) {
  TextLayout layout;
  auto stack = buildStack(spec, size);
  if (stack == nullptr || text.empty() || path.isEmpty()) {
    return layout;
  }
  auto measure = tgfx::PathMeasure::MakeFrom(path);
  if (measure == nullptr) {
    return layout;
  }
  float length = measure->getLength();
  auto metrics = stack->fonts[0].getMetrics();
  layout.metrics.ascent = metrics.ascent;
  layout.metrics.descent = metrics.descent;
  layout.metrics.lineCount = 1;
  layout.metrics.height = metrics.descent - metrics.ascent;

  auto glyphs = shapeAll(text, *stack, spec.letterSpacing);
  tgfx::TextBlobBuilder builder;
  float distance = spec.startOffset;
  size_t run = 0;
  while (run < glyphs.size()) {
    size_t end = run;
    while (end < glyphs.size() && glyphs[end].font == glyphs[run].font) {
      end++;
    }
    size_t count = end - run;
    const auto& buffer = builder.allocRunRSXform(stack->fonts[glyphs[run].font], count);
    if (buffer.glyphs == nullptr || buffer.positions == nullptr) {
      return layout;
    }
    auto* xforms = reinterpret_cast<tgfx::RSXform*>(buffer.positions);
    for (size_t i = 0; i < count; i++) {
      const auto& glyph = glyphs[run + i];
      buffer.glyphs[i] = glyph.id;
      // Anchor each glyph at its own midpoint, so it sits centred on the curve
      // rather than pivoting around its left edge on a tight bend.
      float half = glyph.advance / 2;
      tgfx::Point position = {};
      tgfx::Point tangent = {1, 0};
      measure->getPosTan(std::clamp(distance + half, 0.0f, length), &position, &tangent);
      xforms[i] = tgfx::RSXform::MakeFromRadians(1, std::atan2(tangent.y, tangent.x), position.x,
                                                 position.y, half, 0);
      distance += glyph.advance;
    }
    run = end;
  }
  layout.metrics.width = distance - spec.startOffset;
  layout.blob = builder.build();
  return layout;
}

}  // namespace tgfxrn
