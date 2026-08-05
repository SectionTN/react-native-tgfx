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
  // Allocated on the first frame and kept: the scene refers to it, so it must not move.
  int32_t handle = 0;
  // Set by the decoder, cleared by the pump. Acquiring without it would hand out a
  // buffer that expires the previous one before the renderer ever drew it — a 30 fps
  // video pulled on a 120 Hz UI thread would show one frame and then freeze.
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
  // The reader has content from the moment the decoder writes its first frame.
  stream->available.store(true, std::memory_order_release);
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
  if (!stream->available.exchange(false, std::memory_order_acq_rel)) {
    return 0;
  }
  auto buffer = stream->reader->acquireNextBuffer();
  if (buffer == nullptr) {
    return 0;
  }
  auto image = tgfx::Image::MakeFrom(std::move(buffer));
  if (image == nullptr) {
    return 0;
  }
  auto& registry = tgfxrn::ImageRegistry::instance();
  if (stream->handle == 0) {
    stream->handle = registry.addExternal(std::move(image)).handle;
  } else if (!registry.replaceExternal(stream->handle, std::move(image))) {
    return 0;
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
