#include "HybridTgfxFonts.hpp"

#include <algorithm>
#include <stdexcept>
#include <utility>

#include "Base64.hpp"
#include "FontRegistry.hpp"
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

/// A `file://` URI names a path; anything else already is one.
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
  spec.letterSpacing = static_cast<float>(style.letterSpacing);
  spec.wrapWidth = static_cast<float>(style.width);
  spec.align = static_cast<tgfxrn::TextAlign>(
      std::clamp(static_cast<int>(style.align), 0, 2));
  spec.lineHeight = static_cast<float>(style.lineHeight);
  spec.maxLines = static_cast<int>(style.maxLines);
  spec.ellipsis = style.ellipsis;
  return spec;
}

}  // namespace

std::shared_ptr<NamePromise> HybridTgfxFonts::registerFromFile(const std::string& path,
                                                               const std::string& family) {
  return NamePromise::async([file = stripFileScheme(path), family]() {
    return registerTypeface(::tgfx::Typeface::MakeFromPath(file), family, file);
  });
}

std::shared_ptr<NamePromise> HybridTgfxFonts::registerFromBytes(
    const std::shared_ptr<ArrayBuffer>& bytes, const std::string& family) {
  // A JS-owned ArrayBuffer only lives for this call, so the copy happens here
  // rather than on the thread pool — and the typeface reads from it for its
  // whole life, so it has to be a copy the registry owns.
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

TextMeasurement HybridTgfxFonts::measureText(const std::string& text,
                                             const TextLayoutStyle& style) {
  auto layout = tgfxrn::layoutText(text, specOf(style), static_cast<float>(style.fontSize));
  return TextMeasurement(layout.metrics.width, layout.metrics.height, layout.metrics.ascent,
                         layout.metrics.descent, layout.metrics.lineCount);
}

}  // namespace margelo::nitro::tgfx
