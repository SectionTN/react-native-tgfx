#pragma once

#include <memory>
#include <string>
#include <vector>

#include "HybridTgfxImageFactorySpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxImageFactory : public HybridTgfxImageFactorySpec {
 public:
  HybridTgfxImageFactory() : HybridObject(TAG) {}

  std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>> fromFile(
      const std::string& path) override;
  std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>> fromBytes(
      const std::shared_ptr<ArrayBuffer>& bytes) override;
  std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>> fromBase64(
      const std::string& data) override;
  std::shared_ptr<HybridTgfxImageSpec> fromNativeBuffer(uint64_t buffer,
                                                        PixelFormat format) override;
  std::shared_ptr<Promise<void>> savePdf(const std::string& path,
                                         const std::vector<std::shared_ptr<ArrayBuffer>>& pages,
                                         const std::vector<std::string>& strings,
                                         const std::vector<double>& stringCounts,
                                         const std::vector<double>& sizes,
                                         const std::vector<std::string>& metadata) override;
  std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>> fromScene(
      const std::shared_ptr<ArrayBuffer>& words, const std::vector<std::string>& strings,
      double width, double height, double pixelRatio, bool opaque) override;

  void setCacheLimit(double bytes) override;
  double getCachedBytes() override;
};

}  // namespace margelo::nitro::tgfx
