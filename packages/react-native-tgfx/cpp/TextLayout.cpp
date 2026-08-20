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

/// Once per codepoint per process, or an uncovered script logs a line per character per size.
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

struct Glyph {
  tgfx::GlyphID id = 0;
  uint8_t font = 0;
  float advance = 0;
  int32_t code = 0;
  uint16_t run = 0;
  int32_t index = 0;
  /// UTF-8 bytes this glyph's codepoint took, so a caret can land after it.
  int32_t length = 0;
};

struct Line {
  std::vector<Glyph> glyphs;
  float width = 0;
  int32_t startIndex = 0;
};

using Stacks = std::vector<std::unique_ptr<struct FontStack>>;

struct FontStack {
  std::vector<tgfx::Font> fonts;

  /// The first font with a glyph for `code`, or the primary with .notdef, logged either way.
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

std::unique_ptr<FontStack> buildStack(const std::string& family, int weight, bool italic,
                                      float size, bool forceBold, bool forceItalic) {
  auto& registry = FontRegistry::instance();
  auto match = registry.match(family, weight, italic);
  if (match.typeface == nullptr || size <= 0) {
    return nullptr;
  }
  auto stack = std::make_unique<FontStack>();
  tgfx::Font primary(match.typeface, size);
  primary.setFauxBold(match.fauxBold || forceBold);
  primary.setFauxItalic(match.fauxItalic || forceItalic);
  stack->fonts.push_back(std::move(primary));
  for (const auto& typeface : registry.fallbacks()) {
    // Only what the caller forced: `match` describes the primary face, not this one.
    auto& fallback = stack->fonts.emplace_back(typeface, size);
    fallback.setFauxBold(forceBold);
    fallback.setFauxItalic(forceItalic);
  }
  return stack;
}

void shapeInto(std::vector<Glyph>& glyphs, const std::string& text, const FontStack& stack,
               float letterSpacing, uint16_t run, int32_t baseIndex) {
  const char* start = text.data();
  const char* cursor = start;
  const char* end = cursor + text.size();
  while (cursor < end) {
    auto at = baseIndex + static_cast<int32_t>(cursor - start);
    auto code = tgfx::UTF::NextUTF8(&cursor, end);
    if (code < 0) {
      break;
    }
    if (code == '\r') {
      continue;
    }
    auto length = baseIndex + static_cast<int32_t>(cursor - start) - at;
    if (code == '\n') {
      glyphs.push_back({0, 0, 0, '\n', run, at, length});
      continue;
    }
    auto glyph = stack.shape(code, letterSpacing);
    glyph.run = run;
    glyph.index = at;
    glyph.length = length;
    glyphs.push_back(glyph);
  }
}

std::vector<Line> breakLines(const std::vector<Glyph>& glyphs, float wrapWidth,
                             int32_t textLength) {
  std::vector<Line> lines;
  auto emit = [&](size_t from, size_t to, float width) {
    Line line;
    line.glyphs.assign(glyphs.begin() + static_cast<long>(from),
                       glyphs.begin() + static_cast<long>(to));
    line.width = width;
    line.startIndex = from < glyphs.size() ? glyphs[from].index : textLength;
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
      emit(start, i, x);
      start = i;
      x = 0;
    }
    if (glyph.code == ' ') {
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

void truncate(std::vector<Line>& lines, const TextSpec& spec, const FontStack& stack,
              uint16_t run) {
  if (spec.maxLines <= 0 || lines.size() <= static_cast<size_t>(spec.maxLines)) {
    return;
  }
  lines.resize(static_cast<size_t>(spec.maxLines));
  if (spec.ellipsis.empty()) {
    return;
  }
  std::vector<Glyph> tail;
  auto& last = lines.back();
  shapeInto(tail, spec.ellipsis, stack, spec.letterSpacing, run, 0);
  float tailWidth = widthOf(tail);
  while (!last.glyphs.empty() && spec.wrapWidth > 0 &&
         last.width + tailWidth > spec.wrapWidth) {
    last.width -= last.glyphs.back().advance;
    last.glyphs.pop_back();
  }
  // After the trim, not before it: the ellipsis stands in for text that is no
  // longer laid out, so it takes the offset just past the last glyph actually
  // kept. Length zero keeps a caret on it from landing in the middle of a
  // codepoint the ellipsis character happens to be as long as, and keeps it out
  // of a range's boxes, which measure real text.
  int32_t at = last.glyphs.empty() ? last.startIndex
                                   : last.glyphs.back().index + last.glyphs.back().length;
  for (auto& glyph : tail) {
    glyph.index = at;
    glyph.length = 0;
  }
  last.glyphs.insert(last.glyphs.end(), tail.begin(), tail.end());
  last.width += tailWidth;
}

std::vector<TextBlobRun> buildBlobs(const std::vector<Glyph>& glyphs,
                                    const std::vector<tgfx::Point>& positions,
                                    const std::vector<TextRun>& runs, const Stacks& stacks) {
  std::vector<TextBlobRun> out;
  auto paintOf = [&](const Glyph& glyph) {
    const auto& run = runs[glyph.run];
    return std::pair<bool, uint32_t>{run.hasColor, run.color};
  };
  size_t group = 0;
  while (group < glyphs.size()) {
    size_t groupEnd = group;
    while (groupEnd < glyphs.size() && paintOf(glyphs[groupEnd]) == paintOf(glyphs[group])) {
      groupEnd++;
    }
    tgfx::TextBlobBuilder builder;
    size_t run = group;
    while (run < groupEnd) {
      size_t end = run;
      while (end < groupEnd && glyphs[end].font == glyphs[run].font &&
             glyphs[end].run == glyphs[run].run) {
        end++;
      }
      size_t count = end - run;
      const auto& stack = *stacks[glyphs[run].run];
      const auto& buffer = builder.allocRunPos(stack.fonts[glyphs[run].font], count);
      if (buffer.glyphs == nullptr || buffer.positions == nullptr) {
        return {};
      }
      auto* points = reinterpret_cast<tgfx::Point*>(buffer.positions);
      for (size_t i = 0; i < count; i++) {
        buffer.glyphs[i] = glyphs[run + i].id;
        points[i] = positions[run + i];
      }
      run = end;
    }
    auto blob = builder.build();
    if (blob != nullptr) {
      auto paint = paintOf(glyphs[group]);
      out.push_back({std::move(blob), paint.first, paint.second});
    }
    group = groupEnd;
  }
  return out;
}

struct Paragraph {
  Stacks stacks;
  std::vector<tgfx::FontMetrics> metrics;
  bool empty = true;
};

size_t lastUsableRun(const struct Paragraph& paragraph);

Paragraph buildParagraph(const std::vector<TextRun>& runs, const TextSpec& spec, float size) {
  Paragraph out;
  out.stacks.reserve(runs.size());
  out.metrics.resize(runs.size());
  for (size_t i = 0; i < runs.size(); i++) {
    const auto& run = runs[i];
    // A faux bit reaches a run only on the axis it inherits: a span that set its own opts out.
    auto stack = buildStack(run.family.empty() ? spec.family : run.family,
                            run.weight != 0 ? run.weight : spec.weight,
                            run.italic == 0 ? spec.italic : run.italic == 1,
                            run.size > 0 ? run.size : size,
                            run.weight == 0 && spec.fauxBold,
                            run.italic == 0 && spec.fauxItalic);
    if (stack != nullptr) {
      out.metrics[i] = stack->fonts[0].getMetrics();
      out.empty = false;
    }
    out.stacks.push_back(std::move(stack));
  }
  return out;
}

size_t lastUsableRun(const Paragraph& paragraph) {
  for (size_t i = paragraph.stacks.size(); i > 0; i--) {
    if (paragraph.stacks[i - 1] != nullptr) {
      return i - 1;
    }
  }
  return 0;
}

struct Placement {
  std::vector<Glyph> glyphs;
  std::vector<tgfx::Point> positions;
  /// Which line each glyph landed on, parallel to the two above.
  std::vector<int32_t> lines;
  TextMetrics metrics;
};

Placement place(const std::vector<TextRun>& runs, const TextSpec& spec,
                const Paragraph& paragraph) {
  Placement out;
  std::vector<Glyph> glyphs;
  int32_t index = 0;
  for (size_t i = 0; i < runs.size(); i++) {
    const auto& run = runs[i];
    if (paragraph.stacks[i] != nullptr) {
      shapeInto(glyphs, run.text, *paragraph.stacks[i],
                run.letterSpacing != 0 ? run.letterSpacing : spec.letterSpacing,
                static_cast<uint16_t>(i), index);
    }
    index += static_cast<int32_t>(run.text.size());
  }
  if (glyphs.empty()) {
    return out;
  }

  auto lines = breakLines(glyphs, spec.wrapWidth, index);
  // The last run still on screen after the trim, so a span on a dropped line cannot colour it.
  size_t kept = spec.maxLines > 0 ? std::min(lines.size(), static_cast<size_t>(spec.maxLines))
                                  : lines.size();
  size_t tailRun = lastUsableRun(paragraph);
  for (size_t i = kept; i > 0; i--) {
    if (!lines[i - 1].glyphs.empty()) {
      tailRun = lines[i - 1].glyphs.back().run;
      break;
    }
  }
  if (paragraph.stacks[tailRun] == nullptr) {
    tailRun = lastUsableRun(paragraph);
  }
  truncate(lines, spec, *paragraph.stacks[tailRun], static_cast<uint16_t>(tailRun));

  float widest = 0;
  for (const auto& line : lines) {
    widest = std::max(widest, line.width);
  }
  float box = spec.wrapWidth > 0 ? spec.wrapWidth : widest;
  out.metrics.width = widest;
  out.metrics.lineCount = static_cast<float>(lines.size());
  out.metrics.lines.reserve(lines.size());

  float baseline = 0;
  for (size_t i = 0; i < lines.size(); i++) {
    const auto& line = lines[i];
    // Per line, over the runs on it: mixed sizes lead with the tallest face, not the first.
    float ascent = 0;
    float descent = 0;
    float leading = 0;
    if (line.glyphs.empty()) {
      ascent = paragraph.metrics[0].ascent;
      descent = paragraph.metrics[0].descent;
      leading = paragraph.metrics[0].leading;
    }
    for (const auto& glyph : line.glyphs) {
      const auto& m = paragraph.metrics[glyph.run];
      ascent = std::min(ascent, m.ascent);
      descent = std::max(descent, m.descent);
      leading = std::max(leading, m.leading);
    }
    float step = spec.lineHeight > 0 ? spec.lineHeight : descent - ascent + leading;
    if (i > 0) {
      baseline += step;
    }
    float x = spec.align == TextAlign::Center ? (box - line.width) / 2
              : spec.align == TextAlign::Right ? box - line.width
                                               : 0;
    LineMetrics metrics;
    metrics.width = line.width;
    metrics.x = x;
    metrics.baseline = baseline;
    metrics.ascent = ascent;
    metrics.descent = descent;
    metrics.startIndex = line.glyphs.empty() ? line.startIndex : line.glyphs.front().index;
    metrics.endIndex = line.glyphs.empty() ? line.startIndex : line.glyphs.back().index;
    out.metrics.lines.push_back(metrics);
    if (i == 0) {
      out.metrics.ascent = ascent;
    }
    out.metrics.descent = descent;

    for (const auto& glyph : line.glyphs) {
      if (glyph.code != '\n') {
        out.glyphs.push_back(glyph);
        out.positions.push_back({x, baseline});
        out.lines.push_back(static_cast<int32_t>(i));
      }
      x += glyph.advance;
    }
  }
  out.metrics.height = baseline + (out.metrics.descent - out.metrics.ascent);
  return out;
}

}  // namespace

TextLayout layoutText(const std::vector<TextRun>& runs, const TextSpec& spec, float size) {
  TextLayout layout;
  auto paragraph = buildParagraph(runs, spec, size);
  if (paragraph.empty) {
    return layout;
  }
  auto placement = place(runs, spec, paragraph);
  layout.metrics = std::move(placement.metrics);
  if (!placement.glyphs.empty()) {
    layout.runs = buildBlobs(placement.glyphs, placement.positions, runs, paragraph.stacks);
  }
  return layout;
}

TextPosition positionAtCoordinate(const std::vector<TextRun>& runs, const TextSpec& spec,
                                  float size, float x, float y) {
  TextPosition out;
  auto paragraph = buildParagraph(runs, spec, size);
  if (paragraph.empty) {
    return out;
  }
  auto placement = place(runs, spec, paragraph);
  const auto& lines = placement.metrics.lines;
  if (lines.empty()) {
    return out;
  }
  // The line whose band holds y, clamped: a point above the first line or below
  // the last one still resolves rather than reporting nothing. The band runs to
  // where the next line begins, not to where this one's ink ends — an explicit
  // lineHeight opens a gap between the two, and the gap belongs to the line
  // above it, not below.
  size_t line = lines.size() - 1;
  for (size_t i = 0; i + 1 < lines.size(); i++) {
    if (y < lines[i + 1].baseline + lines[i + 1].ascent) {
      line = i;
      break;
    }
  }
  out.line = static_cast<int32_t>(line);
  // Every glyph on that line, in order. Empty lines keep the caret at their own
  // start offset, which is the only offset they have.
  const Glyph* last = nullptr;
  bool found = false;
  for (size_t i = 0; i < placement.glyphs.size(); i++) {
    if (placement.lines[i] != out.line) {
      continue;
    }
    const auto& glyph = placement.glyphs[i];
    float left = placement.positions[i].x;
    if (x < left + glyph.advance / 2) {
      // The leading half: the caret goes before this glyph.
      out.index = glyph.index;
      out.leading = true;
      found = true;
      break;
    }
    if (x < left + glyph.advance) {
      // The trailing half: the caret goes after it, and says so.
      out.index = glyph.index + glyph.length;
      out.leading = false;
      found = true;
      break;
    }
    last = &glyph;
  }
  if (!found) {
    // Past the last glyph on the line, so the caret goes after it. An ellipsis
    // carries no bytes, so this is the offset past the last real glyph.
    out.index = last != nullptr ? last->index + last->length : lines[line].startIndex;
    out.leading = last == nullptr;
  }
  return out;
}

std::vector<TextBox> boxesForRange(const std::vector<TextRun>& runs, const TextSpec& spec,
                                   float size, int32_t start, int32_t end) {
  std::vector<TextBox> boxes;
  if (start >= end) {
    return boxes;
  }
  auto paragraph = buildParagraph(runs, spec, size);
  if (paragraph.empty) {
    return boxes;
  }
  auto placement = place(runs, spec, paragraph);
  const auto& lines = placement.metrics.lines;
  // One box per line the range crosses, grown glyph by glyph. The glyphs are in
  // line order already, so a new line is always a new box.
  for (size_t i = 0; i < placement.glyphs.size(); i++) {
    const auto& glyph = placement.glyphs[i];
    // An ellipsis owns no bytes and stands for text that was dropped, so it is
    // never part of a range: without this it straddles every range around its
    // offset and both widens the box and drags its end index backwards.
    if (glyph.length <= 0) {
      continue;
    }
    if (glyph.index >= end || glyph.index + glyph.length <= start) {
      continue;
    }
    int32_t line = placement.lines[i];
    float left = placement.positions[i].x;
    float right = left + glyph.advance;
    if (!boxes.empty() && boxes.back().line == line) {
      auto& box = boxes.back();
      box.width = std::max(box.width, right - box.x);
      box.endIndex = std::max(box.endIndex, glyph.index + glyph.length);
      continue;
    }
    const auto& metrics = lines[static_cast<size_t>(line)];
    TextBox box;
    box.x = left;
    box.y = metrics.baseline + metrics.ascent;
    box.width = right - left;
    box.height = metrics.descent - metrics.ascent;
    box.line = line;
    box.startIndex = glyph.index;
    box.endIndex = glyph.index + glyph.length;
    boxes.push_back(box);
  }
  return boxes;
}

std::vector<double> glyphIdsFor(const std::string& text, const TextSpec& spec, float size) {
  std::vector<double> ids;
  auto stack = buildStack(spec.family, spec.weight, spec.italic, size, spec.fauxBold,
                          spec.fauxItalic);
  if (stack == nullptr) {
    return ids;
  }
  const char* cursor = text.data();
  const char* end = cursor + text.size();
  while (cursor < end) {
    auto code = tgfx::UTF::NextUTF8(&cursor, end);
    if (code < 0) {
      break;
    }
    ids.push_back(stack->fonts[0].getGlyphID(code));
  }
  return ids;
}

TextLayout layoutGlyphs(const std::vector<PlacedGlyph>& glyphs, const TextSpec& spec,
                        float size) {
  TextLayout layout;
  auto stack = buildStack(spec.family, spec.weight, spec.italic, size, spec.fauxBold,
                          spec.fauxItalic);
  if (stack == nullptr || glyphs.empty()) {
    return layout;
  }
  const auto& font = stack->fonts[0];
  auto metrics = font.getMetrics();
  layout.metrics.ascent = metrics.ascent;
  layout.metrics.descent = metrics.descent;
  layout.metrics.lineCount = 1;
  layout.metrics.height = metrics.descent - metrics.ascent;

  tgfx::TextBlobBuilder builder;
  const auto& buffer = builder.allocRunPos(font, glyphs.size());
  if (buffer.glyphs == nullptr || buffer.positions == nullptr) {
    return layout;
  }
  auto* points = reinterpret_cast<tgfx::Point*>(buffer.positions);
  float right = 0;
  for (size_t i = 0; i < glyphs.size(); i++) {
    buffer.glyphs[i] = glyphs[i].id;
    points[i] = {glyphs[i].x, glyphs[i].y};
    right = std::max(right, glyphs[i].x + font.getAdvance(glyphs[i].id));
  }
  auto blob = builder.build();
  if (blob == nullptr) {
    return layout;
  }
  layout.metrics.width = right;
  LineMetrics line;
  line.width = right;
  line.ascent = metrics.ascent;
  line.descent = metrics.descent;
  layout.metrics.lines.push_back(line);
  layout.runs.push_back({std::move(blob), false, 0});
  return layout;
}

tgfx::Path textToPath(const std::vector<TextRun>& runs, const TextSpec& spec, float size) {
  tgfx::Path path;
  auto paragraph = buildParagraph(runs, spec, size);
  if (paragraph.empty) {
    return path;
  }
  auto placement = place(runs, spec, paragraph);
  for (size_t i = 0; i < placement.glyphs.size(); i++) {
    const auto& glyph = placement.glyphs[i];
    tgfx::Path outline;
    // False for a bitmap-only face — a colour emoji has no outline to give.
    if (!paragraph.stacks[glyph.run]->fonts[glyph.font].getPath(glyph.id, &outline)) {
      continue;
    }
    outline.transform(tgfx::Matrix::MakeTrans(placement.positions[i].x, placement.positions[i].y));
    path.addPath(outline);
  }
  return path;
}

TextLayout layoutTextOnPath(const std::vector<TextRun>& runs, const TextSpec& spec,
                            float size, const tgfx::Path& path) {
  TextLayout layout;
  auto paragraph = buildParagraph(runs, spec, size);
  if (paragraph.empty || path.isEmpty()) {
    return layout;
  }
  auto measure = tgfx::PathMeasure::MakeFrom(path);
  if (measure == nullptr) {
    return layout;
  }
  float length = measure->getLength();

  std::vector<Glyph> glyphs;
  int32_t index = 0;
  for (size_t i = 0; i < runs.size(); i++) {
    const auto& run = runs[i];
    if (paragraph.stacks[i] != nullptr) {
      shapeInto(glyphs, run.text, *paragraph.stacks[i],
                run.letterSpacing != 0 ? run.letterSpacing : spec.letterSpacing,
                static_cast<uint16_t>(i), index);
    }
    index += static_cast<int32_t>(run.text.size());
  }
  if (glyphs.empty()) {
    return layout;
  }

  float ascent = 0;
  float descent = 0;
  for (const auto& glyph : glyphs) {
    ascent = std::min(ascent, paragraph.metrics[glyph.run].ascent);
    descent = std::max(descent, paragraph.metrics[glyph.run].descent);
  }
  layout.metrics.ascent = ascent;
  layout.metrics.descent = descent;
  layout.metrics.lineCount = 1;
  layout.metrics.height = descent - ascent;

  auto paintOf = [&](const Glyph& glyph) {
    const auto& run = runs[glyph.run];
    return std::pair<bool, uint32_t>{run.hasColor, run.color};
  };
  float distance = spec.startOffset;
  size_t group = 0;
  while (group < glyphs.size()) {
    size_t groupEnd = group;
    while (groupEnd < glyphs.size() && paintOf(glyphs[groupEnd]) == paintOf(glyphs[group])) {
      groupEnd++;
    }
    tgfx::TextBlobBuilder builder;
    size_t run = group;
    while (run < groupEnd) {
      size_t end = run;
      while (end < groupEnd && glyphs[end].font == glyphs[run].font &&
             glyphs[end].run == glyphs[run].run) {
        end++;
      }
      size_t count = end - run;
      const auto& stack = *paragraph.stacks[glyphs[run].run];
      const auto& buffer = builder.allocRunRSXform(stack.fonts[glyphs[run].font], count);
      if (buffer.glyphs == nullptr || buffer.positions == nullptr) {
        return layout;
      }
      auto* xforms = reinterpret_cast<tgfx::RSXform*>(buffer.positions);
      for (size_t i = 0; i < count; i++) {
        const auto& glyph = glyphs[run + i];
        buffer.glyphs[i] = glyph.id;
        // Anchored at its midpoint, so a glyph sits centred on a tight bend rather than pivoting.
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
    auto blob = builder.build();
    if (blob != nullptr) {
      auto paint = paintOf(glyphs[group]);
      layout.runs.push_back({std::move(blob), paint.first, paint.second});
    }
    group = groupEnd;
  }
  layout.metrics.width = distance - spec.startOffset;
  LineMetrics line;
  line.width = layout.metrics.width;
  line.ascent = ascent;
  line.descent = descent;
  line.endIndex = index;
  layout.metrics.lines.push_back(line);
  return layout;
}

}  // namespace tgfxrn
