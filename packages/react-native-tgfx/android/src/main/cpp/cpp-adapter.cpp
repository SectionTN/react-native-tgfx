#include <jni.h>
#include <fbjni/fbjni.h>
#include <tgfx/platform/android/JNIEnvironment.h>
#include "NitroTgfxOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [vm]() {
    tgfx::JNIEnvironment::SetJavaVM(vm);
    margelo::nitro::tgfx::registerAllNatives();
  });
}
