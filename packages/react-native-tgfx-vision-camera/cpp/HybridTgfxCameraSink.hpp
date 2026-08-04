// The native frame-processor plugin: camera thread -> tgfx image handle, with
// no JS runtime anywhere on the path.
//
// VisionCamera v5 has no FrameProcessorPlugin subclass and no
// VISION_EXPORT_SWIFT_FRAME_PROCESSOR macro any more — a plugin is just a Nitro
// HybridObject, and this one is C++ so a single implementation serves both
// platforms.
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

  /// Overridden from HybridObject: JS calls it directly, and the destructor
  /// calls it for the callers who never do. detach() is idempotent.
  void dispose() override {
    detach();
  }

  double getFrameCount() override {
    return static_cast<double>(frames_->load(std::memory_order_relaxed));
  }

 private:
  /// Held by value in the frame callback, which outlives this object if JS
  /// drops the sink before the camera thread has run detach()'s swap.
  std::shared_ptr<std::atomic<uint64_t>> frames_ =
      std::make_shared<std::atomic<uint64_t>>(0);
  std::shared_ptr<camera::HybridCameraFrameOutputSpec> output_;
};

}  // namespace margelo::nitro::tgfxcamera
