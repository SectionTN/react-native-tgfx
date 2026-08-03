// The JS-facing image handle. Owns one entry in the process-wide ImageRegistry
// and releases it on dispose() or destruction, so the draw program can carry a
// four-byte id where it used to carry a base64 payload.
#pragma once

#include <cstdint>

#include "HybridTgfxImageSpec.hpp"
#include "ImageRegistry.hpp"
#include "PixelFormat.hpp"

namespace margelo::nitro::tgfx {

/// Import a platform hardware buffer as a GPU-resident image. Zero-copy: no
/// decode, no CPU round trip. Shared with the factory, which creates the first
/// handle for a buffer where this replaces it per frame.
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

  /// The decoded pixels this handle owns. Without it Hermes sees a few bytes of
  /// JS object for a multi-megabyte image and collects it late — which is
  /// exactly when the memory matters. Zero for a hardware-buffer handle: that
  /// memory is the producer's, not this handle's.
  size_t getExternalMemorySize() noexcept override {
    return tgfxrn::ImageRegistry::instance().byteSize(handle_.handle);
  }

  /// Overridden from HybridObject: JS calls it directly, and the destructor
  /// calls it for the callers who never do. Idempotent.
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
