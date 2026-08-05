package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.Canvas
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.uimanager.ThemedReactContext
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.views.RecyclableView

private class HostLayout(context: Context) : FrameLayout(context) {
  fun setCanvas(child: View) {
    removeAllViews()
    addView(
      child,
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    getChildAt(0)?.measure(
      MeasureSpec.makeMeasureSpec(r - l, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(b - t, MeasureSpec.EXACTLY)
    )
    super.onLayout(changed, l, t, r, b)
  }

  /** A non-accelerated canvas is a window screenshot; TextureView.draw renders nothing there. */
  override fun dispatchDraw(canvas: Canvas) {
    val child = getChildAt(0)
    if (!canvas.isHardwareAccelerated && child is TextureView && child.isAvailable) {
      val frame = child.bitmap
      if (frame != null) {
        canvas.drawBitmap(frame, 0f, 0f, null)
        return
      }
    }
    super.dispatchDraw(canvas)
  }
}

@Keep
@DoNotStrip
class HybridTgfxView(private val context: ThemedReactContext) :
  HybridTgfxViewSpec(), RecyclableView {

  private val target = TgfxRenderTarget()
  private val host = HostLayout(context)
  override val view: FrameLayout = host

  init {
    applyCanvas()
  }

  private fun applyCanvas() {
    val canvas =
      if (inHierarchy) {
        TgfxTextureView(context, target).also { it.setOpaqueSurface(opaque) }
      } else {
        TgfxSurfaceView(context, target).also { it.setOpaqueSurface(opaque) }
      }
    host.setCanvas(canvas)
  }

  /** Swaps the canvas view. Fabric applies props before attach, so a later change re-creates it. */
  override var inHierarchy: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      applyCanvas()
    }

  override var opaque: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      target.setOpaque(value)
      // A SurfaceView's pixel format only takes on a fresh surface, so recreate rather than set.
      applyCanvas()
    }

  override fun setScene(scene: ArrayBuffer, strings: Array<String>) {
    target.setScene(scene.getBuffer(false), strings)
  }

  override fun invalidate() {
    target.requestRender()
  }

  override fun setValues(values: DoubleArray) {
    target.setValues(values)
  }

  override fun snapshot(options: NativeSnapshotOptions): Promise<NativeSnapshot> {
    val promise = Promise<NativeSnapshot>()
    target.snapshot(options, "") { data, width, height, error ->
      when {
        error != null -> promise.reject(RuntimeException(error))
        data == null ->
          promise.reject(RuntimeException("[tgfx] snapshot: the readback produced no bytes"))
        // The direct buffer is only valid for this call, so the bytes go into a Nitro-owned one.
        else -> promise.resolve(
          NativeSnapshot(
            ArrayBuffer.copy(data),
            width.toDouble(),
            height.toDouble(),
            options.format
          )
        )
      }
    }
    return promise
  }

  override fun save(path: String, options: NativeSnapshotOptions): Promise<Unit> {
    val promise = Promise<Unit>()
    target.snapshot(options, path) { _, _, _, error ->
      if (error != null) promise.reject(RuntimeException(error)) else promise.resolve(Unit)
    }
    return promise
  }

  override fun prepareForRecycle() {
    target.clearScene()
  }

  override fun onDropView() {
    target.release()
  }
}
