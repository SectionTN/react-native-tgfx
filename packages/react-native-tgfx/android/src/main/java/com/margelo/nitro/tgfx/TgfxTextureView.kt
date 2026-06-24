package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView

/**
 * A [TextureView] that hosts a tgfx GPU surface. A vsync-aligned [Choreographer]
 * loop drives frames, but it **pauses itself when idle** (the native renderer
 * reports it drew nothing) and resumes on any scene/value change — so a static
 * canvas costs no per-frame work and no wakeups.
 */
internal class TgfxTextureView(context: Context) :
  TextureView(context),
  TextureView.SurfaceTextureListener,
  Choreographer.FrameCallback {

  private var nativePtr: Long = 0
  private var surface: Surface? = null
  private var running = false
  private var idleFrames = 0
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
    ensureRunning()
  }

  fun setValues(values: DoubleArray) {
    if (nativePtr != 0L) {
      TgfxNative.setValues(nativePtr, values)
    }
    ensureRunning()
  }

  fun requestRender() {
    ensureRunning()
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
    TgfxNative.setPixelRatio(nativePtr, resources.displayMetrics.density)
    TgfxNative.setScene(nativePtr, scene)
    ensureRunning()
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    if (nativePtr != 0L) {
      TgfxNative.surfaceChanged(nativePtr, width, height)
    }
    ensureRunning()
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

  private fun ensureRunning() {
    idleFrames = 0
    if (!running && surface != null) {
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
    val didDraw = nativePtr != 0L && TgfxNative.draw(nativePtr)
    if (didDraw) {
      idleFrames = 0
    } else {
      idleFrames++
    }
    // Pause after a few idle frames; ensureRunning() resumes on the next change.
    if (idleFrames > IDLE_FRAMES_BEFORE_PAUSE) {
      running = false
      return
    }
    Choreographer.getInstance().postFrameCallback(this)
  }

  private companion object {
    const val IDLE_FRAMES_BEFORE_PAUSE = 3
  }
}
