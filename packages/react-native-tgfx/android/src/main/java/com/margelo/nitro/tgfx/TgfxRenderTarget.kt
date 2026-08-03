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
 * runs on that thread; the staging calls run inline on the caller's thread
 * because the renderer guards its pending state with a mutex.
 *
 * That mutex protects the renderer's *fields*, not its *lifetime*, so [nativePtr]
 * is guarded by [lock]: staging calls read it and make the JNI call inside
 * [withPtr], so each either completes before the pointer is cleared or sees zero.
 *
 * A runnable that reads [nativePtr] in its own body needs no lock — it runs on the
 * render thread, so the queue already orders it against the `destroy`, and leaving
 * the per-frame [drawRunnable] lock-free keeps it out of the critical section. A
 * runnable that *captures* the pointer must capture it and post under [lock], as
 * [surfaceDestroyed] and [release] do, so that queue order matches pointer
 * validity: [release] clears the field and posts the `destroy` in one critical
 * section, so anything holding a live pointer was necessarily queued ahead of it.
 * Posting under [lock] is safe because nothing takes [lock] while holding the
 * queue's; [requestRender] still stays outside it.
 *
 * One consequence for profiling: a worklet [setValues] now serialises behind a
 * concurrent [setScene] for that call's whole JNI crossing, scene hash included.
 *
 * The two canvas views ([TgfxSurfaceView], [TgfxTextureView]) differ only in how
 * Android hands them a [Surface], so they share this.
 */
internal class TgfxRenderTarget {
  private val lock = Any()

  // Created up front, so a scene staged before the surface exists is not lost.
  @Volatile private var nativePtr: Long = TgfxNative.create()
  private val handler = TgfxRenderThread.handler

  init {
    // After `handler` and before anything can draw: the native side posts
    // through requestRender() for changes that arrive without a staging call.
    withPtr { TgfxNative.setWakeTarget(it, this) }
  }

  private inline fun withPtr(body: (Long) -> Unit) = synchronized(lock) {
    val ptr = nativePtr
    if (ptr != 0L) {
      body(ptr)
    }
  }

  private val drawRunnable = Runnable {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.draw(ptr)
    }
  }

  private val cameraRunnable = Runnable {
    val ptr = nativePtr
    if (ptr != 0L) {
      TgfxNative.drawCameraFrame(ptr)
    }
  }

  /**
   * Stage a draw program. The buffer belongs to JS and is only valid for this
   * call, so the native side copies it here, on the calling thread; the render
   * thread then compiles and draws it.
   */
  fun setScene(scene: ByteBuffer, strings: Array<String>) {
    withPtr { TgfxNative.setScene(it, scene, strings) }
    requestRender()
  }

  fun setOpaque(opaque: Boolean) {
    withPtr { TgfxNative.setOpaque(it, opaque) }
    requestRender()
  }

  fun clearScene() {
    withPtr { TgfxNative.clearScene(it) }
    requestRender()
  }

  fun setValues(values: DoubleArray) {
    withPtr { TgfxNative.setValues(it, values) }
    requestRender()
  }

  /** Acquires on this thread and coalesces: a lagging render thread skips stale frames. */
  fun drawCameraFrame(
    buffer: Long,
    frameWidth: Float,
    frameHeight: Float,
    contours: FloatArray,
    blurRadius: Float
  ) {
    withPtr {
      TgfxNative.stageCameraFrame(it, buffer, frameWidth, frameHeight, contours, blurRadius)
      handler.removeCallbacks(cameraRunnable)
      handler.post(cameraRunnable)
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

  fun surfaceResized(width: Int, height: Int, density: Float) {
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.setPixelRatio(ptr, density)
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
    // Posted unconditionally: onReleased must run even once the pointer is gone.
    synchronized(lock) {
      val ptr = nativePtr
      handler.post {
        if (ptr != 0L) {
          TgfxNative.surfaceDestroyed(ptr)
        }
        onReleased()
        released.countDown()
      }
    }
    if (await) {
      released.await()
    }
  }

  /** Release the native renderer; called when the Nitro view is dropped. */
  fun release() {
    handler.removeCallbacks(drawRunnable)
    synchronized(lock) {
      val ptr = nativePtr
      nativePtr = 0
      if (ptr != 0L) {
        handler.post {
          TgfxNative.surfaceDestroyed(ptr)
          TgfxNative.destroy(ptr)
        }
      }
    }
  }
}
