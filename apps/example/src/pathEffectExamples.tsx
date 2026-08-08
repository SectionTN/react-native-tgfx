// Path effects: dash, corner rounding, trim (the line-drawing animation) and fillType.
import { useEffect } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Easing,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, CornerPathEffect, DashPathEffect, Group, Path } from 'react-native-tgfx';

const ZIGZAG = 'M10 80 L60 20 L110 80 L160 20 L210 80 L260 20 L310 80';
const RING = 'M60 12 C86 12 108 34 108 60 C108 86 86 108 60 108 C34 108 12 86 12 60 C12 34 34 12 60 12 Z';
const DONUT = 'M20 20 L120 20 L120 120 L20 120 Z M50 50 L90 50 L90 90 L50 90 Z';

export function PathEffectSection() {
  const progress = useSharedValue(0);
  const march = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true
    );
    march.value = withRepeat(withTiming(30, { duration: 900, easing: Easing.linear }), -1);
  }, [progress, march]);

  return (
    <>
      <Panel label="DashPathEffect — static · marching phase" height={110}>
        <Path path={ZIGZAG} color="#1C1C1E" style="stroke" strokeWidth={4}>
          <DashPathEffect intervals={[12, 8]} />
        </Path>
      </Panel>

      <Panel label="DashPathEffect — animated phase (dashes march)" height={110}>
        <Path path={ZIGZAG} color="#0A84FF" style="stroke" strokeWidth={4}>
          <DashPathEffect intervals={[12, 8]} phase={march} />
        </Path>
      </Panel>

      <Panel label="CornerPathEffect — the same zigzag, corners rounded" height={110}>
        <Path path={ZIGZAG} color="#FF9500" style="stroke" strokeWidth={4}>
          <CornerPathEffect r={20} />
        </Path>
      </Panel>

      <Panel label="trim — end animates, so the ring draws itself on" height={130}>
        <Path path={RING} color="#E5E5EA" style="stroke" strokeWidth={8} />
        <Path
          path={RING}
          color="#34C759"
          style="stroke"
          strokeWidth={8}
          strokeCap="round"
          end={progress}
        />
      </Panel>

      <Panel label="fillType — winding (left) vs evenOdd (right, hole appears)" height={140}>
        <Path path={DONUT} color="#5856D6" />
        <Group transform={[{ translateX: 150 }]}>
          <Path path={DONUT} color="#FF2D55" fillType="evenOdd" />
        </Group>
      </Panel>
    </>
  );
}

function Panel({
  label,
  children,
  height,
}: {
  label: string;
  children: React.ReactNode;
  height: number;
}) {
  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>{label}</RNText>
      <Canvas style={[styles.canvas, { height }]}>{children}</Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 18 },
  sectionLabel: { fontSize: 13, color: '#6b6b6f', marginBottom: 6 },
  canvas: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
});
