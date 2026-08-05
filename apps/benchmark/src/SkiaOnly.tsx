// The smallest possible Skia screen: if this crashes, Skia is at fault on its own.
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas, Circle } from '@shopify/react-native-skia';

const COUNT = 12;

export function SkiaOnly() {
  const { width } = useWindowDimensions();
  const height = 420;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>skia only — static, no reanimated</Text>
      <Canvas style={{ width, height }}>
        {Array.from({ length: COUNT }, (_, i) => (
          <Circle
            key={i}
            cx={(width / COUNT) * (i + 0.5)}
            cy={height / 2}
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
