/**
 * Reanimated added to the Skia-only screen one layer at a time, so a crash can
 * be attributed to a specific layer. Selected with `am start -e step <1..4>`.
 *   1 = import only   2 = useSharedValue   3 = useDerivedValue -> Skia prop
 *   4 = withRepeat animation driving Skia
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas, Circle } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const COUNT = 12;

export function SkiaReaStep({ step }: { step: number }) {
  const { width } = useWindowDimensions();
  const height = 420;

  const t = useSharedValue(0);
  useEffect(() => {
    if (step < 4) return;
    // Not reversed: sin() already closes its own cycle over t 0->1.
    t.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.linear }),
      -1,
      false,
    );
  }, [step, t]);

  const cy = useDerivedValue(() => height / 2 + Math.sin(t.value * Math.PI * 2) * 120);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>skia + reanimated step {step}</Text>
      <Canvas style={{ width, height }}>
        {Array.from({ length: COUNT }, (_, i) => (
          <Circle
            key={i}
            cx={(width / COUNT) * (i + 0.5)}
            cy={step >= 3 ? cy : height / 2}
            r={16}
            color={`hsl(${(i * 30) % 360}, 70%, 55%)`}
          />
        ))}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingTop: 48 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', paddingHorizontal: 14 },
});
