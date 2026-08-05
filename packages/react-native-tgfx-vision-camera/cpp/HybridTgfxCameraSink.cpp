#include "HybridTgfxCameraSink.hpp"

#include <NitroTgfx/TgfxFrameSink.hpp>
#include <VisionCamera/HybridFrameSpec.hpp>
#include <VisionCamera/HybridNativeThreadSpec.hpp>
#include <VisionCamera/NativeBuffer.hpp>
#include <VisionCamera/PixelFormat.hpp>

namespace margelo::nitro::tgfxcamera {

namespace {

/// Only the range varies; full imported as limited crushes blacks. ponytail: BT.601 for all YUV.
tgfxrn::FrameFormat toFrameFormat(camera::PixelFormat format) {
  switch (format) {
    case camera::PixelFormat::YUV_420_8_BIT_FULL:
    case camera::PixelFormat::YUV_420_10_BIT_FULL:
    case camera::PixelFormat::YUV_422_8_BIT_FULL:
    case camera::PixelFormat::YUV_422_10_BIT_FULL:
    case camera::PixelFormat::YUV_444_8_BIT_FULL:
      return tgfxrn::FrameFormat::BT601Full;
    case camera::PixelFormat::RGB_BGRA_8_BIT:
    case camera::PixelFormat::RGB_RGBA_8_BIT:
    case camera::PixelFormat::RGB_RGB_8_BIT:
      return tgfxrn::FrameFormat::RGBA;
    default:
      return tgfxrn::FrameFormat::BT601Limited;
  }
}

}  // namespace

void HybridTgfxCameraSink::attach(
    const std::shared_ptr<camera::HybridCameraFrameOutputSpec>& output, double handle) {
  if (output == nullptr) {
    return;
  }
  // Not just overwriting output_: a second attach() would leave the first callback installed.
  detach();
  output_ = output;
  auto id = static_cast<int32_t>(handle);
  auto frames = frames_;
  frames->store(0, std::memory_order_relaxed);

  // setOnFrameCallback() throws off the output's thread, and runOnThread() only defers from JS.
  auto thread = output->getThread();
  thread->runOnThread([output, id, frames]() {
    output->setOnFrameCallback(
        [id, frames](const std::shared_ptr<camera::HybridFrameSpec>& frame) -> bool {
          // Everything that can throw is inside the try: one escape stalls the bounded pool.
          camera::NativeBuffer buffer;
          bool acquired = false;
          try {
            buffer = frame->getNativeBuffer();
            acquired = true;
            if (tgfxrn::setFrame(id, buffer.pointer, toFrameFormat(frame->getPixelFormat()))) {
              frames->fetch_add(1, std::memory_order_relaxed);
            }
          } catch (...) {
            // Swallowed: there is no JS to throw into, and the release below still has to run.
          }
          if (acquired && buffer.release != nullptr) {
            buffer.release();
          }
          frame->dispose();
          return true;
        });
  });
}

void HybridTgfxCameraSink::detach() {
  auto output = output_;
  if (output == nullptr) {
    return;
  }
  output_ = nullptr;
  output->getThread()->runOnThread(
      [output]() { output->setOnFrameCallback(std::nullopt); });
}

}  // namespace margelo::nitro::tgfxcamera
