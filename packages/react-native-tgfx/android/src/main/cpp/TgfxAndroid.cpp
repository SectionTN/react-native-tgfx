// JNI bridge for the Android tgfx view. Creates an EGL-backed tgfx::Window from
// the Java Surface and forwards scene/draw/lifecycle calls to TgfxRenderer.
#include <android/native_window_jni.h>
#include <jni.h>

#include <memory>
#include <mutex>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "Log.hpp"
#include "TgfxRenderer.hpp"
#include "tgfx/gpu/opengl/egl/EGLWindow.h"
#include "tgfx/platform/HardwareBuffer.h"

namespace {

// Captured in setWakeTarget(): a wake can originate on the camera producer's
// thread or on the image registry's decode worker, neither of which is a Java
// thread, so the JVM has to be reachable from any of them.
JavaVM* gVm = nullptr;

JNIEnv* wakeEnv() {
  JNIEnv* env = nullptr;
  if (gVm == nullptr) {
    return nullptr;
  }
  if (gVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_OK) {
    return env;
  }
  // As a daemon, so a thread we do not own is not required to detach at exit.
  return gVm->AttachCurrentThreadAsDaemon(&env, nullptr) == JNI_OK ? env : nullptr;
}

struct HardwareBufferReleaser {
  void operator()(AHardwareBuffer* buffer) const {
    tgfx::HardwareBufferRelease(buffer);
  }
};

// Owns its acquired buffer, so the buffer outlives the frame processor's reference.
struct PendingCameraFrame {
  std::unique_ptr<AHardwareBuffer, HardwareBufferReleaser> buffer;
  float frameWidth = 0;
  float frameHeight = 0;
  float blurRadius = 0;
  std::vector<float> contours;
};

// Owns the renderer plus the ANativeWindow reference acquired from the Surface,
// so we can release the window only after the EGL window has been torn down.
struct AndroidTgfxView {
  tgfxrn::TgfxRenderer renderer;
  ANativeWindow* nativeWindow = nullptr;

  // The TgfxRenderTarget to post a draw on, for a change no staging call
  // announced. Global, because the wake does not come from a Java thread.
  jobject wakeTarget = nullptr;
  jmethodID requestRender = nullptr;

  // Single slot: an undrawn frame is superseded by the next, never queued behind it.
  std::mutex frameMutex;
  PendingCameraFrame pendingFrame;

