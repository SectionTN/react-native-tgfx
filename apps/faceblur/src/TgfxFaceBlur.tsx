/**
 * Realtime face blur, drawn as an ordinary tgfx scene.
 *
 * The camera frame is a scene input, not a special case: `<CameraFrame>` places
 * the live hardware buffer and every child rides its transform, in *frame
 * pixel* coordinates. So the blur ovals here are MLKit's face bounds passed
 * through unchanged — there is no JS-side mapping to the view, and the blur
 * cannot drift off the face it hides.
 *
 * Nothing per-frame reaches the React tree. The scene is committed once; each
 * frame swaps the hardware buffer behind one handle (zero copy, no re-commit)
 * and writes the face bounds into Reanimated values that the engine resolves on
 * the UI thread. The JS thread does no work at all while the camera runs.
 */
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import type { NativeBuffer } from 'react-native-vision-camera'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera'
import { useFaceDetector } from 'react-native-vision-camera-face-detector'
import {
  Blur,
  Canvas,
  CameraFrame,
  ImageShader,
  Oval,
  Paint,
  imageFromNativeBuffer,
  type PixelFormat,
  type TgfxImage,
} from 'react-native-tgfx'

const BLUR_RADIUS = 25
/** Inflation so the inscribed ellipse covers the detector's box corners. */
const OVAL_SCALE = 1.15
/**
 * Blur slots. The scene is compiled once, so the number of faces it can draw is
 * fixed and an unused slot has zero size and draws nothing. Sized generously
 * rather than tightly: a face beyond the last slot is silently *not* blurred,
 * which in an app called face blur is the one failure that matters. Growing the
 * list costs a scene re-commit, which is the per-frame JS work this avoids.
 */
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7]

interface Blob {
  x: SharedValue<number>
  y: SharedValue<number>
  width: SharedValue<number>
  height: SharedValue<number>
}

function useBlob(): Blob {
  return {
    x: useSharedValue(0),
    y: useSharedValue(0),
    width: useSharedValue(0),
    height: useSharedValue(0),
  }
}

/** `frame.orientation` to the clockwise rotation that cancels it. */
const ROTATION: Record<string, 0 | 90 | 180 | 270> = {
  up: 0,
  right: 270,
  down: 180,
  left: 90,
}

