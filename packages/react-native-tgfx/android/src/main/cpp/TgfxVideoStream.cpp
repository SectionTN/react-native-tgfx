// Android video frames: a tgfx SurfaceTextureReader the decoder renders into.
//
// Not the AHardwareBuffer path <Image> uses for camera frames — a video decoder
// hands back vendor-private buffer formats (0x123 on Exynos, and so on) that
// tgfx cannot import, so the frames come through a SurfaceTexture instead.
#include <jni.h>

#include <atomic>
#include <memory>
#include <mutex>

#include "ImageRegistry.hpp"
#include "tgfx/core/Image.h"
#include "tgfx/platform/android/SurfaceTextureReader.h"

namespace {

struct VideoStream {
  std::mutex mutex;
  // Null between a background and the rebuild that follows the next resume.
  std::shared_ptr<tgfx::SurfaceTextureReader> reader;
  int width = 0;
  int height = 0;
  // Stable for the video's life: the scene refers to it, so it must not move.
  int32_t handle = 0;
  // Set by the decoder, cleared by the pump, and the only thing that schedules a
  // redraw. Without it a 30 fps video would repaint every canvas at display rate.
  std::atomic<bool> available{false};

  std::shared_ptr<tgfx::SurfaceTextureReader> current() {
    std::lock_guard<std::mutex> lock(mutex);
    return reader;
  }
};

/// A shared_ptr so a draw already inside the producer keeps the stream alive.
std::shared_ptr<VideoStream>* asHolder(jlong ptr) {
  return reinterpret_cast<std::shared_ptr<VideoStream>*>(ptr);
}

std::shared_ptr<VideoStream> asStream(jlong ptr) {
  auto* holder = asHolder(ptr);
  return holder != nullptr ? *holder : nullptr;
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamCreate(
    JNIEnv*, jobject, jint width, jint height, jobject listener) {
  auto reader = tgfx::SurfaceTextureReader::Make(width, height, listener);
  if (reader == nullptr) {
    return 0;
  }
  auto stream = std::make_shared<VideoStream>();
  stream->reader = std::move(reader);
  stream->width = width;
  stream->height = height;
  // Produced at draw time, not pushed: a SurfaceTexture buffer is good for one
  // texture generation, so an image made ahead of the draw expires unused — and a
  // paused video, whose last frame is then redrawn, would go black.
  stream->handle = tgfxrn::ImageRegistry::instance()
                       .addStream(
                           [stream]() -> std::shared_ptr<tgfx::Image> {
                             auto reader = stream->current();
                             if (reader == nullptr) {
                               return nullptr;
                             }
                             auto buffer = reader->acquireNextBuffer();
                             return buffer != nullptr ? tgfx::Image::MakeFrom(std::move(buffer))
                                                      : nullptr;
                           },
                           width, height)
                       .handle;
  return reinterpret_cast<jlong>(new std::shared_ptr<VideoStream>(std::move(stream)));
}

JNIEXPORT jobject JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamSurface(
    JNIEnv*, jobject, jlong ptr) {
  auto stream = asStream(ptr);
  if (stream == nullptr) {
    return nullptr;
  }
  auto reader = stream->current();
  return reader != nullptr ? reader->createInputSurface() : nullptr;
}

JNIEXPORT void JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamNotify(JNIEnv*, jobject,
                                                                                jlong ptr) {
  auto stream = asStream(ptr);
  if (stream == nullptr) {
    return;
  }
  auto reader = stream->current();
  if (reader != nullptr) {
    reader->notifyFrameAvailable();
    stream->available.store(true, std::memory_order_release);
  }
}

JNIEXPORT jint JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamUpdate(JNIEnv*, jobject,
                                                                               jlong ptr) {
  auto stream = asStream(ptr);
  if (stream == nullptr) {
    return 0;
  }
  // Only a frame the decoder actually produced costs a redraw.
  if (stream->available.exchange(false, std::memory_order_acq_rel)) {
    tgfxrn::ImageRegistry::instance().invalidate();
  }
  return stream->handle;
}

/**
 * Drop the reader, for a canvas whose GPU context is about to go away.
 *
 * Its buffers are bound to the context that first drew them, so drawing one
 * against the context a resumed app builds instead dereferences a null context
 * deep inside tgfx. Nothing is drawn until videoStreamRebuild() lands.
 */
JNIEXPORT void JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamRelease(JNIEnv*, jobject,
                                                                                jlong ptr) {
  auto stream = asStream(ptr);
  if (stream == nullptr) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(stream->mutex);
    stream->reader = nullptr;
  }
  stream->available.store(false, std::memory_order_release);
  tgfxrn::ImageRegistry::instance().invalidate();
}

/// A fresh reader on the same handle. Returns its Surface; the decoder must be re-pointed at it.
JNIEXPORT jobject JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamRebuild(
    JNIEnv*, jobject, jlong ptr, jobject listener) {
  auto stream = asStream(ptr);
  if (stream == nullptr) {
    return nullptr;
  }
  auto reader = tgfx::SurfaceTextureReader::Make(stream->width, stream->height, listener);
  if (reader == nullptr) {
    return nullptr;
  }
  {
    std::lock_guard<std::mutex> lock(stream->mutex);
    stream->reader = reader;
  }
  return reader->createInputSurface();
}

JNIEXPORT void JNICALL Java_com_margelo_nitro_tgfx_TgfxNative_videoStreamDestroy(JNIEnv*, jobject,
                                                                                jlong ptr) {
  auto* holder = asHolder(ptr);
  if (holder == nullptr) {
    return;
  }
  auto stream = *holder;
  if (stream != nullptr) {
    {
      std::lock_guard<std::mutex> lock(stream->mutex);
      stream->reader = nullptr;
    }
    // Drops the registry's reference to the producer, and with it the stream.
    tgfxrn::ImageRegistry::instance().remove(stream->handle);
  }
  delete holder;
}

}  // extern "C"
