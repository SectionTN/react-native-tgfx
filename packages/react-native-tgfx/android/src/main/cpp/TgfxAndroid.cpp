// JNI bridge for the Android tgfx view. Creates an EGL-backed tgfx::Window from
// the Java Surface and forwards scene/draw/lifecycle calls to TgfxRenderer.
#include <android/native_window_jni.h>
#include <jni.h>

#include <memory>
#include <string>

#include "TgfxRenderer.hpp"
#include "tgfx/gpu/opengl/egl/EGLWindow.h"

namespace {

// Owns the renderer plus the ANativeWindow reference acquired from the Surface,
// so we can release the window only after the EGL window has been torn down.
struct AndroidTgfxView {
  tgfxrn::TgfxRenderer renderer;
  ANativeWindow* nativeWindow = nullptr;

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
Java_com_margelo_nitro_tgfx_TgfxNative_setScene(JNIEnv* env, jobject, jlong ptr,
                                                jstring scene) {
  auto* view = asView(ptr);
  if (view == nullptr || scene == nullptr) {
    return;
  }
  const char* chars = env->GetStringUTFChars(scene, nullptr);
  if (chars != nullptr) {
    view->renderer.setScene(std::string(chars));
    env->ReleaseStringUTFChars(scene, chars);
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

JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_draw(JNIEnv*, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    return view->renderer.draw() ? JNI_TRUE : JNI_FALSE;
  }
  return JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_tgfx_TgfxNative_destroy(JNIEnv*, jobject, jlong ptr) {
  auto* view = asView(ptr);
  if (view != nullptr) {
    view->releaseWindow();
    delete view;
  }
}

}  // extern "C"
