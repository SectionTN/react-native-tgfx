package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.PixelFormat
import android.view.SurfaceHolder
import android.view.SurfaceView

/**
 * The default canvas view. Its buffers are their own compositor layer, so a new
 * frame costs the app window no traversal, no HWUI redraw and no `updateTexImage`
 * on the UI thread.
 *
 * The trade-off is that the surface punches a hole through the window: React
 * Native content *behind* the canvas cannot show through its transparent pixels,
 * and view transforms do not apply to it. (Content drawn *on top* of the canvas
 * composites normally.) Use [TgfxTextureView] when either matters.
 */
internal class TgfxSurfaceView(context: Context, private val target: TgfxRenderTarget) :
  SurfaceView(context),
  SurfaceHolder.Callback {

  init {
    setZOrderMediaOverlay(true)
    holder.setFormat(PixelFormat.TRANSLUCENT)
    holder.addCallback(this)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    target.surfaceAvailable(holder.surface, width, height, resources.displayMetrics.density)
  }

  // The Surface is destroyed the moment this returns, so the render thread has
  // to be done with it first.
  override fun surfaceDestroyed(holder: SurfaceHolder) {
    target.surfaceDestroyed(await = true)
  }
}