export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  // The handle the scene draws. Created from the first frame's buffer and then
  // re-pointed at every later one, so the scene keeps referencing the same id.
  const [frameImage, setFrameImage] = useState<TgfxImage | null>(null)
  const image = useSharedValue<TgfxImage | null>(null)
  // What the buffer reports about itself, read rather than assumed. Both are
  // constant for a session, so they reach the scene through state, not values.
  const [orientation, setOrientation] = useState({
    rotation: 0,
    mirror: false,
  })
  const posture = useSharedValue('')

  const blobs: Blob[] = [
    useBlob(),
    useBlob(),
    useBlob(),
    useBlob(),
    useBlob(),
    useBlob(),
    useBlob(),
    useBlob(),
  ]

  const onFirstFrame = useCallback((handle: TgfxImage) => {
    setFrameImage(handle)
  }, [])
  const onOrientation = useCallback((rotation: number, mirror: boolean) => {
    setOrientation({ rotation, mirror })
  }, [])

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    runContours: false,
    runLandmarks: false,
    runClassifications: false,
  })

  const frameOutput = useFrameOutput({
    // 'yuv' and not 'rgb': 'rgb' forces a YUV->RGB conversion on every frame,
    // and tgfx imports the YUV planes straight to a texture and converts inside
    // the fragment shader. 'native' is the other zero-conversion option, but
    // the import is typed BT.601-limited YUV, which is what this asks for.
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    // The pipeline rotates the buffers itself, so `orientation` arrives 'up'
    // and `isMirrored` false. <CameraFrame> can correct both, and the code
    // below passes whatever the frame actually reports rather than assuming.
    enablePhysicalBufferRotation: true,
    onFrame(frame) {
      'worklet'
      // Acquired *inside* the try: everything that can throw has to be inside
      // it, or a throw skips the dispose() below and stalls the bounded pool.
      let buffer: NativeBuffer | null = null
      try {
        buffer = frame.getNativeBuffer()
        // The range suffix is load-bearing, and read rather than hardcoded:
        // this device reports `yuv-420-8-bit-full`, and importing full-range
        // planes as limited-range crushes the blacks. Inside the try, so a
        // surprise format cannot skip the dispose() below and stall the pool.
        const format: PixelFormat = frame.pixelFormat.endsWith('-full')
          ? 'bt601-full'
          : 'bt601-limited'
        // Zero copy: the pointer is imported as a GPU texture, never decoded,
        // never read back, never re-uploaded. The first frame creates the
        // handle; every later one re-points it, which supersedes any frame the
        // renderer has not drawn instead of queueing behind it.
        if (image.value == null) {
          image.value = imageFromNativeBuffer(buffer.pointer, format)
          scheduleOnRN(onFirstFrame, image.value)
        } else {
          image.value.setNativeBuffer(buffer.pointer, format)
        }

        const rotation = ROTATION[frame.orientation] ?? 0
        const posted = `${rotation}:${frame.isMirrored}`
        if (posture.value !== posted) {
          posture.value = posted
          scheduleOnRN(onOrientation, rotation, frame.isMirrored)
        }

        // Face bounds are already in frame pixels, which is the space
        // <CameraFrame>'s children are drawn in — so they go through unscaled.
        const faces = faceDetector.detectFaces(frame)
        for (let i = 0; i < SLOTS.length; i++) {
          const blob = blobs[i]!
          const bounds = i < faces.length ? faces[i]!.bounds : null
          if (bounds == null) {
            blob.width.value = 0
            blob.height.value = 0
            continue
          }
          // An ellipse inscribed in the detector's box covers pi/4 ~= 79% of
          // it, and the corners it drops are jaw and hairline — the parts of a
          // face worth hiding. Inflate about the centre so it covers the box.
          const grow = (bounds.width * (OVAL_SCALE - 1)) / 2
          const growY = (bounds.height * (OVAL_SCALE - 1)) / 2
          blob.x.value = bounds.x - grow
          blob.y.value = bounds.y - growY
          blob.width.value = bounds.width * OVAL_SCALE
          blob.height.value = bounds.height * OVAL_SCALE
        }
      } finally {
        // The handle took its own reference, so the producer's slot is free the
        // moment this returns. A leaked frame stalls the bounded pool.
        buffer?.release()
        frame.dispose()
      }
    },
  })

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text
          style={styles.text}
          onPress={() => {
            requestPermission()
          }}
        >
          Tap to grant camera permission.
        </Text>
      </View>
    )
  }
  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>No camera available.</Text>
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      <Camera
        style={styles.hidden}
        device={device}
        isActive={true}
        outputs={[frameOutput]}
      />
      <Canvas style={StyleSheet.absoluteFill} opaque={true}>
        <CameraFrame
          image={frameImage}
          rotation={orientation.rotation}
          mirror={orientation.mirror}
        >
          {SLOTS.map(slot => (
            <Oval
              key={slot}
              x={blobs[slot]!.x}
              y={blobs[slot]!.y}
              width={blobs[slot]!.width}
              height={blobs[slot]!.height}
            >
              <Paint>
                {/* The same frame, sampled 1:1 in this space, so the blurred
                    pixels are the pixels underneath. Tile modes are left at
                    'clamp': a YUV image sampled with any other one comes back
                    transparent at the pinned tgfx. */}
                <ImageShader image={frameImage} />
                <Blur blur={BLUR_RADIUS} />
              </Paint>
            </Oval>
          ))}
        </CameraFrame>
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  // The camera has no preview of its own here; tgfx draws every frame.
  hidden: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: { color: '#fff', fontSize: 16 },
})
