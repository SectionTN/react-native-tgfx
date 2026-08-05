// The native frame-processor plugin: camera thread to tgfx handle, no JS runtime on the path.
#pragma once

#include <atomic>
#include <memory>

#include "HybridTgfxCameraSinkSpec.hpp"

namespace margelo::nitro::tgfxcamera {

class HybridTgfxCameraSink : public HybridTgfxCameraSinkSpec {
 public:
  HybridTgfxCameraSink() : HybridObject(TAG) {}

  ~HybridTgfxCameraSink() override {
    detach();
  }

  void attach(const std::shared_ptr<camera::HybridCameraFrameOutputSpec>& output,
              double handle) override;
  void detach() override;

  void dispose() override {
    detach();
  }

  double getFrameCount() override {
    return static_cast<double>(frames_->load(std::memory_order_relaxed));
  }

 private:
  /// Held by value in the callback, which outlives this object if JS drops the sink first.
  std::shared_ptr<std::atomic<uint64_t>> frames_ =
      std::make_shared<std::atomic<uint64_t>>(0);
  std::shared_ptr<camera::HybridCameraFrameOutputSpec> output_;
};

}  // namespace margelo::nitro::tgfxcamera
