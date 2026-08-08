package com.margelo.nitro.tgfx

import android.graphics.SurfaceTexture
import android.hardware.HardwareBuffer
import android.os.Build
import android.view.Surface
import androidx.annotation.Keep
import androidx.annotation.RequiresApi
import com.facebook.proguard.annotations.DoNotStrip
import java.nio.ByteBuffer

/** JNI bridge to libNitroTgfx; every method takes a native `TgfxRenderer` pointer from [create]. */
internal object TgfxNative {
  init {
    System.loadLibrary("NitroTgfx")
  }

  external fun create(): Long

  external fun setWakeTarget(ptr: Long, target: TgfxRenderTarget)
  external fun surfaceCreated(ptr: Long, surface: Surface)
  external fun surfaceChanged(ptr: Long, width: Int, height: Int)
  external fun surfaceDestroyed(ptr: Long)
  external fun setPixelRatio(ptr: Long, ratio: Float)
  external fun setScene(ptr: Long, scene: ByteBuffer, strings: Array<String>)
  external fun clearScene(ptr: Long)
  external fun setOpaque(ptr: Long, opaque: Boolean)
  external fun setValues(ptr: Long, values: DoubleArray)

  external fun hitTest(ptr: Long, x: Float, y: Float, precise: Boolean): DoubleArray
  external fun draw(ptr: Long): Boolean

  /** Called once per [snapshot] on a native worker, never the render thread. [data] is call-scoped. */
  @Keep
  @DoNotStrip
  fun interface SnapshotCallback {
    fun onSnapshot(data: ByteBuffer?, width: Int, height: Int, error: String?)
  }

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

  external fun hasPendingSnapshot(ptr: Long): Boolean
  external fun destroy(ptr: Long)

  /** The `AHardwareBuffer*` a [HardwareBuffer] wraps; valid only while that object is open. */
  @RequiresApi(Build.VERSION_CODES.O)
  external fun hardwareBufferPointer(buffer: HardwareBuffer): Long

  /** A tgfx SurfaceTextureReader a video decoder renders into; see TgfxVideoStream.cpp. */
  external fun videoStreamCreate(
    width: Int,
    height: Int,
    listener: SurfaceTexture.OnFrameAvailableListener
  ): Long

  /** A fresh Surface onto the stream's SurfaceTexture; the caller releases it. */
  external fun videoStreamSurface(ptr: Long): Surface?

  external fun videoStreamNotify(ptr: Long)

  /** Points the stream's image at its newest frame; returns the image id, 0 if none. */
  external fun videoStreamUpdate(ptr: Long): Int

  /** Drops the reader, whose textures belong to a GPU context that is going away. */
  external fun videoStreamRelease(ptr: Long)

  /** A fresh reader on the same image id; the decoder must be re-pointed at the Surface. */
  external fun videoStreamRebuild(
    ptr: Long,
    listener: SurfaceTexture.OnFrameAvailableListener
  ): Surface?

  external fun videoStreamDestroy(ptr: Long)
}
