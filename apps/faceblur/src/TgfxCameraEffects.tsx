/**
 * Two live-camera effects drawn over <CameraFrame>, switchable on screen.
 *
 * Blur: <Blur> as a paint child of <CameraFrame> itself, so the whole frame
 * goes through one image filter — no shape, no overlay.
 *
 * Cyberpunk: a runtime <Shader> whose `uniform shader` child is an
 * <ImageShader> on the same frame handle (#147), so the SkSL samples the live
 * hardware buffer directly. `uTime` is a useClock SharedValue, so it animates
 * without the scene being re-encoded.
 */
import { useState } from 'react'
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera'
import {
  Blur,
  CameraFrame,
  Canvas,
  Fill,
  ImageShader,
  Shader,
  useCameraFrame,
  useClock,
} from 'react-native-tgfx'

const BLUR_RADIUS = 28

/**
 * Neon edge glow: a directional emboss tinted cyan on one side of every edge
 * and magenta on the other, over a near-black base.
 *
 * The two colours come from the *signed* diagonal luminance difference — an
 * unsigned Sobel magnitude alone gives white outlines, not the two-tone split.
 * Magnitude then drives how bright the line is, so flat areas stay black.
 *
 * `pos` is in frame pixels, because the shape hosting this shader is inside
 * <CameraFrame> — so the taps below are offsets in pixels, not UV.
 */
const NEON_EDGE = `
uniform shader cam;
uniform float2 uSize;
uniform float uTime;

float luma(half4 c) {
  return dot(c.rgb, half3(0.2126, 0.7152, 0.0722));
}

half4 main(float2 pos) {
  float t = 1.7;

  // Signed diagonal difference: which side of the edge we are on.
  float lo = luma(cam.eval(pos - float2(t, t)));
  float hi = luma(cam.eval(pos + float2(t, t)));
  float dirEdge = hi - lo;

  // Unsigned cross gradient: how strong the edge is, in any direction.
  float gx = luma(cam.eval(pos + float2(t, 0.0))) -
             luma(cam.eval(pos - float2(t, 0.0)));
  float gy = luma(cam.eval(pos + float2(0.0, t))) -
             luma(cam.eval(pos - float2(0.0, t)));
  float mag = sqrt(gx * gx + gy * gy);

  half3 cyan = half3(0.25, 1.00, 0.95);
  half3 magenta = half3(1.00, 0.15, 0.90);
  half3 tint = mix(cyan, magenta, clamp(dirEdge * 7.0 + 0.5, 0.0, 1.0));

  // pow() below 1 lifts the faint edges so texture reads, not just hard lines.
  float edge = pow(clamp(mag * 6.5, 0.0, 1.0), 0.70);

  half4 base = cam.eval(pos);
  half3 col = base.rgb * half3(0.14, 0.09, 0.28) + tint * edge * 1.45;

  // Slow breathe, so a still scene still looks live.
  col *= 0.93 + 0.07 * sin(uTime * 1.6);

  float2 uv = pos / uSize;
  // Rising edges only: smoothstep with edge0 > edge1 is undefined in GLSL ES.
  float vig = 1.0 - smoothstep(0.38, 1.10, length(uv - 0.5));
  col *= 0.40 + 0.60 * vig;

  return half4(clamp(col, 0.0, 1.0), base.a);
}
`

type Mode = 'blur' | 'cyberpunk'

export function TgfxCameraEffects() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('front')
  const [mode, setMode] = useState<Mode>('blur')

  const clock = useClock()
  // The hook owns the buffer's lifetime: the raw pointer never leaves it.
  const { image, posture, onFrame } = useCameraFrame()

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    enablePhysicalBufferRotation: true,
    onFrame,
  })

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <RNText
          style={styles.text}
          onPress={() => {
            requestPermission()
          }}
        >
          Tap to grant camera permission.
        </RNText>
      </View>
    )
  }
  if (device == null) {
    return (
      <View style={styles.center}>
        <RNText style={styles.text}>No camera available.</RNText>
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
          {mode === 'blur' ? <Blur blur={BLUR_RADIUS} /> : null}
          {mode === 'cyberpunk' && posture.width > 0 ? (
            <Fill>
              <Shader
                source={NEON_EDGE}
                uniforms={{
                  uSize: [posture.width, posture.height],
                  uTime: clock,
                }}
              >
                {/* Tile modes left at 'clamp': a YUV frame sampled with any
                    other one comes back transparent. */}
                <ImageShader image={image} />
              </Shader>
            </Fill>
          ) : null}
        </CameraFrame>
      </Canvas>
      <View style={styles.bar}>
        {(['blur', 'cyberpunk'] as Mode[]).map(m => (
          <Pressable
            key={m}
            style={[styles.button, mode === m && styles.buttonOn]}
            onPress={() => {
              setMode(m)
            }}
          >
            <RNText style={styles.buttonText}>{m}</RNText>
          </Pressable>
        ))}
      </View>
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
  bar: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#0008',
    borderWidth: 1,
    borderColor: '#0ff6',
  },
  buttonOn: { backgroundColor: '#0ff3', borderColor: '#0ff' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
