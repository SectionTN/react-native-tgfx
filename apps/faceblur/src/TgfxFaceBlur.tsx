/**
 * Realtime face blur, drawn as an ordinary tgfx scene.
 *
 * The camera frame is a scene input, not a special case: `<CameraFrame>` places
 * the live hardware buffer and every child rides its transform, in *frame
 * pixel* coordinates. So the blur ovals here are MLKit's face bounds passed
 * through unchanged — there is no JS-side mapping to the view, and the blur
 * cannot drift off the face it hides.
 *
 * The frame processor moves them through node handles, not through React:
 *
 *     ovals[i].set({ x, y, width, height })
 *
 * All four are slot props, so the write completes on the frame-processor
 * runtime: no scene re-encode, no reconciler commit, and no hop to the JS
 * thread. The values reach the renderer on the next UI frame, pushed by the
 * same mapper that drives `SharedValue` props. The scene is committed once at
 * mount and never again while the camera runs.
 *
 * The blur itself is `<Blur>`, tgfx's separable Gaussian, clipped to the oval.
 * A runtime `<Shader>` taking the bounds as uniforms is the tempting way to
 * reach the same imperative API, and it is the wrong tool here: a fragment
 * shader gets one pass, so it has to stand in for a 2D kernel with a handful of
 * point samples, and at any tap count worth paying for it still reads as
 * smeared rather than blurred. An image filter runs two 1D passes over an
 * offscreen and is exact. Reach for `<Shader>` when the effect *is* the shader —
 * TgfxCameraEffects is one.
 *
 * This screen stays on useCameraFrame() and does *not* use the native sink from
 * react-native-tgfx-vision-camera, which TgfxCameraEffects does. That is the
 * boundary between the two, not an omission: detectFaces(frame) needs the frame
 * in a JS runtime every frame, and setOnFrameCallback holds exactly one
 * callback — so the sink would replace the detector rather than join it. With
 * JS on the path regardless, the import is one Nitro call inside a worklet that
 * already had to run.
 */
import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'
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
  useNode,
  type NodeHandle,
} from 'react-native-tgfx'

/**
 * Sigma of the blur, in frame pixels. Fixed rather than scaled to the face:
 * this is a true Gaussian, so one sigma hides a small face as thoroughly as a
 * large one. mrousavy/FaceBlurApp uses 25 as well.
 */
const BLUR_RADIUS = 25
/**
 * Blur slots. The scene is compiled once, so the number of faces it can draw is
 * fixed and an unused slot has zero size and draws nothing. Sized generously
 * rather than tightly: a face beyond the last slot is silently *not* blurred,
 * which in an app called face blur is the one failure that matters. Growing the
 * list costs a scene re-commit, which is the per-frame JS work this avoids.
 */
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7]

export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  // One handle per slot, stable for the life of the component: a handle owns
  // its node's live values, so one recreated per render would lose them.
  const ovals: NodeHandle[] = [
    useNode(),
    useNode(),
    useNode(),
    useNode(),
    useNode(),
    useNode(),
    useNode(),
    useNode(),
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
      // <CameraFrame>'s children are drawn in — so they go through unscaled and
      // uninflated: the oval inscribed in the detector's box is what
      // mrousavy/FaceBlurApp clips to, and it already covers the face.
      const faces = faceDetector.detectFaces(frame)
      for (let i = 0; i < SLOTS.length; i++) {
        const bounds = i < faces.length ? faces[i]!.bounds : null
        if (bounds == null) {
          // Zero size draws nothing, which is how an unused slot stands down.
          ovals[i]!.set({ width: 0, height: 0 })
          continue
        }
        ovals[i]!.set({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        })
      }
    },
    [faceDetector, ovals]
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
            <Oval key={slot} ref={ovals[slot]} x={0} y={0} width={0} height={0}>
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
