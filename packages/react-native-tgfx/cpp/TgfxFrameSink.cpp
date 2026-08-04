#include "TgfxFrameSink.hpp"

#include <utility>

#include "ImageRegistry.hpp"
#include "tgfx/core/Image.h"
#include "tgfx/core/YUVColorSpace.h"
#include "tgfx/platform/HardwareBuffer.h"

namespace tgfxrn {

std::shared_ptr<tgfx::Image> importHardwareBuffer(uint64_t buffer, FrameFormat format) {
  if (buffer == 0) {
    return nullptr;
  }
  auto ref = static_cast<tgfx::HardwareBufferRef>(reinterpret_cast<void*>(buffer));
  if (format == FrameFormat::RGBA) {
    // Single-plane surface: imported as-is, with no YUV conversion.
    return tgfx::Image::MakeFrom(ref);
  }
  tgfx::YUVColorSpace space = tgfx::YUVColorSpace::BT601_LIMITED;
  switch (format) {
    case FrameFormat::BT601Full: space = tgfx::YUVColorSpace::BT601_FULL; break;
    case FrameFormat::BT709Limited: space = tgfx::YUVColorSpace::BT709_LIMITED; break;
    case FrameFormat::BT709Full: space = tgfx::YUVColorSpace::BT709_FULL; break;
    case FrameFormat::BT2020Limited: space = tgfx::YUVColorSpace::BT2020_LIMITED; break;
    case FrameFormat::BT2020Full: space = tgfx::YUVColorSpace::BT2020_FULL; break;
    case FrameFormat::JPEGFull: space = tgfx::YUVColorSpace::JPEG_FULL; break;
    default: break;
  }
  return tgfx::Image::MakeFrom(ref, space);
}

bool setFrame(int32_t handle, uint64_t buffer, FrameFormat format) noexcept {
  // noexcept and not just "does not throw today": this runs on a camera thread
  // inside somebody else's callback, where an escaping exception would skip
  // their buffer release and stall a bounded pool.
  try {
    auto image = importHardwareBuffer(buffer, format);
    if (image == nullptr) {
      return false;
    }
    return ImageRegistry::instance().replaceExternal(handle, std::move(image));
  } catch (...) {
    return false;
  }
}

}  // namespace tgfxrn
