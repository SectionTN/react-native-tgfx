package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.PixelFormat
import android.view.SurfaceHolder
import android.view.SurfaceView

/** The default canvas view: its own compositor layer, but it punches a hole through the window. */
internal class TgfxSurfaceView(context: Context, private val target: TgfxRenderTarget) :
  SurfaceView(context),
  SurfaceHolder.Callback {

  private var bound = false

  init {
    setZOrderMediaOverlay(true)
    holder.addCallback(this)
  }

  fun setOpaqueSurface(opaque: Boolean) {
    holder.setFormat(if (opaque) PixelFormat.OPAQUE else PixelFormat.TRANSLUCENT)
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    bound = false
  }

  // Rebinding a size-only change would drop the GL context and the compiled program.
  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    if (bound) {
      target.surfaceResized(width, height, resources.displayMetrics.density)
    } else {
      bound = true
      target.surfaceAvailable(holder.surface, width, height, resources.displayMetrics.density)
    }
  }

  // The Surface dies the moment this returns, so the render thread has to be done with it.
  override fun surfaceDestroyed(holder: SurfaceHolder) {
    bound = false
    target.surfaceDestroyed(await = true)
  }
}
