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

const BLUR_RADIUS = 25
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7]

export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')

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
  hidden: { width: 1, height: 1, opacity: 0, position: 'absolute' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: { color: '#fff', fontSize: 16 },
})
