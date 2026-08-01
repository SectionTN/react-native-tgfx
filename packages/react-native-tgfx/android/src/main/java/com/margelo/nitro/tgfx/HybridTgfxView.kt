package com.margelo.nitro.tgfx

import android.content.Context
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.views.RecyclableView

// A FrameLayout wrapper so React-Native style props such as backgroundColor
// apply: a bare SurfaceView cannot host a background drawable. Fabric sets this
// view's bounds without a measure pass, so the GPU child is measured here.
private class HostLayout(context: Context, child: TgfxSurfaceView) : FrameLayout(context) {
  init {
    addView(child, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    getChildAt(0)?.measure(
      MeasureSpec.makeMeasureSpec(r - l, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(b - t, MeasureSpec.EXACTLY)
    )
    super.onLayout(changed, l, t, r, b)
  }
}

@Keep
@DoNotStrip
class HybridTgfxView(context: ThemedReactContext) :
  HybridTgfxViewSpec(), RecyclableView {

  private val tgfxView = TgfxSurfaceView(context)
  override val view: FrameLayout = HostLayout(context, tgfxView)

  override fun setScene(scene: ArrayBuffer, strings: Array<String>) {
    tgfxView.setScene(scene.getBuffer(false), strings)
  }

  override fun invalidate() {
    tgfxView.requestRender()
  }

  override fun setValues(values: DoubleArray) {
    tgfxView.setValues(values)
  }

  override fun drawCameraFrame(
    buffer: ULong,
    frameWidth: Double,
    frameHeight: Double,
    contours: DoubleArray,
    blurRadius: Double
  ) {
    tgfxView.drawCameraFrame(
      buffer.toLong(),
      frameWidth.toFloat(),
      frameHeight.toFloat(),
      FloatArray(contours.size) { contours[it].toFloat() },
      blurRadius.toFloat()
    )
  }

  override fun prepareForRecycle() {
    tgfxView.clearScene()
  }

  override fun onDropView() {
    tgfxView.release()
  }
}
