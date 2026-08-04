import { useEffect, useMemo } from 'react'
import { NitroModules } from 'react-native-nitro-modules'
import type { TgfxCameraSink } from './specs/TgfxCameraSink.nitro'

export type { TgfxCameraSink }

/**
 * Create a {@link TgfxCameraSink}.
 *
 * One per camera output — the sink holds the output it is attached to, so
 * sharing one between two cameras would silently move the frames of the second
 * onto the handle of the first.
 */
export function createTgfxCameraSink(): TgfxCameraSink {
  return NitroModules.createHybridObject<TgfxCameraSink>('TgfxCameraSink')
}

/**
 * A {@link TgfxCameraSink} scoped to the component, detached on unmount.
 *
 * Attaching is the caller's job, because it needs a handle and the handle needs
 * a buffer — so it happens once `useCameraFrame()` has minted one from the
 * first frame:
 *
 * ```tsx
 * const { image, posture, onFrame } = useCameraFrame()
 * const sink = useTgfxCameraSink()
 * const frameOutput = useFrameOutput({
 *   pixelFormat: 'yuv',
 *   enablePhysicalBufferRotation: true,
 *   onFrame,
 * })
 * useEffect(() => {
 *   if (image != null) sink.attach(frameOutput, image.handle)
 * }, [sink, frameOutput, image])
 * ```
 *
 * After that call lands on the camera thread the worklet is gone and every
 * later frame is imported natively. Because the frame stops reaching JS, so
 * does its orientation: `posture` freezes at whatever the first frame reported.
 * Set `enablePhysicalBufferRotation: true` so the pipeline — not the consumer —
 * is what keeps that true for the rest of the session, or stay on the hook
 * alone if orientation has to track.
 */
export function useTgfxCameraSink(): TgfxCameraSink {
  const sink = useMemo(createTgfxCameraSink, [])
  useEffect(() => () => sink.detach(), [sink])
  return sink
}
