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
import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'
import type { Frame } from 'react-native-vision-camera'
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
  useCameraFrame,
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

export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

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

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    runContours: false,
    runLandmarks: false,
    runClassifications: false,
  })

  const detect = useCallback(
    (frame: Frame) => {
      'worklet'
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
        // An ellipse inscribed in the detector's box covers pi/4 ~= 79% of it,
        // and the corners it drops are jaw and hairline — the parts of a face
        // worth hiding. Inflate about the centre so it covers the box.
        const grow = (bounds.width * (OVAL_SCALE - 1)) / 2
        const growY = (bounds.height * (OVAL_SCALE - 1)) / 2
        blob.x.value = bounds.x - grow
        blob.y.value = bounds.y - growY
        blob.width.value = bounds.width * OVAL_SCALE
        blob.height.value = bounds.height * OVAL_SCALE
      }
    },
    [faceDetector, blobs]
  )

  // The hook owns the buffer's whole lifetime — the raw pointer, the release
  // and the dispose. `detect` runs inside the same try, so detector work that
  // throws still cannot leak the frame and stall the bounded pool.
  const { image, posture, onFrame } = useCameraFrame(detect)

  const frameOutput = useFrameOutput({
    // 'yuv' and not 'rgb': 'rgb' forces a YUV->RGB conversion on every frame,
    // and tgfx imports the YUV planes straight to a texture and converts inside
    // the fragment shader. 'native' is the other zero-conversion option, but
    // the import is typed BT.601-limited YUV, which is what this asks for.
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    // The pipeline rotates the buffers itself, so `orientation` arrives 'up'
    // and `isMirrored` false. <CameraFrame> corrects whatever it does report.
    enablePhysicalBufferRotation: true,
    onFrame,
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
        <CameraFrame image={image} {...posture}>
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
                <ImageShader image={image} />
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
