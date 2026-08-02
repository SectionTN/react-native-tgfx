package com.margelo.nitro.tgfx

import android.view.Surface
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
  external fun destroy(ptr: Long)
}
