// The JS-facing image handle; owns one ImageRegistry entry and releases it on dispose().
#pragma once

#include <cstdint>
#include <memory>
#include <optional>

#include "HybridTgfxImageSpec.hpp"
#include "ImageRegistry.hpp"
#include "PixelFormat.hpp"

namespace margelo::nitro::tgfx {

/// Import a platform hardware buffer as a GPU-resident image. Zero-copy, no decode.
std::shared_ptr<::tgfx::Image> imageFromNativeBuffer(uint64_t buffer, PixelFormat format);

class HybridTgfxImage : public HybridTgfxImageSpec {
 public:
  explicit HybridTgfxImage(tgfxrn::ImageHandle handle)
      : HybridObject(TAG), handle_(handle) {}

  ~HybridTgfxImage() override {
    dispose();
  }

  double getHandle() override {
    return static_cast<double>(handle_.handle);
  }

  double getWidth() override {
    return static_cast<double>(handle_.width);
  }

  double getHeight() override {
    return static_cast<double>(handle_.height);
  }

  void setNativeBuffer(uint64_t buffer, PixelFormat format) override;

  std::shared_ptr<HybridTgfxImageSpec> subset(double x, double y, double width,
                                              double height) override;
  std::shared_ptr<HybridTgfxImageSpec> scaled(
      double width, double height, std::optional<ImageSampling> sampling) override;
  std::shared_ptr<HybridTgfxImageSpec> oriented(Orientation orientation) override;
  std::shared_ptr<HybridTgfxImageSpec> blurred(double blurX, double blurY) override;

  /// Hermes would otherwise see a few bytes of JS object for a multi-megabyte image.
  size_t getExternalMemorySize() noexcept override {
    return tgfxrn::ImageRegistry::instance().byteSize(handle_.handle);
  }

  void dispose() override {
    if (handle_.handle != 0) {
      tgfxrn::ImageRegistry::instance().remove(handle_.handle);
      handle_.handle = 0;
    }
  }

 private:
  tgfxrn::ImageHandle handle_;
};

}  // namespace margelo::nitro::tgfx
