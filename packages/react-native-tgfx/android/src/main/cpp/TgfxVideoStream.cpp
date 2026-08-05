// Android video frames: a tgfx SurfaceTextureReader the decoder renders into.
//
// Not the AHardwareBuffer path <Image> uses for camera frames — a video decoder
// hands back vendor-private buffer formats (0x123 on Exynos, and so on) that
// tgfx cannot import, so the frames come through a SurfaceTexture instead.
#include <jni.h>

#include <atomic>
#include <memory>

#include "ImageRegistry.hpp"
#include "tgfx/core/Image.h"
#include "tgfx/platform/android/SurfaceTextureReader.h"

namespace {

struct VideoStream {
  std::shared_ptr<tgfx::SurfaceTextureReader> reader;
  // Stable for the video's life: the scene refers to it, so it must not move.
  int32_t handle = 0;
  // Set by the decoder, cleared by the pump, and the only thing that schedules a
  // redraw. Without it a 30 fps video would repaint every canvas at display rate.
  std::atomic<bool> available{false};
};

VideoStream* asStream(jlong ptr) {
  return reinterpret_cast<VideoStream*>(ptr);
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamCreate(
    JNIEnv*, jobject, jint width, jint height, jobject listener) {
  auto reader = tgfx::SurfaceTextureReader::Make(width, height, listener);
  if (reader == nullptr) {
    return 0;
  }
  auto* stream = new VideoStream();
  stream->reader = std::move(reader);
  // Produced at draw time, not pushed: a SurfaceTexture buffer is good for one
  // texture generation, so an image made ahead of the draw expires unused — and a
  // paused video, whose last frame is then redrawn, would go black.
  // Captures the reader, not the stream: a draw already inside this when the video
  // is released would otherwise be reading freed memory.
  auto source = stream->reader;
  stream->handle = tgfxrn::ImageRegistry::instance()
                       .addStream(
                           [source]() -> std::shared_ptr<tgfx::Image> {
                             auto buffer = source->acquireNextBuffer();
                             return buffer != nullptr ? tgfx::Image::MakeFrom(std::move(buffer))
                                                      : nullptr;
                           },
                           width, height)
                       .handle;
  return reinterpret_cast<jlong>(stream);
}

JNIEXPORT jobject JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamSurface(
    JNIEnv*, jobject, jlong ptr) {
  auto* stream = asStream(ptr);
  return stream != nullptr ? stream->reader->createInputSurface() : nullptr;
}

JNIEXPORT void JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamNotify(JNIEnv*, jobject,
                                                                                jlong ptr) {
  auto* stream = asStream(ptr);
  if (stream != nullptr) {
    stream->reader->notifyFrameAvailable();
    stream->available.store(true, std::memory_order_release);
  }
}

JNIEXPORT jint JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamUpdate(JNIEnv*, jobject,
                                                                               jlong ptr) {
  auto* stream = asStream(ptr);
  if (stream == nullptr) {
    return 0;
  }
  // Only a frame the decoder actually produced costs a redraw.
  if (stream->available.exchange(false, std::memory_order_acq_rel)) {
    tgfxrn::ImageRegistry::instance().invalidate();
  }
  return stream->handle;
}

JNIEXPORT void JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamDestroy(JNIEnv*, jobject,
                                                                                jlong ptr) {
  auto* stream = asStream(ptr);
  if (stream == nullptr) {
    return;
  }
  if (stream->handle != 0) {
    tgfxrn::ImageRegistry::instance().remove(stream->handle);
  }
  delete stream;
}

}  // extern "C"
