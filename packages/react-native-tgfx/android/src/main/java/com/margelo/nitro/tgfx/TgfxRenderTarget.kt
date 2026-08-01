package com.margelo.nitro.tgfx

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch

/** The process-wide GPU thread. One raster thread serves every canvas. */
internal object TgfxRenderThread {
  val handler: Handler by lazy {
    val thread = HandlerThread("TgfxRender", Process.THREAD_PRIORITY_DISPLAY)
    thread.start()
    Handler(thread.looper)
  }
}

/**
 * Owns the native renderer and the hop onto [TgfxRenderThread]. Everything that
 * touches GPU state — compiling a staged program, drawing, surface lifecycle —
 * runs on that thread; the staging calls are safe from any thread because the
 * renderer guards its pending state with a mutex.
 *
 * The two canvas views ([TgfxSurfaceView], [TgfxTextureView]) differ only in how
 * Android hands them a [Surface], so they share this.
 */
internal class TgfxRenderTarget {
  // Created up front, so a scene staged before the surface exists is not lost.
  @Volatile private var nativePtr: Long = TgfxNative.create()
  private val handler = TgfxRenderThread.handler

  private val drawRunnable = Runnable {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.draw(ptr)
    }
  }

  /**
   * Stage a draw program. The buffer belongs to JS and is only valid for this
   * call, so the native side copies it here, on the calling thread; the render
   * thread then compiles and draws it.
   */
  fun setScene(scene: ByteBuffer, strings: Array<String>) {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.setScene(ptr, scene, strings)
    }
    requestRender()
  }

  fun clearScene() {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.clearScene(ptr)
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

  fun surfaceAvailable(surface: Surface, width: Int, height: Int, density: Float) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceCreated(ptr, surface)
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.setPixelRatio(ptr, density)
        TgfxNative.draw(ptr)
      }
    }
  }

  fun surfaceResized(width: Int, height: Int) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.draw(ptr)
      }
    }
  }

  /**
   * @param await block until the render thread has released the surface. A
   * SurfaceView's Surface dies the moment its callback returns, so it must wait;
   * a TextureView keeps ownership of the SurfaceTexture and does not.
   */
  fun surfaceDestroyed(await: Boolean, onReleased: () -> Unit = {}) {
    handler.removeCallbacks(drawRunnable)
    val released = CountDownLatch(1)
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceDestroyed(ptr)
      }
      onReleased()
      released.countDown()
    }
    if (await) {
      released.await()
    }
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
}
