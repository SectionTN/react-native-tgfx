#include "HybridTgfxFonts.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

#include "Base64.hpp"
#include "FontRegistry.hpp"
#include "PlatformAsset.hpp"
#include "SvgPath.hpp"
#include "TextLayout.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/Typeface.h"

namespace margelo::nitro::tgfx {
namespace {

using NamePromise = Promise<std::string>;

std::string registerTypeface(std::shared_ptr<::tgfx::Typeface> typeface,
                             const std::string& family, const std::string& what) {
  if (typeface == nullptr) {
    throw std::runtime_error("tgfx: " + what + " is not a font file this platform can open");
  }
  auto name = tgfxrn::FontRegistry::instance().add(std::move(typeface), family);
  if (name.empty()) {
    throw std::runtime_error("tgfx: " + what + " has no family name; pass one explicitly");
  }
  return name;
}

std::string stripFileScheme(const std::string& path) {
  constexpr std::string_view kScheme = "file://";
  if (path.rfind(kScheme, 0) == 0) {
    return path.substr(kScheme.size());
  }
  return path;
}

tgfxrn::TextSpec specOf(const TextLayoutStyle& style) {
  tgfxrn::TextSpec spec;
  spec.family = style.fontFamily;
  spec.weight = static_cast<int>(style.fontWeight);
  spec.italic = style.italic;
  spec.fauxBold = style.fauxBold;
  spec.fauxItalic = style.fauxItalic;
  spec.letterSpacing = static_cast<float>(style.letterSpacing);
  spec.wrapWidth = static_cast<float>(style.width);
  spec.align = static_cast<tgfxrn::TextAlign>(
      std::clamp(static_cast<int>(style.align), 0, 2));
  spec.lineHeight = static_cast<float>(style.lineHeight);
  spec.maxLines = static_cast<int>(style.maxLines);
  spec.ellipsis = style.ellipsis;
  return spec;
}

/// The size the renderer will actually lay out at. It quantises to a quarter of
/// a pixel so its memoised blob survives an animating fontSize; measuring at the
/// unquantised size would report a paragraph a fraction wider than the drawn
/// one, which a caret or a highlight box then sits beside.
float layoutSize(double fontSize) {
  auto size = static_cast<float>(fontSize);
  return std::round(size * 4) / 4;
}

}  // namespace

std::shared_ptr<NamePromise> HybridTgfxFonts::registerFromFile(const std::string& path,
                                                               const std::string& family) {
  return NamePromise::async([file = stripFileScheme(path), family]() {
    // A packaged resource has a name and no file, so it must be read before any path attempt.
    if (tgfxrn::looksLikeAssetName(file)) {
      if (auto data = tgfxrn::platformAssetData(file)) {
        return registerTypeface(::tgfx::Typeface::MakeFromData(std::move(data), 0), family, file);
      }
    }
    if (tgfxrn::looksLikePlatformUri(file)) {
      auto data = tgfxrn::platformUriData(file);
      if (data == nullptr) {
        throw std::runtime_error("tgfx: could not read " + file);
      }
      return registerTypeface(::tgfx::Typeface::MakeFromData(std::move(data), 0), family, file);
    }
    return registerTypeface(::tgfx::Typeface::MakeFromPath(file), family, file);
  });
}

std::shared_ptr<NamePromise> HybridTgfxFonts::registerFromBytes(
    const std::shared_ptr<ArrayBuffer>& bytes, const std::string& family) {
  // A JS-owned ArrayBuffer only lives for this call, and the typeface reads it for its whole life.
  auto data = bytes == nullptr || bytes->size() == 0
                  ? nullptr
                  : ::tgfx::Data::MakeWithCopy(bytes->data(), bytes->size());
  return NamePromise::async([data = std::move(data), family]() mutable {
    if (data == nullptr) {
      throw std::runtime_error("tgfx: registerFromBytes was given an empty buffer");
    }
    return registerTypeface(::tgfx::Typeface::MakeFromData(std::move(data)), family,
                            "the given bytes");
  });
}

std::shared_ptr<NamePromise> HybridTgfxFonts::registerFromBase64(const std::string& input,
                                                                 const std::string& family) {
  return NamePromise::async([input, family]() {
    auto decoded = tgfxrn::base64Decode(input);
    if (decoded.empty()) {
      throw std::runtime_error("tgfx: registerFromBase64 was given no decodable bytes");
    }
    auto data = ::tgfx::Data::MakeWithCopy(decoded.data(), decoded.size());
    return registerTypeface(::tgfx::Typeface::MakeFromData(std::move(data)), family,
                            "the given base64 payload");
  });
}

std::vector<std::string> HybridTgfxFonts::getFamilyNames() {
  return tgfxrn::FontRegistry::instance().familyNames();
}

namespace {

std::vector<tgfxrn::TextRun> runsOf(const std::string& text, const tgfxrn::TextSpec& spec) {
  tgfxrn::TextRun run;
  run.text = text;
  run.family = spec.family;
  run.weight = spec.weight;
  run.italic = spec.italic;
  run.letterSpacing = spec.letterSpacing;
  return {run};
}

}  // namespace

std::vector<double> HybridTgfxFonts::glyphIds(const std::string& text,
                                              const TextLayoutStyle& style) {
  auto spec = specOf(style);
  return tgfxrn::glyphIdsFor(text, spec, layoutSize(style.fontSize));
}

std::string HybridTgfxFonts::textPath(const std::string& text, const TextLayoutStyle& style) {
  auto spec = specOf(style);
  return tgfxrn::pathToSvg(
      tgfxrn::textToPath(runsOf(text, spec), spec, layoutSize(style.fontSize)));
}

GlyphPosition HybridTgfxFonts::glyphPositionAtCoordinate(const std::string& text,
                                                         const TextLayoutStyle& style, double x,
                                                         double y) {
  auto spec = specOf(style);
  auto at = tgfxrn::positionAtCoordinate(runsOf(text, spec), spec, layoutSize(style.fontSize),
                                         static_cast<float>(x), static_cast<float>(y));
  return GlyphPosition(static_cast<double>(at.index), at.leading, static_cast<double>(at.line));
}

std::vector<TextBox> HybridTgfxFonts::rectsForRange(const std::string& text,
                                                    const TextLayoutStyle& style, double start,
                                                    double end) {
  auto spec = specOf(style);
  // A NaN or out-of-range double is one `at.index + 1` away when `index` came
  // back undefined, and casting one to int32_t is undefined behaviour.
  auto clamp = [](double value) {
    if (!std::isfinite(value)) {
      return 0;
    }
    return static_cast<int>(std::clamp(value, -2147483648.0, 2147483647.0));
  };
  auto boxes = tgfxrn::boxesForRange(runsOf(text, spec), spec, layoutSize(style.fontSize),
                                     clamp(start), clamp(end));
  std::vector<TextBox> out;
  out.reserve(boxes.size());
  for (const auto& box : boxes) {
    out.emplace_back(box.x, box.y, box.width, box.height, static_cast<double>(box.line),
                     static_cast<double>(box.startIndex), static_cast<double>(box.endIndex));
  }
  return out;
}

TextMeasurement HybridTgfxFonts::measureText(const std::string& text,
                                             const TextLayoutStyle& style) {
  auto spec = specOf(style);
  auto layout = tgfxrn::layoutText(runsOf(text, spec), spec, layoutSize(style.fontSize));
  std::vector<LineMeasurement> lines;
  lines.reserve(layout.metrics.lines.size());
  for (const auto& line : layout.metrics.lines) {
    lines.emplace_back(line.width, line.x, line.baseline, line.ascent, line.descent,
                       static_cast<double>(line.startIndex), static_cast<double>(line.endIndex));
  }
  return TextMeasurement(layout.metrics.width, layout.metrics.height, layout.metrics.ascent,
                         layout.metrics.descent, layout.metrics.lineCount, std::move(lines));
}

}  // namespace margelo::nitro::tgfx