  void releaseWindow() {
    renderer.releaseWindow();
    if (nativeWindow != nullptr) {
      ANativeWindow_release(nativeWindow);
      nativeWindow = nullptr;
    }
  }
};

AndroidTgfxView* asView(jlong ptr) {
  return reinterpret_cast<AndroidTgfxView*>(ptr);
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_create(JNIEnv*, jobject) {
  return reinterpret_cast<jlong>(new AndroidTgfxView());
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_surfaceCreated(JNIEnv* env, jobject,
                                                      jlong ptr,
                                                      jobject surface) {
  auto* view = asView(ptr);
  if (view == nullptr || surface == nullptr) {
    return;
  }
  if (view->nativeWindow != nullptr) {
    view->renderer.releaseWindow();
    ANativeWindow_release(view->nativeWindow);
    view->nativeWindow = nullptr;
  }
  view->nativeWindow = ANativeWindow_fromSurface(env, surface);
  if (view->nativeWindow == nullptr) {
    return;
  }
  auto window = tgfx::EGLWindow::MakeFrom(view->nativeWindow);
  view->renderer.setWindow(window);
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_surfaceChanged(JNIEnv*, jobject,
                                                      jlong ptr, jint, jint) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.onResize();
  }
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_surfaceDestroyed(JNIEnv*, jobject,
                                                        jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->releaseWindow();
  }
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setPixelRatio(JNIEnv*, jobject, jlong ptr,
                                                     jfloat ratio) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.setPixelRatio(static_cast<float>(ratio));
  }
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setScene(JNIEnv* env, jobject, jlong ptr,
                                                jobject sceneBuffer,
                                                jobjectArray stringTable) {
  auto* view = asView(ptr);
  if (view == nullptr || sceneBuffer == nullptr) {
    return;
  }
  // The ArrayBuffer belongs to JS and is only valid for this call, so the
  // renderer copies the words before returning.
  auto* words = static_cast<const double*>(
      env->GetDirectBufferAddress(sceneBuffer));
  auto bytes = env->GetDirectBufferCapacity(sceneBuffer);
  if (words == nullptr || bytes <= 0) {
    // Returning here also drops the string-table delta, which JS has already
    // committed to and cannot resend — the engine's table stays a commit behind
    // for the life of the view. Only reachable on a null/empty buffer, and the
    // next delta warns in applyStringTable, so it is left as is; do not add a
    // third early return above renderer.setScene without routing the delta in.
    return;
  }
  std::vector<std::string> strings;
  if (stringTable != nullptr) {
    jsize count = env->GetArrayLength(stringTable);
    strings.reserve(static_cast<size_t>(count));
    for (jsize i = 0; i < count; i++) {
      auto item = reinterpret_cast<jstring>(
          env->GetObjectArrayElement(stringTable, i));
      const char* chars = item != nullptr
                              ? env->GetStringUTFChars(item, nullptr)
                              : nullptr;
      strings.emplace_back(chars != nullptr ? chars : "");
      if (chars != nullptr) {
        env->ReleaseStringUTFChars(item, chars);
      }
      env->DeleteLocalRef(item);
    }
  }
  view->renderer.setScene(
      std::span<const double>(words, static_cast<size_t>(bytes) / sizeof(double)),
      strings);
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setOpaque(JNIEnv*, jobject, jlong ptr,
                                                 jboolean opaque) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.setOpaque(opaque == JNI_TRUE);
  }
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_clearScene(JNIEnv*, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.clearScene();
  }
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setValues(JNIEnv* env, jobject, jlong ptr,
                                                 jdoubleArray arr) {
  auto* view = asView(ptr);
  if (view == nullptr || arr == nullptr) {
    return;
  }
  jsize len = env->GetArrayLength(arr);
  std::vector<double> values(static_cast<size_t>(len));
  if (len > 0) {
    env->GetDoubleArrayRegion(arr, 0, len, values.data());
  }
  view->renderer.setValues(values);
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_stageCameraFrame(JNIEnv* env, jobject, jlong ptr,
                                                       jlong buffer, jfloat frameWidth,
                                                       jfloat frameHeight, jfloatArray contours,
                                                       jfloat blurRadius) {
  auto* view = asView(ptr);
  if (view == nullptr || buffer == 0) {
    return;
  }
  PendingCameraFrame frame;
  // Acquired here, on the producer thread: the caller drops its reference as soon as this returns.
  // Retain is a no-op below API 26, where no AHardwareBuffer can reach us in the first place.
  frame.buffer.reset(tgfx::HardwareBufferRetain(reinterpret_cast<AHardwareBuffer*>(buffer)));
  frame.frameWidth = frameWidth;
  frame.frameHeight = frameHeight;
  frame.blurRadius = blurRadius;
  if (contours != nullptr) {
    jsize len = env->GetArrayLength(contours);
    frame.contours.resize(static_cast<size_t>(len));
    if (len > 0) {
      env->GetFloatArrayRegion(contours, 0, len, frame.contours.data());
    }
  }
  {
    std::lock_guard<std::mutex> guard(view->frameMutex);
    std::swap(view->pendingFrame, frame);
  }
  // `frame` now holds the superseded frame, if any; released as it goes out of scope.
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_drawCameraFrame(JNIEnv*, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view == nullptr) {
    return;
  }
  PendingCameraFrame frame;
  {
    std::lock_guard<std::mutex> guard(view->frameMutex);
    std::swap(view->pendingFrame, frame);
  }
  if (frame.buffer == nullptr) {
    return;
  }
  view->renderer.drawCameraFrame(frame.buffer.get(), frame.frameWidth, frame.frameHeight,
                                 frame.contours, frame.blurRadius);
}

JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_draw(JNIEnv*, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    return view->renderer.draw() ? JNI_TRUE : JNI_FALSE;
  }
  return JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setWakeTarget(JNIEnv* env, jobject, jlong ptr,
                                                     jobject target) {
  auto* view = asView(ptr);
  if (view == nullptr || target == nullptr) {
    return;
  }
  env->GetJavaVM(&gVm);
  view->wakeTarget = env->NewGlobalRef(target);
  jclass cls = env->GetObjectClass(target);
  view->requestRender = env->GetMethodID(cls, "requestRender", "()V");
  env->DeleteLocalRef(cls);
  if (view->requestRender == nullptr) {
    // A pending NoSuchMethodError would abort the next JNI call instead.
    env->ExceptionClear();
    TGFXRN_LOGW("TgfxRenderTarget.requestRender() not found; a swapped hardware "
                "buffer will not schedule a draw");
    return;
  }
  // Only posts a runnable, so it is safe to run under the registry's listener
  // lock and from whichever thread changed the image.
  view->renderer.setWakeCallback([view] {
    JNIEnv* wake = wakeEnv();
    if (wake != nullptr) {
      wake->CallVoidMethod(view->wakeTarget, view->requestRender);
    }
  });
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_destroy(JNIEnv* env, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    // Before the global ref goes: the callback reads it.
    view->renderer.setWakeCallback(nullptr);
    if (view->wakeTarget != nullptr) {
      env->DeleteGlobalRef(view->wakeTarget);
      view->wakeTarget = nullptr;
    }
    view->releaseWindow();
    delete view;
  }
}

}  // extern "C"
