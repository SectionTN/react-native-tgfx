package com.margelo.nitro.tgfx

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.BaseReactPackage
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.tgfx.views.HybridTgfxViewManager

class NitroTgfxPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = listOf(HybridTgfxViewManager())

    companion object {
        init {
            NitroTgfxOnLoad.initializeNative()
        }
    }
}
