#pragma once

#include <memory>
#include <string>

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

  void setCacheLimit(double bytes) override;
  double getCachedBytes() override;
};

}  // namespace margelo::nitro::tgfx
