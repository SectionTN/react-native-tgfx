package com.margelo.nitro.tgfx

import android.view.Surface

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
  external fun setScene(ptr: Long, scene: String)
  external fun setValues(ptr: Long, values: DoubleArray)
  external fun drawCameraFrame(
    ptr: Long,
    buffer: Long,
    frameWidth: Float,
    frameHeight: Float,
    contours: FloatArray,
    blurRadius: Float
  )
  external fun draw(ptr: Long): Boolean
  external fun destroy(ptr: Long)
}
