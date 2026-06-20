package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView

/**
 * A [TextureView] that hosts a tgfx GPU surface. The native renderer binds to
 * the view's `SurfaceTexture` (via an `ANativeWindow`) and a vsync-aligned
 * [Choreographer] loop drives one frame per refresh, sampling the latest scene
 * (and, later, the animated values buffer) with no per-frame JS work.
 */
internal class TgfxTextureView(context: Context) :
  TextureView(context),
  TextureView.SurfaceTextureListener,
  Choreographer.FrameCallback {

  private var nativePtr: Long = 0
  private var surface: Surface? = null
  private var running = false
  private var scene: String = """{"v":1,"root":{"t":"g","ch":[]}}"""

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  fun setScene(json: String) {
    scene = json
    if (nativePtr != 0L) {
      TgfxNative.setScene(nativePtr, json)
    }
  }

  fun setValues(values: DoubleArray) {
    if (nativePtr != 0L) {
      TgfxNative.setValues(nativePtr, values)
    }
  }

  fun requestRender() {
    if (nativePtr != 0L) {
      TgfxNative.draw(nativePtr)
    }
  }

  /** Release the native renderer; called when the Nitro view is dropped. */
  fun release() {
    stopLoop()
    if (nativePtr != 0L) {
      TgfxNative.surfaceDestroyed(nativePtr)
      TgfxNative.destroy(nativePtr)
      nativePtr = 0
    }
    surface?.release()
    surface = null
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    if (nativePtr == 0L) {
      nativePtr = TgfxNative.create()
    }
    val s = Surface(st)
    surface = s
    TgfxNative.surfaceCreated(nativePtr, s)
    TgfxNative.surfaceChanged(nativePtr, width, height)
    TgfxNative.setScene(nativePtr, scene)
    startLoop()
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    if (nativePtr != 0L) {
      TgfxNative.surfaceChanged(nativePtr, width, height)
    }
  }

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    stopLoop()
    if (nativePtr != 0L) {
      TgfxNative.surfaceDestroyed(nativePtr)
    }
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}

  private fun startLoop() {
    if (!running) {
      running = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  private fun stopLoop() {
    running = false
    Choreographer.getInstance().removeFrameCallback(this)
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!running) {
      return
    }
    if (nativePtr != 0L) {
      TgfxNative.draw(nativePtr)
    }
    Choreographer.getInstance().postFrameCallback(this)
  }
}
