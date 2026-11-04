// Reads a packaged resource by name, or an `asset:`/`content:` URI, through TgfxNative.
#include "PlatformAsset.hpp"

#include <jni.h>

#include "Log.hpp"

namespace tgfxrn {

namespace {

JavaVM* gAssetVm = nullptr;
// Resolved at load time and held: a decode runs on a Nitro worker, and FindClass
// on a thread this library merely attached searches the system class loader,
// which cannot see an app class.
jclass gNativeClass = nullptr;
jmethodID gResourceBytes = nullptr;
jmethodID gUriBytes = nullptr;

// Daemon, so a thread this library does not own is never required to detach at exit.
JNIEnv* assetEnv() {
  if (gAssetVm == nullptr) {
    return nullptr;
  }
  JNIEnv* env = nullptr;
  if (gAssetVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_OK) {
    return env;
  }
  return gAssetVm->AttachCurrentThreadAsDaemon(&env, nullptr) == JNI_OK ? env : nullptr;
}

/// Calls a static `(String) -> byte[]` on TgfxNative and copies what it returns.
std::shared_ptr<tgfx::Data> callForBytes(jmethodID method, const std::string& arg) {
  if (gNativeClass == nullptr || method == nullptr) {
    return nullptr;
  }
  JNIEnv* env = assetEnv();
  if (env == nullptr) {
    return nullptr;
  }
  jstring jarg = env->NewStringUTF(arg.c_str());
  auto bytes = static_cast<jbyteArray>(env->CallStaticObjectMethod(gNativeClass, method, jarg));
  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    bytes = nullptr;
  }
  std::shared_ptr<tgfx::Data> data;
  if (bytes != nullptr) {
    jsize length = env->GetArrayLength(bytes);
    if (length > 0) {
      jbyte* raw = env->GetByteArrayElements(bytes, nullptr);
      if (raw != nullptr) {
        data = tgfx::Data::MakeWithCopy(raw, static_cast<size_t>(length));
        env->ReleaseByteArrayElements(bytes, raw, JNI_ABORT);
      }
    }
    env->DeleteLocalRef(bytes);
  }
  env->DeleteLocalRef(jarg);
  return data;
}

}  // namespace

void setPlatformAssetVm(JavaVM* vm) {
  gAssetVm = vm;
  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return;
  }
  jclass local = env->FindClass("com/margelo/nitro/tgfx/TgfxNative");
  if (local == nullptr) {
    env->ExceptionClear();
    TGFXRN_LOGW("TgfxNative not found; a bundled asset will not load by resource name");
    return;
  }
  gNativeClass = static_cast<jclass>(env->NewGlobalRef(local));
  env->DeleteLocalRef(local);
  gResourceBytes =
      env->GetStaticMethodID(gNativeClass, "resourceBytes", "(Ljava/lang/String;)[B");
  if (gResourceBytes == nullptr) {
    env->ExceptionClear();
    TGFXRN_LOGW("TgfxNative.resourceBytes() not found; a bundled asset will not load");
  }
  gUriBytes = env->GetStaticMethodID(gNativeClass, "uriBytes", "(Ljava/lang/String;)[B");
  if (gUriBytes == nullptr) {
    env->ExceptionClear();
    TGFXRN_LOGW("TgfxNative.uriBytes() not found; an asset: or content: URI will not load");
  }
}

std::shared_ptr<tgfx::Data> platformAssetData(const std::string& name) {
  return callForBytes(gResourceBytes, name);
}

std::shared_ptr<tgfx::Data> platformUriData(const std::string& uri) {
  return callForBytes(gUriBytes, uri);
}

}  // namespace tgfxrn
