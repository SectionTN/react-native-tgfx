package com.tgfxbench

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "TgfxBench"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      // Forwards `adb shell am start -e mode <bench|parity>` extras as initialProps.
      override fun getLaunchOptions(): Bundle =
        Bundle().apply { intent?.extras?.let { putAll(it) } }
    }
}
