package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView

/** The `composite="texture"` view: transforms work, but every frame redraws the window. */
internal class TgfxTextureView(context: Context, private val target: TgfxRenderTarget) :
  TextureView(context),
  TextureView.SurfaceTextureListener {

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  fun setOpaqueSurface(opaque: Boolean) {
    isOpaque = opaque
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    target.surfaceAvailable(Surface(st), width, height, resources.displayMetrics.density)
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    target.surfaceResized(width, height, resources.displayMetrics.density)
  }

  // False keeps ownership, so the SurfaceTexture is released off the caller's thread.
  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    target.surfaceDestroyed(await = false) { st.release() }
    return false
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}
