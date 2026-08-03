/**
 * Realtime face blur rendered entirely by react-native-tgfx.
 *
 * VisionCamera's frame output hands us the camera buffer as an
 * `AHardwareBuffer*`; tgfx wraps that as an Image, draws it, then draws it a
 * second time through a blur filter clipped to each face contour. The frame and
 * the contours go through one shared transform natively, so the blur cannot
 * drift from the image.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  type Contours,
} from 'react-native-vision-camera-face-detector';
import { callback } from 'react-native-nitro-modules';
import { TgfxNativeView, type TgfxViewRef } from 'react-native-tgfx';

const BLUR_RADIUS = 25;
const CONTOURS: (keyof Contours)[] = ['FACE', 'LEFT_CHEEK', 'RIGHT_CHEEK'];

export function TgfxFaceBlur() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [view, setView] = useState<TgfxViewRef | null>(null);
  const [hybridRef] = useState(() => callback((ref: TgfxViewRef) => setView(ref)));

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    runContours: true,
    runLandmarks: false,
    runClassifications: false,
  });

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    enablePhysicalBufferRotation: true,
    onFrame(frame) {
      'worklet';
      if (view == null) {
        frame.dispose();
        return;
      }
      const buffer = frame.getNativeBuffer();
      try {
        const faces = faceDetector.detectFaces(frame);
        // Flat polygon list: point count, then that many x,y pairs, per shape.
        const contours: number[] = [];
        for (const face of faces) {
          const shapes = face.contours;
          if (shapes == null) {
            continue;
          }
          for (const key of CONTOURS) {
            const points = shapes[key];
            if (points == null || points.length < 3) {
              continue;
            }
            contours.push(points.length);
            for (const point of points) {
              contours.push(point.x, point.y);
            }
          }
        }
        view.drawCameraFrame(
          buffer.pointer,
          frame.width,
          frame.height,
          contours,
          BLUR_RADIUS
        );
      } finally {
        buffer.release();
        frame.dispose();
      }
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission is required.</Text>
      </View>
    );
  }
  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>No camera available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Camera
        style={styles.hidden}
        device={device}
        isActive={true}
        outputs={[frameOutput]}
      />
      <TgfxNativeView
        style={StyleSheet.absoluteFill}
        hybridRef={hybridRef}
        inHierarchy={false}
        opaque={false}
      />
      {/* <Text style={styles.badge}>tgfx · MLKit · VisionCamera v5</Text> */}
    </View>
  );
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
  badge: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    color: '#e2e8f0',
    fontSize: 13,
    backgroundColor: '#0009',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
});
