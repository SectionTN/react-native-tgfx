package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView

/**
 * The in-hierarchy canvas view, for `composite="texture"`. The canvas is drawn as
 * part of the app window, so its transparent pixels show whatever React Native
 * renders behind it and view transforms apply to it.
 *
 * Slower than [TgfxSurfaceView]: every new frame makes the window redraw and
 * costs the UI thread a traversal. Measured on a Samsung SM-E146B with 400
 * animated objects: main-thread FPS 57.3 → 56.2, peak PSS 135 → 149 MB.
 */
internal class TgfxTextureView(context: Context, private val target: TgfxRenderTarget) :
  TextureView(context),
  TextureView.SurfaceTextureListener {

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    target.surfaceAvailable(Surface(st), width, height, resources.displayMetrics.density)
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    target.surfaceResized(width, height)
  }

  // Returning false keeps ownership of the SurfaceTexture, so it is released on
  // the render thread rather than blocking the caller until that thread idles.
  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    target.surfaceDestroyed(await = false) { st.release() }
    return false
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}
