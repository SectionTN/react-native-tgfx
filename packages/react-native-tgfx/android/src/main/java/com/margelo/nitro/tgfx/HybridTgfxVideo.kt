package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.HardwareBuffer
import android.media.Image
import android.media.ImageReader
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.annotation.Keep
import androidx.annotation.RequiresApi
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.io.File

/** A decoded frame plus the buffer handed to the caller; both live until we close them. */
private class Frame(val image: Image, val buffer: HardwareBuffer?) {
  fun close() {
    buffer?.close()
    image.close()
  }
}

/**
 * Android `TgfxVideo`: MediaPlayer decodes into an ImageReader, so each frame is
 * already an `AHardwareBuffer` and reaches the GPU without a copy.
 */
@Keep
@DoNotStrip
@RequiresApi(Build.VERSION_CODES.Q)
class HybridTgfxVideo(
  private val player: MediaPlayer,
  private val reader: ImageReader,
  override val duration: Double,
  override val framerate: Double,
  override val rotation: Double,
  override val width: Double,
  override val height: Double,
  override val pixelFormat: PixelFormat,
) : HybridTgfxVideoSpec() {
  // Two deep: the caller's handle still points at the previous frame until it swaps.
  private var pending: Frame? = null
  private var previous: Frame? = null
  private var released = false

  override val currentTime: Double
    get() = if (released) 0.0 else player.currentPosition.toDouble()

  override var paused: Boolean = true
    set(value) {
      field = value
      if (released) return
      if (value) player.pause() else player.start()
    }

  override var looping: Boolean = false
    set(value) {
      field = value
      if (!released) player.isLooping = value
    }

  override var volume: Double = 1.0
    set(value) {
      field = value.coerceIn(0.0, 1.0)
      if (!released) player.setVolume(field.toFloat(), field.toFloat())
    }

  override fun seek(millis: Double) {
    if (!released) player.seekTo(millis.toInt())
  }

  override fun acquireFrame(): ULong {
    if (released) return 0uL
    val image = reader.acquireLatestImage() ?: return 0uL
    val buffer = image.hardwareBuffer
    previous?.close()
    previous = pending
    pending = Frame(image, buffer)
    if (buffer == null) return 0uL
    return TgfxNative.hardwareBufferPointer(buffer).toULong()
  }

  override fun release() {
    if (released) return
    released = true
    player.setSurface(null)
    player.release()
    previous?.close()
    pending?.close()
    previous = null
    pending = null
    reader.close()
  }

  protected fun finalize() {
    release()
  }
}

/** Opens a video source and reads the track metadata a scene needs to place it. */
@Keep
@DoNotStrip
class HybridTgfxVideoFactory : HybridTgfxVideoFactorySpec() {
  override fun load(uri: String): Promise<HybridTgfxVideoSpec> = Promise.parallel {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw IllegalStateException(
        "[tgfx] loadVideo needs Android 10 (API 29) or newer for zero-copy frames; " +
          "this device is API ${Build.VERSION.SDK_INT}."
      )
    }
    val context = NitroModules.applicationContext
      ?: throw IllegalStateException("[tgfx] loadVideo: no application context")
    open(context, source(uri))
  }

  private fun source(uri: String): Uri =
    if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun open(context: Context, uri: Uri): HybridTgfxVideoSpec {
    val format = videoFormat(context, uri)
      ?: throw IllegalStateException("[tgfx] loadVideo: $uri has no video track")
    val width = format.getInteger(MediaFormat.KEY_WIDTH)
    val height = format.getInteger(MediaFormat.KEY_HEIGHT)

    val reader = ImageReader.newInstance(
      width, height, ImageFormat.PRIVATE, 4, HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
    )
    val player = MediaPlayer()
    try {
      player.setDataSource(context, uri)
      player.setSurface(reader.surface)
      player.prepare()
    } catch (e: Throwable) {
      player.release()
      reader.close()
      throw e
    }

    return HybridTgfxVideo(
      player = player,
      reader = reader,
      duration = player.duration.coerceAtLeast(0).toDouble(),
      framerate = optionalNumber(format, MediaFormat.KEY_FRAME_RATE) ?: 30.0,
      rotation = optionalNumber(format, MediaFormat.KEY_ROTATION) ?: 0.0,
      width = width.toDouble(),
      height = height.toDouble(),
      pixelFormat = colorFormat(format, height),
    )
  }

  private fun videoFormat(context: Context, uri: Uri): MediaFormat? {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        if (format.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
          return format
        }
      }
      return null
    } finally {
      extractor.release()
    }
  }

  /** `KEY_FRAME_RATE` is an integer in some containers and a float in others. */
  private fun optionalNumber(format: MediaFormat, key: String): Double? {
    if (!format.containsKey(key)) return null
    return try {
      format.getInteger(key).toDouble()
    } catch (e: ClassCastException) {
      format.getFloat(key).toDouble()
    }
  }

  @RequiresApi(Build.VERSION_CODES.N)
  private fun colorFormat(format: MediaFormat, height: Int): PixelFormat {
    val full = optionalNumber(format, MediaFormat.KEY_COLOR_RANGE)?.toInt() ==
      MediaFormat.COLOR_RANGE_FULL
    return when (optionalNumber(format, MediaFormat.KEY_COLOR_STANDARD)?.toInt()) {
      MediaFormat.COLOR_STANDARD_BT709 ->
        if (full) PixelFormat.BT709_FULL else PixelFormat.BT709_LIMITED
      MediaFormat.COLOR_STANDARD_BT601_PAL, MediaFormat.COLOR_STANDARD_BT601_NTSC ->
        if (full) PixelFormat.BT601_FULL else PixelFormat.BT601_LIMITED
      MediaFormat.COLOR_STANDARD_BT2020 ->
        if (full) PixelFormat.BT2020_FULL else PixelFormat.BT2020_LIMITED
      // Unset in most containers: SD was authored 601, HD 709, which is the convention decoders assume.
      else -> if (height >= 720) PixelFormat.BT709_LIMITED else PixelFormat.BT601_LIMITED
    }
  }
}
