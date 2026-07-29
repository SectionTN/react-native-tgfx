package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.Surface
import android.view.TextureView

internal const val EMPTY_SCENE = """{"v":1,"root":{"t":"g","ch":[]}}"""

/** The process-wide GPU thread. One raster thread serves every canvas. */
internal object TgfxRenderThread {
  val handler: Handler by lazy {
    val thread = HandlerThread("TgfxRender", Process.THREAD_PRIORITY_DISPLAY)
    thread.start()
    Handler(thread.looper)
  }
}

/**
 * A [TextureView] that hosts a tgfx GPU surface. Everything that touches GPU or
 * scene state runs on [TgfxRenderThread], which owns the native renderer. Only
 * `setValues` crosses threads, and the renderer guards that with a mutex.
 */
internal class TgfxTextureView(context: Context) :
  TextureView(context),
  TextureView.SurfaceTextureListener {

  @Volatile private var nativePtr: Long = 0
  @Volatile private var scene: String = EMPTY_SCENE
  private val handler = TgfxRenderThread.handler

  private val drawRunnable = Runnable {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.draw(ptr)
    }
  }

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  fun setScene(json: String) {
    scene = json
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.setScene(ptr, json)
      }
    }
    requestRender()
  }

  fun setValues(values: DoubleArray) {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.setValues(ptr, values)
    }
    requestRender()
  }

  fun drawCameraFrame(
    buffer: Long,
    frameWidth: Float,
    frameHeight: Float,
    contours: FloatArray,
    blurRadius: Float
  ) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.drawCameraFrame(ptr, buffer, frameWidth, frameHeight, contours, blurRadius)
      }
    }
  }

  fun requestRender() {
    handler.removeCallbacks(drawRunnable)
    handler.post(drawRunnable)
  }

  /** Release the native renderer; called when the Nitro view is dropped. */
  fun release() {
    handler.removeCallbacks(drawRunnable)
    handler.post {
      val ptr = nativePtr
      nativePtr = 0
      if (ptr != 0L) {
        TgfxNative.surfaceDestroyed(ptr)
        TgfxNative.destroy(ptr)
      }
    }
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    val surface = Surface(st)
    val density = resources.displayMetrics.density
    val json = scene
    handler.post {
      if (nativePtr == 0L) {
        nativePtr = TgfxNative.create()
      }
      TgfxNative.surfaceCreated(nativePtr, surface)
      TgfxNative.surfaceChanged(nativePtr, width, height)
      TgfxNative.setPixelRatio(nativePtr, density)
      TgfxNative.setScene(nativePtr, json)
      TgfxNative.draw(nativePtr)
    }
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceChanged(ptr, width, height)
      }
    }
    requestRender()
  }

  // Returning false keeps ownership of the SurfaceTexture, so it is released on
  // the render thread rather than blocking the caller until that thread idles.
  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    handler.removeCallbacks(drawRunnable)
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceDestroyed(ptr)
      }
      st.release()
    }
    return false
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}
