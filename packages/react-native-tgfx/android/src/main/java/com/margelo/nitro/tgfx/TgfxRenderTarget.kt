package com.margelo.nitro.tgfx

import android.graphics.Rect
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.view.Surface
import android.view.View
import android.view.ViewTreeObserver
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch

internal object TgfxRenderThread {
  val handler: Handler by lazy {
    val thread = HandlerThread("TgfxRender", Process.THREAD_PRIORITY_DISPLAY)
    thread.start()
    Handler(thread.looper)
  }
}

// GPU teardown of detached surfaces, kept off the render thread so destroy latches never wait behind it.
internal object TgfxTeardownThread {
  val handler: Handler by lazy {
    val thread = HandlerThread("TgfxTeardown", Process.THREAD_PRIORITY_BACKGROUND)
    thread.start()
    Handler(thread.looper)
  }
}

/** Tracks whether a canvas view is actually on screen and feeds [TgfxRenderTarget.setHidden]. */
internal class TgfxVisibilityGate(private val view: View, private val target: TgfxRenderTarget) :
  ViewTreeObserver.OnPreDrawListener {
  private val visibleRect = Rect()

  fun attach() {
    target.onHiddenWake = { view.post { update() } }
    view.viewTreeObserver.addOnPreDrawListener(this)
    update()
  }

  fun detach() {
    target.onHiddenWake = null
    view.viewTreeObserver.removeOnPreDrawListener(this)
    target.setHidden(false)
  }

  private fun update() {
    // An unmeasured view draws nothing anyway; gating it strands the canvas black until the next traversal.
    target.setHidden(
      view.width > 0 && view.height > 0 &&
        !(view.isShown && view.getLocalVisibleRect(visibleRect))
    )
  }

  override fun onPreDraw(): Boolean {
    update()
    return true
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

  // No redraw: only recycle calls this, and painting the still-visible view empty flashed white.
  fun clearScene() {
    withPtr { TgfxNative.clearScene(it) }
  }

  // Only on a real move, as the Metal view does: requestRender cancels the draw
  // already queued, and a gesture that has stopped moving would otherwise keep
  // re-queueing one on a render thread shared with every other canvas.
  fun setViewport(zoom: Float, x: Float, y: Float) {
    var moved = false
    withPtr { moved = TgfxNative.setViewport(it, zoom, x, y) }
    if (moved) {
      requestRender()
    }
  }

  fun setColorSpace(displayP3: Boolean) {
    withPtr { TgfxNative.setColorSpace(it, displayP3) }
    requestRender()
  }

  fun setValues(values: DoubleArray) {
    withPtr { TgfxNative.setValues(it, values) }
    requestRender()
  }

  fun setStringValues(indices: DoubleArray, values: Array<String>) {
    withPtr { TgfxNative.setStringValues(it, indices, values) }
    requestRender()
  }

  fun hitTest(x: Float, y: Float, precise: Boolean): DoubleArray {
    var hits = DoubleArray(0)
    withPtr { hits = TgfxNative.hitTest(it, x, y, precise) }
    return hits
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
      requestRender(force = true)
    } else {
      callback.onSnapshot(null, 0, 0, "[tgfx] snapshot: the canvas is no longer mounted")
    }
  }

  // Scrolled-out canvases keep their surface, so without this gate every offscreen
  // animation still drew at full rate.
  @Volatile private var hidden = false

  // A wake that lands while hidden posts one visibility re-check; only a traversal re-evaluates the gate otherwise.
  @Volatile var onHiddenWake: (() -> Unit)? = null
  @Volatile private var recheckPending = false

  fun setHidden(value: Boolean) {
    recheckPending = false
    if (hidden == value) {
      return
    }
    hidden = value
    if (!value) {
      requestRender()
    }
  }

  // @JvmOverloads is load-bearing: setWakeTarget's JNI looks up requestRender
  // with signature ()V, which a Kotlin default parameter alone does not emit —
  // without the zero-arg overload every canvas silently loses its registry wake
  // and stream-driven content (video, camera) freezes after its first frame.
  @JvmOverloads
  fun requestRender(force: Boolean = false) {
    if (hidden && !force) {
      if (!recheckPending) {
        recheckPending = true
        onHiddenWake?.invoke()
      }
      return
    }
    handler.removeCallbacks(drawRunnable)
    handler.post(drawRunnable)
  }

  // Bumped on destroy so a stale surfaceAvailable/surfaceResized post cannot touch the dead surface.
  @Volatile private var surfaceGeneration = 0

  fun surfaceAvailable(surface: Surface, width: Int, height: Int, density: Float) {
    val generation = surfaceGeneration
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L && generation == surfaceGeneration) {
        TgfxNative.surfaceCreated(ptr, surface)
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.setPixelRatio(ptr, density)
        TgfxNative.draw(ptr)
      }
    }
  }

  fun surfaceResized(width: Int, height: Int, density: Float) {
    val generation = surfaceGeneration
    handler.post {
      val ptr = nativePtr
      if (ptr != 0L && generation == surfaceGeneration) {
        TgfxNative.surfaceChanged(ptr, width, height)
        TgfxNative.setPixelRatio(ptr, density)
        TgfxNative.draw(ptr)
      }
    }
  }

  /** @param await block until the surface is released — a SurfaceView must, a TextureView need not. */
  fun surfaceDestroyed(await: Boolean, onReleased: () -> Unit = {}) {
    handler.removeCallbacks(drawRunnable)
    surfaceGeneration++
    val released = CountDownLatch(1)
    synchronized(lock) {
      val ptr = nativePtr
      // Front of the queue: awaiting a whole GPU teardown froze commits that unmount many canvases.
      handler.postAtFrontOfQueue {
        val detached = if (ptr != 0L) TgfxNative.surfaceDetach(ptr) else 0L
        released.countDown()
        TgfxTeardownThread.handler.post {
          TgfxNative.releaseDetached(detached)
          onReleased()
        }
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
