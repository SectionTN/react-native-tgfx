// The monochrome logo from src/assets/monochrome-logo.svg, drawn as tgfx geometry
// with its tentacles waving — the path string is rebuilt on the UI thread.
// One canvas: a second animating canvas beside it splits the render thread and
// costs this one every other frame. The `logo` tab shows the draw-on trace.
import { useEffect } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Fill, Group, Path } from 'react-native-tgfx';
import { AMPLITUDE, JELLYFISH } from './logoPath';
import { wavePath } from './logoWave';

// The document's viewBox is 0 0 300 300, so the groups scale it down rather
// than the geometry being re-authored.
const SCALE = 0.5;

export function LogoSection() {
  const phase = useSharedValue(0);

  useEffect(() => {
    // A full 2π every cycle, so the restart lands on the shape it left.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2200, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(phase);
  }, [phase]);

  // A string slot: the engine re-parses on the render thread, with no re-encode
  // and no React render per frame.
  const path = useDerivedValue(() => wavePath(JELLYFISH, phase.value, AMPLITUDE));

  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>
        SVG path data as geometry — tentacles waved from a worklet
      </RNText>
      <Canvas style={styles.canvas}>
        <Fill color="#111114" />
        <Group transform={[{ translate: [4, 4] }, { scale: SCALE }]}>
          <Path path={path} color="#ffffff" />
        </Group>
        <Group transform={[{ translate: [154, 4] }, { scale: SCALE }]}>
          <Path
            path={path}
            color="#4F8EF7"
            style="stroke"
            strokeWidth={4}
            strokeJoin="round"
          />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 18 },
  sectionLabel: { fontSize: 13, color: '#6b6b6f', marginBottom: 6 },
  canvas: { width: '100%', height: 152, borderRadius: 12 },
});
