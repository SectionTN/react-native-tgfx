// The only C++ surface this package exports: producers call setFrame() with a JS-owned handle.
#pragma once

#include <cstdint>
#include <memory>

namespace tgfx {
class Image;
}  // namespace tgfx

namespace tgfxrn {

enum class FrameFormat : int32_t {
  RGBA = 0,
  BT601Limited,
  BT601Full,
  BT709Limited,
  BT709Full,
  BT2020Limited,
  BT2020Full,
  JPEGFull,
};

/// Point `handle` at `buffer` (AHardwareBuffer* / CVPixelBufferRef), releasing the previous one.
bool setFrame(int32_t handle, uint64_t buffer, FrameFormat format) noexcept;

std::shared_ptr<tgfx::Image> importHardwareBuffer(uint64_t buffer, FrameFormat format);

}  // namespace tgfxrn
