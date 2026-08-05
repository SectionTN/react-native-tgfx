# Video

`useVideo` (`src/hooks/useVideo.ts`) plays a video into the same handle table
`<Image>` draws from. The platform decodes — AVPlayer on iOS, MediaPlayer on
Android — and a frame never enters JS: not as pixels, and not as a pointer.

## Shape

```
useVideo(source, options)
  → { currentFrame, currentTime, duration, framerate, rotation, size }
```

`currentFrame` is one object for the life of the video: `{ handle, width,
height }`, an `ImageLike`. The registry id behind it never changes, so a new
frame costs no React render and no scene re-commit — it replaces what the id
points at. It is owned by the player and must not be disposed.

`currentTime` is a Reanimated SharedValue written on the UI thread, because
that is where frames are pulled: a busy JS thread does not stall playback. That
is the one thing here that needs react-native-reanimated.

## Per frame

The pump is a Reanimated frame callback:

    updateFrame()  →  0, or the registry id
    currentTime.value = video.currentTime

`updateFrame` returns 0 when nothing new was decoded since the last call, which
on a 30 fps video and a 120 Hz display is three ticks out of four. Nothing is
allocated on those, and nothing redraws.

## iOS

`AVPlayerItemVideoOutput` configured for bi-planar YUV — what the decoder
already produces, so there is no conversion — and the `CVPixelBuffer` is handed
to the registry through `ios/TgfxVideoFrame.h`, a C shim so Swift never sees
C++. The buffer is retained until the next frame replaces it, because tgfx
samples it directly for as long as the image lives.

The YCbCr matrix is read off the track's format description rather than assumed:
imported as the wrong one, the colours shift.

`hasNewPixelBuffer` reports nothing new while paused, so `seek` sets a flag that
copies at the player's current time on the next pull. Without it a scrub on a
paused video would never repaint.

## Android

Not the `AHardwareBuffer` path camera frames take. A video decoder hands back
vendor-private buffer formats — `0x123` on an Exynos device — and tgfx imports
only `RGBA_8888` and `Y8Cb8Cr8_420`, so every frame fails to import. Asking
`ImageReader` for `YUV_420_888` does not help: the producer picks the format.

So Android decodes into tgfx's own `SurfaceTextureReader`
(`android/src/main/cpp/TgfxVideoStream.cpp`), which is the path tgfx ships for
exactly this. Two things about it are easy to get wrong:

- **The reader must be created on a thread with a Looper.** `SurfaceTexture`
  delivers `onFrameAvailable` to the thread that registered the listener, and
  the load runs on a worker that has none — the callback then never arrives and
  the video shows one frame.
- **A buffer is good for one texture generation.** tgfx expires the previously
  acquired `ImageBuffer` once a newer one is drawn, so acquiring per UI tick
  expires frames before the renderer ever draws them, and the video freezes on
  the first.

- **The reader does not survive the app going away and coming back.** A canvas
  builds a fresh `EGLWindow`, and so a fresh GPU context, when its surface is
  recreated; a reader's textures belong to the context that first drew them.
  Drawing one against the new context dereferences a null `tgfx::Context` deep
  inside `ResourceTask::execute` and takes the process down. So the video drops
  its reader on `onHostPause` and rebuilds it — new reader, new Surface, decoder
  re-pointed — on `onHostResume`. Nothing draws in between.

Hence the registry's *stream* entry (`ImageRegistry::addStream`): the image is
produced inside `acquire()`, on the render thread, at draw time. A pull that
finds a new frame only moves the epoch so the canvas redraws; the buffer itself
is taken during the draw that consumes it. Producing ahead of the draw is what
turned a paused video black — its last frame was redrawn from a buffer that had
already expired.

## Cost

Measured on a Galaxy SM-E146B (Android 15, 60 Hz), 640x360 30 fps clip:

| screen | delivered fps |
|---|---|
| video alone | ~30, the source rate |
| video + 3 other canvases | ~30 |
| the full example screen | ~9 |

The last row is that device's GPU saturated by the example's animating shader
sections. Note that any image-registry change moves one global epoch, so every
canvas redraws on every video frame — shared with camera frames, and worth
scoping per handle if a screen ever carries a video and many other canvases.
