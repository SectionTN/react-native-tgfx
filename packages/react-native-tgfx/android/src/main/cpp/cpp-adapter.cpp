#include <jni.h>
#include <fbjni/fbjni.h>
#include <tgfx/platform/android/JNIEnvironment.h>
#include "NitroTgfxOnLoad.hpp"

namespace tgfxrn {
void setPlatformAssetVm(JavaVM* vm);
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [vm]() {
    tgfx::JNIEnvironment::SetJavaVM(vm);
    tgfxrn::setPlatformAssetVm(vm);
    margelo::nitro::tgfx::registerAllNatives();
  });
}
