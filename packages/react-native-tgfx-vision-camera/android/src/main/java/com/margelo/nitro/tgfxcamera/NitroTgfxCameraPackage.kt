package com.margelo.nitro.tgfxcamera

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Exists only so React Native autolinking loads libNitroTgfxCamera.so. It
 * registers no modules and no view managers: the sink is a Nitro HybridObject,
 * reached through NitroModules.createHybridObject().
 */
class NitroTgfxCameraPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      NitroTgfxCameraOnLoad.initializeNative()
    }
  }
}
