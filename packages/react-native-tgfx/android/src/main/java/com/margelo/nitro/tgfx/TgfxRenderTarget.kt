package com.margelo.nitro.tgfx

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.Surface
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch

internal object TgfxRenderThread {
  val handler: Handler by lazy {
    val thread = HandlerThread("TgfxRender", Process.THREAD_PRIORITY_DISPLAY)
    thread.start()
    Handler(thread.looper)
  }
}

/** Owns the native renderer and the render-thread hop; [nativePtr] is guarded by [lock], and a runnable that *captures* it must capture and post under [lock]. */
internal class TgfxRenderTarget {
  private val lock = Any()

  // Created up front, so a scene staged before the surface exists is not lost.
  @Volatile private var nativePtr: Long = TgfxNative.create()
  private val handler = TgfxRenderThread.handler

  init {
    withPtr { TgfxNative.setWakeTarget(it, this) }
  }

  private inline fun withPtr(body: (Long) -> Unit) = synchronized(lock) {
    val ptr = nativePtr
    if (ptr != 0L) {
      body(ptr)
    }
  }

  private val drawRunnable = object : Runnable {
    override fun run() {
      val ptr = nativePtr
      if (ptr != 0L) {
        TgfxNative.draw(ptr)
        // A readback needs its frame; safe because a lost or replaced context is terminal for one.
        if (TgfxNative.hasPendingSnapshot(ptr)) {
          handler.post(this)
        }
      }
    }
  }

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

  fun snapshot(
    options: NativeSnapshotOptions,
    path: String,
    callback: TgfxNative.SnapshotCallback
  ) {
    var staged = false
    withPtr {
      TgfxNative.snapshot(
        it,
        options.format,
        options.quality.toInt(),
        options.x.toFloat(),
        options.y.toFloat(),
        options.width.toFloat(),
        options.height.toFloat(),
        options.scale.toFloat(),
        path,
        callback
      )
      staged = true
    }
    if (staged) {
      requestRender()
    } else {
      callback.onSnapshot(null, 0, 0, "[tgfx] snapshot: the canvas is no longer mounted")
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

  /** @param await block until the surface is released — a SurfaceView must, a TextureView need not. */
  fun surfaceDestroyed(await: Boolean, onReleased: () -> Unit = {}) {
    handler.removeCallbacks(drawRunnable)
    val released = CountDownLatch(1)
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
