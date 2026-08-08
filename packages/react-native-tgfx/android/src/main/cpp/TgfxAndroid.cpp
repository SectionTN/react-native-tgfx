// JNI bridge for the Android tgfx view: an EGL tgfx::Window from the Java Surface.
#include <android/native_window_jni.h>
#include <jni.h>

#include <memory>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "Log.hpp"
#include "Snapshot.hpp"
#include "TgfxRenderer.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/ColorSpace.h"
#include "tgfx/gpu/opengl/egl/EGLWindow.h"
#include "tgfx/platform/android/HardwareBufferJNI.h"

namespace {

// A wake can originate on a camera or decode thread, neither of which is a Java thread.
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

struct AndroidTgfxView {
  tgfxrn::TgfxRenderer renderer;
  ANativeWindow* nativeWindow = nullptr;

  // The TgfxRenderTarget to post a draw on. Global: the wake is not from a Java thread.
  jobject wakeTarget = nullptr;
  jmethodID requestRender = nullptr;

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

std::string toString(JNIEnv* env, jstring value) {
  if (value == nullptr) {
    return "";
  }
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string result = chars != nullptr ? chars : "";
  if (chars != nullptr) {
    env->ReleaseStringUTFChars(value, chars);
  }
  return result;
}

class SnapshotSink {
 public:
  SnapshotSink(JNIEnv* env, jobject callback) {
    env->GetJavaVM(&vm_);
    callback_ = env->NewGlobalRef(callback);
  }

  ~SnapshotSink() {
    if (callback_ == nullptr) {
      return;
    }
    withEnv([this](JNIEnv* env) { env->DeleteGlobalRef(callback_); });
  }

  SnapshotSink(const SnapshotSink&) = delete;
  SnapshotSink& operator=(const SnapshotSink&) = delete;

  void deliver(const std::shared_ptr<tgfx::Data>& data, int width, int height,
               const std::string& error) {
    withEnv([&](JNIEnv* env) {
      jobject buffer =
          data != nullptr
              ? env->NewDirectByteBuffer(const_cast<void*>(data->data()),
                                         static_cast<jlong>(data->size()))
              : nullptr;
      jstring message = error.empty() ? nullptr : env->NewStringUTF(error.c_str());
      jclass type = env->GetObjectClass(callback_);
      jmethodID method = env->GetMethodID(
          type, "onSnapshot", "(Ljava/nio/ByteBuffer;IILjava/lang/String;)V");
      if (method != nullptr) {
        env->CallVoidMethod(callback_, method, buffer, width, height, message);
      }
      env->DeleteLocalRef(type);
      if (buffer != nullptr) {
        env->DeleteLocalRef(buffer);
      }
      if (message != nullptr) {
        env->DeleteLocalRef(message);
      }
    });
  }

 private:
  template <typename Body>
  void withEnv(Body&& body) {
    if (vm_ == nullptr) {
      return;
    }
    JNIEnv* env = nullptr;
    bool attached = false;
    if (vm_->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
      if (vm_->AttachCurrentThread(&env, nullptr) != JNI_OK) {
        return;
      }
      attached = true;
    }
    body(env);
    if (attached) {
      vm_->DetachCurrentThread();
    }
  }

  JavaVM* vm_ = nullptr;
  jobject callback_ = nullptr;
};

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
  auto space = view->renderer.wantsDisplayP3() ? tgfx::ColorSpace::DisplayP3()
                                               : tgfx::ColorSpace::SRGB();
  auto window = tgfx::EGLWindow::MakeFrom(view->nativeWindow, nullptr, space);
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
  // The ArrayBuffer is only valid for this call, so the renderer copies the words.
  auto* words = static_cast<const double*>(
      env->GetDirectBufferAddress(sceneBuffer));
  auto bytes = env->GetDirectBufferCapacity(sceneBuffer);
  if (words == nullptr || bytes <= 0) {
    // Drops the string-table delta too, which JS cannot resend; do not add a third early return.
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

JNIEXPORT jdoubleArray JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_hitTest(JNIEnv* env, jobject, jlong ptr, jfloat x,
                                               jfloat y, jboolean precise) {
  auto* view = asView(ptr);
  if (view == nullptr) {
    return env->NewDoubleArray(0);
  }
  auto hits = view->renderer.hitTest(x, y, precise == JNI_TRUE);
  auto out = env->NewDoubleArray(static_cast<jsize>(hits.size()));
  if (out != nullptr && !hits.empty()) {
    env->SetDoubleArrayRegion(out, 0, static_cast<jsize>(hits.size()), hits.data());
  }
  return out;
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_setColorSpace(JNIEnv*, jobject, jlong ptr,
                                                    jboolean displayP3) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.setColorSpace(displayP3 == JNI_TRUE);
  }
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
  view->renderer.setWakeCallback([view] {
    JNIEnv* wake = wakeEnv();
    if (wake != nullptr) {
      wake->CallVoidMethod(view->wakeTarget, view->requestRender);
    }
  });
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_snapshot(
    JNIEnv* env, jobject, jlong ptr, jstring format, jint quality, jfloat x,
    jfloat y, jfloat width, jfloat height, jfloat scale, jstring path,
    jobject callback) {
  auto* view = asView(ptr);
  if (callback == nullptr) {
    return;
  }
  auto sink = std::make_shared<SnapshotSink>(env, callback);
  if (view == nullptr) {
    sink->deliver(nullptr, 0, 0, "[tgfx] snapshot: the canvas is no longer mounted");
    return;
  }
  tgfxrn::SnapshotRequest request;
  request.format = toString(env, format);
  request.quality = quality;
  request.x = x;
  request.y = y;
  request.width = width;
  request.height = height;
  request.scale = scale;
  request.path = toString(env, path);
  view->renderer.requestSnapshot(
      request, [sink](std::shared_ptr<tgfx::Data> data, int w, int h,
                      const std::string& error) {
        sink->deliver(data, w, h, error);
      });
}

JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_hasPendingSnapshot(JNIEnv*, jobject,
                                                          jlong ptr) {
  auto* view = asView(ptr);
  return view != nullptr && view->renderer.snapshotPending() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_destroy(JNIEnv* env, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->renderer.setWakeCallback(nullptr);
    if (view->wakeTarget != nullptr) {
      env->DeleteGlobalRef(view->wakeTarget);
      view->wakeTarget = nullptr;
    }
    view->releaseWindow();
    delete view;
  }
}

// The AHardwareBuffer behind a java.hardware.HardwareBuffer, for the image path.
// Valid only while the Java object is open: it owns the reference, not us.
JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_hardwareBufferPointer(JNIEnv* env, jobject,
                                                             jobject buffer) {
  if (buffer == nullptr) {
    return 0;
  }
  // tgfx's, not the NDK's: the symbol only exists from API 26, and this resolves it at runtime.
  return reinterpret_cast<jlong>(tgfx::HardwareBufferFromJavaObject(env, buffer));
}

}  // extern "C"
