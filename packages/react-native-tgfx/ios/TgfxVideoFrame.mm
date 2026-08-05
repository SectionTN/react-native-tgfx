#import "TgfxVideoFrame.h"

#include "ImageRegistry.hpp"
#include "TgfxFrameSink.hpp"

int32_t TgfxVideoFrameSet(int32_t handle, CVPixelBufferRef buffer, int32_t format) {
  if (buffer == nullptr) {
    return 0;
  }
  auto frameFormat = static_cast<tgfxrn::FrameFormat>(format);
  auto image = tgfxrn::importHardwareBuffer(reinterpret_cast<uint64_t>(buffer), frameFormat);
  if (image == nullptr) {
    return 0;
  }
  auto& registry = tgfxrn::ImageRegistry::instance();
  if (handle == 0) {
    return registry.addExternal(std::move(image)).handle;
  }
  return registry.replaceExternal(handle, std::move(image)) ? handle : 0;
}

void TgfxVideoFrameRemove(int32_t handle) {
  if (handle != 0) {
    tgfxrn::ImageRegistry::instance().remove(handle);
  }
}
