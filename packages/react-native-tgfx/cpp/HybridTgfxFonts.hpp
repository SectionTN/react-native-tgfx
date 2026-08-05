#pragma once

#include <memory>
#include <string>
#include <vector>

#include "HybridTgfxFontsSpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxFonts : public HybridTgfxFontsSpec {
 public:
  HybridTgfxFonts() : HybridObject(TAG) {}

  std::shared_ptr<Promise<std::string>> registerFromFile(const std::string& path,
                                                         const std::string& family) override;
  std::shared_ptr<Promise<std::string>> registerFromBytes(
      const std::shared_ptr<ArrayBuffer>& bytes, const std::string& family) override;
  std::shared_ptr<Promise<std::string>> registerFromBase64(const std::string& data,
                                                           const std::string& family) override;

  std::vector<std::string> getFamilyNames() override;

  TextMeasurement measureText(const std::string& text, const TextLayoutStyle& style) override;
  std::string textPath(const std::string& text, const TextLayoutStyle& style) override;
  std::vector<double> glyphIds(const std::string& text, const TextLayoutStyle& style) override;
};

}  // namespace margelo::nitro::tgfx
