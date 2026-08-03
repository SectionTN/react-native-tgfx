/**
 * Canvas.snapshot() / Canvas.save() against a canvas that never stops moving —
 * the readback has to land without the animation hitching.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Image as RNImage,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  Group,
  RoundedRect,
  type CanvasHandle,
  type SnapshotOptions,
} from 'react-native-tgfx';

const H = 140;

// A real app gets this from expo-file-system or react-native-fs; hardcoded here
// so the example keeps its dependency list at zero. Both are app-private and
// writable without a permission prompt.
const SAVE_PATH =
  Platform.OS === 'android'
    ? '/data/data/com.tgfxexample/cache/tgfx-snapshot.png'
    : '/tmp/tgfx-snapshot.png';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Demo-only: the library hands back raw bytes precisely so nothing has to do
 * this. RN's <Image> just has no way to take an ArrayBuffer until the image
 * handle work lands, so the example pays for one base64 pass to show the frame.
 */
function toDataUri(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = Math.min(3, bytes.length - i);
    const chunk =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    for (let j = 0; j < 4; j += 1) {
      out += j <= n ? B64[(chunk >> (18 - 6 * j)) & 63] : '=';
    }
  }
  return `data:image/png;base64,${out}`;
}

export function SnapshotSection() {
  const canvas = useRef<CanvasHandle>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const angle = useSharedValue(0);
  const cy = useSharedValue(H / 2);
  useEffect(() => {
    angle.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2000, easing: Easing.linear }),
      -1,
      false,
    );
    cy.value = withRepeat(
      withTiming(H / 2 + 30, {
        duration: 900,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(angle);
      cancelAnimation(cy);
    };
  }, [angle, cy]);

  const takeSnapshot = async (label: string, options?: SnapshotOptions) => {
    setStatus(`reading ${label}…`);
    try {
      const started = Date.now();
      const snap = await canvas.current!.snapshot(options);
      setPreview(toDataUri(snap.data));
      setStatus(
        `${label}: ${snap.width}×${snap.height} ${snap.format}, ${
          snap.data.byteLength
        } bytes in ${Date.now() - started} ms`,
      );
    } catch (error) {
      setStatus(String(error));
    }
  };

  const saveToDisk = async () => {
    setStatus('saving…');
    try {
      await canvas.current!.save(SAVE_PATH);
      setSavedAt(`${SAVE_PATH}?t=${Date.now()}`);
      setStatus(`wrote ${SAVE_PATH}`);
    } catch (error) {
      setStatus(String(error));
    }
  };

  return (
    <View style={styles.section}>
      <RNText style={styles.label}>Snapshot / save (animating)</RNText>
      <Canvas
        ref={canvas}
        style={{ height: H, backgroundColor: '#0B1020', borderRadius: 12 }}
      >
        <Group transform={[{ rotate: angle }]} origin={{ x: 70, y: H / 2 }}>
          <RoundedRect
            x={40}
            y={H / 2 - 30}
            width={60}
            height={60}
            r={12}
            color="#5856D6"
          />
        </Group>
        <Circle cx={170} cy={cy} r={22} color="#FF9500" />
        <Circle cx={240} cy={H / 2} r={26} color="#34C759" />
      </Canvas>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => takeSnapshot('full')}>
          <RNText style={styles.buttonText}>snapshot()</RNText>
        </Pressable>
        {/* The rotating square only: a crop that is wrong lands on empty pixels. */}
        <Pressable
          style={styles.button}
          onPress={() =>
            takeSnapshot('rect', { rect: { x: 30, y: 20, width: 90, height: 90 } })
          }
        >
          <RNText style={styles.buttonText}>rect</RNText>
        </Pressable>
        {/* The scaled path is the one that allocates a scratch surface. */}
        <Pressable
          style={styles.button}
          onPress={() => takeSnapshot('scale', { scale: 0.5 })}
        >
          <RNText style={styles.buttonText}>scale 0.5</RNText>
        </Pressable>
        <Pressable style={styles.button} onPress={saveToDisk}>
          <RNText style={styles.buttonText}>save()</RNText>
        </Pressable>
      </View>
      <RNText style={styles.status}>{status}</RNText>

      <View style={styles.row}>
        {preview != null ? (
          <View>
            <RNText style={styles.caption}>snapshot() → ArrayBuffer</RNText>
            <RNImage source={{ uri: preview }} style={styles.preview} />
          </View>
        ) : null}
        {savedAt != null ? (
          <View>
            <RNText style={styles.caption}>save() → file on disk</RNText>
            <RNImage
              source={{ uri: `file://${savedAt}` }}
              style={styles.preview}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  label: { fontSize: 13, fontWeight: '600', color: '#3A3A3C', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, marginTop: 10 },
  button: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  status: { marginTop: 8, fontSize: 12, color: '#636366' },
  caption: { fontSize: 11, color: '#8E8E93', marginBottom: 4 },
  preview: {
    width: 150,
    height: 70,
    resizeMode: 'contain',
    backgroundColor: '#F2F2F7',
    borderRadius: 6,
  },
});
