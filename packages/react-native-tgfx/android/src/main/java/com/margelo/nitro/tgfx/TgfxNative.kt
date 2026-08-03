package com.margelo.nitro.tgfx

import android.view.Surface
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import java.nio.ByteBuffer

/**
 * JNI bridge to the shared C++ renderer (libNitroTgfx). Each method operates on
 * a native `TgfxRenderer` pointer returned by [create].
 */
internal object TgfxNative {
  init {
    System.loadLibrary("NitroTgfx")
  }

  external fun create(): Long

  /**
   * Give the native renderer a way to post a draw for a change no staging call
   * made — a hardware buffer swapped behind an image handle, or an evicted
   * image finishing its re-decode. [target] must expose `requestRender()`.
   */
  external fun setWakeTarget(ptr: Long, target: TgfxRenderTarget)
  external fun surfaceCreated(ptr: Long, surface: Surface)
  external fun surfaceChanged(ptr: Long, width: Int, height: Int)
  external fun surfaceDestroyed(ptr: Long)
  external fun setPixelRatio(ptr: Long, ratio: Float)
  external fun setScene(ptr: Long, scene: ByteBuffer, strings: Array<String>)
  external fun clearScene(ptr: Long)
  external fun setOpaque(ptr: Long, opaque: Boolean)
  external fun setValues(ptr: Long, values: DoubleArray)
  /** Acquires [buffer] and parks the frame in the renderer's single-frame slot. */
  external fun stageCameraFrame(
    ptr: Long,
    buffer: Long,
    frameWidth: Float,
    frameHeight: Float,
    contours: FloatArray,
    blurRadius: Float
  )

  /** Draws and releases whatever [stageCameraFrame] last parked; no-ops if empty. */
  external fun drawCameraFrame(ptr: Long)
  external fun draw(ptr: Long): Boolean

  /**
   * Called once per [snapshot], never on the render thread. Anything the native
   * renderer accepted — every result, and every failure raised once the request
   * reached it — arrives on a native worker thread (`tgfx::Task`). A request
   * rejected before it got that far, which is only an already-unmounted canvas
   * in [TgfxRenderTarget.snapshot], is answered inline on the calling thread.
   *
   * Exactly one of [data] and [error] is non-null, except for a save, which
   * reports neither. [data] is only valid for the duration of the call.
   */
  @Keep
  @DoNotStrip
  fun interface SnapshotCallback {
    fun onSnapshot(data: ByteBuffer?, width: Int, height: Int, error: String?)
  }

  /**
   * Stage a pixel readback. `x/y/width/height` are logical pixels; a zero width
   * or height means the whole canvas. A non-empty [path] writes the encoded
   * image there instead of handing the bytes back.
   */
  external fun snapshot(
    ptr: Long,
    format: String,
    quality: Int,
    x: Float,
    y: Float,
    width: Float,
    height: Float,
    scale: Float,
    path: String,
    callback: SnapshotCallback
  )

  /** True while a staged readback still needs frames; see TgfxRenderer::snapshotPending. */
  external fun hasPendingSnapshot(ptr: Long): Boolean
  external fun destroy(ptr: Long)
}
