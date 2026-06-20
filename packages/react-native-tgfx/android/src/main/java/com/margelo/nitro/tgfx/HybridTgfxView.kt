package com.margelo.nitro.tgfx

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.views.RecyclableView

/**
 * Android implementation of the Nitro `TgfxView`. The host view is a
 * [FrameLayout] (so React-Native style props like `backgroundColor` apply
 * normally — a bare `TextureView` cannot host a background drawable); the
 * GPU-backed [TgfxTextureView] fills it. The compiled `scene` prop (and the
 * future animated values buffer) is forwarded to the native renderer, which is
 * released when the Fabric view is recycled or dropped.
 */
@Keep
@DoNotStrip
class HybridTgfxView(context: ThemedReactContext) :
  HybridTgfxViewSpec(), RecyclableView {

  private val tgfxView = TgfxTextureView(context)
  override val view: FrameLayout = FrameLayout(context).apply {
    addView(
      tgfxView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
  }

  override var scene: String = """{"v":1,"root":{"t":"g","ch":[]}}"""
    set(value) {
      field = value
      tgfxView.setScene(value)
    }

  override var valuesBuffer: ArrayBuffer? = null
    set(value) {
      field = value
      // Wired by the Reanimated driver (task #8).
    }

  override var valueCount: Double? = null

  override fun invalidate() {
    tgfxView.requestRender()
  }

  override fun setValues(values: DoubleArray) {
    tgfxView.setValues(values)
  }

  override fun prepareForRecycle() {
    scene = """{"v":1,"root":{"t":"g","ch":[]}}"""
  }

  override fun onDropView() {
    tgfxView.release()
  }
}
