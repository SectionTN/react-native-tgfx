import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { CameraDevice, Frame } from 'react-native-vision-camera'
import {
  useCamera,
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

const BLUR_RADIUS = 25
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7]

/**
 * The gate is its own component: the frame and face-detector hooks below reach
 * for a camera as soon as they run, so on a device without one they must never
 * run at all — and a hook cannot be called conditionally.
 */
export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text
          testID="faceblur-permission-prompt"
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
        <Text testID="faceblur-no-camera" style={styles.text}>
          No camera available.
        </Text>
      </View>
    )
  }
  return <FaceBlurCamera device={device} />
}

function FaceBlurCamera({ device }: { device: CameraDevice }) {
  const slot0 = useNode()
  const slot1 = useNode()
  const slot2 = useNode()
  const slot3 = useNode()
  const slot4 = useNode()
  const slot5 = useNode()
  const slot6 = useNode()
  const slot7 = useNode()
  // Stable array identity: rebuilt every render it would re-create the worklet each frame.
  const ovals: NodeHandle[] = useMemo(
    () => [slot0, slot1, slot2, slot3, slot4, slot5, slot6, slot7],
    [slot0, slot1, slot2, slot3, slot4, slot5, slot6, slot7]
  )

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    runContours: false,
    runLandmarks: false,
    runClassifications: false,
  })

  const detect = useCallback(
    (frame: Frame) => {
      'worklet'
      // Already in frame pixels, the space <CameraFrame>'s children draw in, so unscaled.
      const faces = faceDetector.detectFaces(frame)
      for (let i = 0; i < SLOTS.length; i++) {
        const bounds = i < faces.length ? faces[i]!.bounds : null
        if (bounds == null) {
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

  const { image, posture, onFrame } = useCameraFrame(detect)

  const frameOutput = useFrameOutput({
    // 'yuv', not 'rgb': tgfx imports the planes straight to a texture and converts in the shader.
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    // The pipeline rotates the buffers, so `orientation` arrives 'up' and `isMirrored` false.
    enablePhysicalBufferRotation: true,
    onFrame,
  })
  useCamera({
    isActive: true,
    device: device,
    outputs: [frameOutput],
  })

  return (
    <View testID="faceblur-live" style={styles.fill}>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: { color: '#fff', fontSize: 16 },
})
