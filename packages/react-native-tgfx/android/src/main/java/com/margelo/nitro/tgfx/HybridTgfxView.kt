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
import com.margelo.nitro.views.RecyclableView

// A FrameLayout wrapper so React-Native style props such as backgroundColor
// apply: neither a bare SurfaceView nor a TextureView can host a background
// drawable. Fabric sets this view's bounds without a measure pass, so the GPU
// child is measured here.
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

  /**
   * A non-accelerated canvas means someone is screenshotting the window into a
   * Bitmap. `TextureView.draw` is final and renders nothing there, so the last
   * frame is blitted by hand — otherwise every screenshot of the canvas comes
   * back empty. Only reachable for `composite="texture"`; a SurfaceView keeps
   * its own layer and cannot be captured this way at all.
   *
   * `getBitmap` allocates per capture, and the early return drops any sibling
   * child — this layout only ever holds the canvas, so neither costs anything
   * today, but both would need revisiting if that changed.
   *
   * The bitmap is not recycled: a `Picture.beginRecording()` canvas also reports
   * `isHardwareAccelerated == false` but replays its display list later, so a
   * recycled bitmap would crash on playback instead of copying synchronously.
   * A null frame falls through to `super.dispatchDraw` rather than drawing
   * nothing, which would silently produce a blank screenshot.
   */
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
      if (inHierarchy) TgfxTextureView(context, target) else TgfxSurfaceView(context, target)
    when (canvas) {
      is TgfxTextureView -> canvas.setOpaqueSurface(opaque)
      is TgfxSurfaceView -> canvas.setOpaqueSurface(opaque)
    }
    host.setCanvas(canvas)
  }

  /**
   * Swaps the canvas view when it changes. Fabric applies props before the view
   * is attached, so the surface is created against whichever view is in place by
   * then; a later change re-creates the surface, which the renderer handles.
   */
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

  override fun drawCameraFrame(
    buffer: ULong,
    frameWidth: Double,
    frameHeight: Double,
    contours: DoubleArray,
    blurRadius: Double
  ) {
    target.drawCameraFrame(
      buffer.toLong(),
      frameWidth.toFloat(),
      frameHeight.toFloat(),
      FloatArray(contours.size) { contours[it].toFloat() },
      blurRadius.toFloat()
    )
  }

  override fun prepareForRecycle() {
    target.clearScene()
  }

  override fun onDropView() {
    target.release()
  }
}
