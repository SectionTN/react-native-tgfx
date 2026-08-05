package com.margelo.nitro.tgfx

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.LifecycleEventListener
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.io.File
import java.util.concurrent.FutureTask

/**
 * Android `TgfxVideo`: MediaPlayer decodes into a tgfx SurfaceTextureReader, so
 * each frame reaches the GPU as the texture it decoded into.
 *
 * Not the `AHardwareBuffer` path camera frames take: a video decoder hands back
 * vendor-private buffer formats that tgfx cannot import.
 */
@Keep
@DoNotStrip
class HybridTgfxVideo(
  private val player: MediaPlayer,
  private val stream: Long,
  private var surface: Surface,
  private val listener: SurfaceTexture.OnFrameAvailableListener,
  override val duration: Double,
  override val framerate: Double,
  override val rotation: Double,
  override val width: Double,
  override val height: Double,
) : HybridTgfxVideoSpec(), LifecycleEventListener {
  private var released = false

  init {
    NitroModules.applicationContext?.addLifecycleEventListener(this)
  }

  /**
   * The canvas builds a new GPU context when the app comes back, and a reader's
   * textures belong to the context that first drew them — drawing one against the
   * new context is a null dereference inside tgfx. So the reader goes away with
   * the old context and the decoder is re-pointed at a fresh one on resume.
   */
  override fun onHostPause() {
    if (!released) {
      TgfxNative.videoStreamRelease(stream)
    }
  }

  override fun onHostResume() {
    if (released) return
    val next = TgfxNative.videoStreamRebuild(stream, listener) ?: return
    player.setSurface(next)
    surface.release()
    surface = next
  }

  override fun onHostDestroy() {
    release()
  }

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

  override fun updateFrame(): Double {
    if (released) return 0.0
    return TgfxNative.videoStreamUpdate(stream).toDouble()
  }

  override fun release() {
    if (released) return
    released = true
    NitroModules.applicationContext?.removeLifecycleEventListener(this)
    player.setSurface(null)
    player.release()
    surface.release()
    TgfxNative.videoStreamDestroy(stream)
  }

  protected fun finalize() {
    release()
  }
}

/** Opens a video source and reads the track metadata a scene needs to place it. */
@Keep
@DoNotStrip
class HybridTgfxVideoFactory : HybridTgfxVideoFactorySpec() {
  /**
   * Wakes the stream: tgfx only regenerates a texture once it hears a frame
   * landed. The pointer is set after construction because the reader needs the
   * listener to exist before it can be created.
   */
  @Keep
  @DoNotStrip
  private class FrameListener : SurfaceTexture.OnFrameAvailableListener {
    @Volatile
    var stream = 0L

    @Keep
    @DoNotStrip
    override fun onFrameAvailable(surfaceTexture: SurfaceTexture) {
      val ptr = stream
      if (ptr != 0L) {
        TgfxNative.videoStreamNotify(ptr)
      }
    }
  }

  override fun load(uri: String): Promise<HybridTgfxVideoSpec> = Promise.parallel {
    val context = NitroModules.applicationContext
      ?: throw IllegalStateException("[tgfx] loadVideo: no application context")
    open(context, source(uri))
  }

  private fun <T> onMainThread(work: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return work()
    }
    val task = FutureTask(work)
    Handler(Looper.getMainLooper()).post(task)
    return task.get()
  }

  private fun source(uri: String): Uri =
    if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)

  private fun open(context: Context, uri: Uri): HybridTgfxVideoSpec {
    val format = videoFormat(context, uri)
      ?: throw IllegalStateException("[tgfx] loadVideo: $uri has no video track")
    val width = format.getInteger(MediaFormat.KEY_WIDTH)
    val height = format.getInteger(MediaFormat.KEY_HEIGHT)

    val listener = FrameListener()
    // On the main looper: SurfaceTexture delivers onFrameAvailable to the thread that
    // registered the listener, and this runs on a worker that has no looper at all.
    val stream = onMainThread { TgfxNative.videoStreamCreate(width, height, listener) }
    if (stream == 0L) {
      throw IllegalStateException("[tgfx] loadVideo: could not create a frame stream")
    }
    listener.stream = stream

    val surface = TgfxNative.videoStreamSurface(stream)
    if (surface == null) {
      TgfxNative.videoStreamDestroy(stream)
      throw IllegalStateException("[tgfx] loadVideo: the frame stream has no surface")
    }

    val player = MediaPlayer()
    try {
      player.setDataSource(context, uri)
      player.setSurface(surface)
      player.prepare()
    } catch (e: Throwable) {
      player.release()
      surface.release()
      TgfxNative.videoStreamDestroy(stream)
      throw e
    }

    return HybridTgfxVideo(
      player = player,
      stream = stream,
      surface = surface,
      listener = listener,
      duration = player.duration.coerceAtLeast(0).toDouble(),
      framerate = optionalNumber(format, MediaFormat.KEY_FRAME_RATE) ?: 30.0,
      rotation = optionalNumber(format, MediaFormat.KEY_ROTATION) ?: 0.0,
      width = width.toDouble(),
      height = height.toDouble(),
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
}
