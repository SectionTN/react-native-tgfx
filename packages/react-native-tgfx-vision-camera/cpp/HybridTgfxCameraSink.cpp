#include "HybridTgfxCameraSink.hpp"

#include <NitroTgfx/TgfxFrameSink.hpp>
#include <VisionCamera/HybridFrameSpec.hpp>
#include <VisionCamera/HybridNativeThreadSpec.hpp>
#include <VisionCamera/NativeBuffer.hpp>
#include <VisionCamera/PixelFormat.hpp>

namespace margelo::nitro::tgfxcamera {

namespace {

/// VisionCamera's pixel format to tgfx's colour interpretation.
///
/// Only the *range* varies in practice — every YUV format the camera emits is
/// BT.601 here — and it is the part that is easy to get wrong: importing
/// full-range planes as limited-range crushes the blacks. Read, never assumed.
///
/// ponytail: BT.601 for every YUV format, which is what a camera pipeline
/// gives. Widen it if a device is found streaming BT.709.
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
  // Not just overwriting output_: a second attach() to a *different* output
  // would otherwise leave the first one's callback installed, writing frames
  // into a handle nobody is watching with nothing left to remove it.
  detach();
  output_ = output;
  auto id = static_cast<int32_t>(handle);
  auto frames = frames_;
  frames->store(0, std::memory_order_relaxed);

  // setOnFrameCallback() throws unless it runs on the output's own thread, and
  // runOnThread() only *defers* when the task came from JS — so this hop has to
  // be native. It also serialises the swap with frame delivery, which is what
  // makes replacing a running JS callback safe.
  auto thread = output->getThread();
  thread->runOnThread([output, id, frames]() {
    output->setOnFrameCallback(
        [id, frames](const std::shared_ptr<camera::HybridFrameSpec>& frame) -> bool {
          // Everything that can throw is inside the try. VisionCamera's buffer
          // pool is bounded: one escaped throw skips the dispose() below and
          // the pipeline stalls within seconds.
          camera::NativeBuffer buffer;
          bool acquired = false;
          try {
            buffer = frame->getNativeBuffer();
            acquired = true;
            // Zero-copy: the hardware buffer becomes a GPU texture in place.
            // The registry bumps its epoch, which wakes the render loop, and an
            // undrawn frame is superseded rather than queued.
            if (tgfxrn::setFrame(id, buffer.pointer, toFrameFormat(frame->getPixelFormat()))) {
              frames->fetch_add(1, std::memory_order_relaxed);
            }
          } catch (...) {
            // Swallowed on purpose: there is no JS on this path to throw into,
            // and the release/dispose below still has to run.
          }
          if (acquired && buffer.release != nullptr) {
            // The handle took its own reference, so the producer's slot is free
            // the moment this returns.
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
