package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.SurfaceHolder
import android.view.SurfaceView
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
 * A [SurfaceView] that hosts a tgfx GPU surface. GPU work — compiling a staged
 * program and drawing — runs on [TgfxRenderThread], which owns the native
 * renderer. `setScene` and `setValues` cross threads to stage data; the renderer
 * guards that with a mutex.
 *
 * A SurfaceView rather than a TextureView: its buffers are their own layer that
 * SurfaceFlinger composites directly, so a new frame costs the app window no
 * traversal, no HWUI redraw and no `updateTexImage` on the UI thread. The cost is
 * z-order — the surface is composited over the window, so React Native views
 * cannot be drawn on top of the canvas.
 */
internal class TgfxSurfaceView(context: Context) :
  SurfaceView(context),
  SurfaceHolder.Callback {

  // Created up front, so a scene staged before the surface exists is not lost.
  @Volatile private var nativePtr: Long = TgfxNative.create()
  private val handler = TgfxRenderThread.handler

  private val drawRunnable = Runnable {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.draw(ptr)
    }
  }

  init {
    setZOrderMediaOverlay(true)
    holder.setFormat(PixelFormat.TRANSLUCENT)
    holder.addCallback(this)
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

  override fun surfaceCreated(holder: SurfaceHolder) {
    val surface = holder.surface
    val density = resources.displayMetrics.density
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceCreated(ptr, surface)
        TgfxNative.setPixelRatio(ptr, density)
      }
    }
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.draw(ptr)
      }
    }
  }

  // Unlike a TextureView, the Surface is destroyed the moment this returns, so
  // the render thread has to be done with it first.
  override fun surfaceDestroyed(holder: SurfaceHolder) {
    handler.removeCallbacks(drawRunnable)
    val released = CountDownLatch(1)
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceDestroyed(ptr)
      }
      released.countDown()
    }
    released.await()
  }
}
