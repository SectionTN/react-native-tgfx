// Imperative node handles: useNode() + <Rect ref> with no React render — the counter stays put.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  Canvas,
  Circle,
  Fill,
  Group,
  RoundedRect,
  Shader,
  Text,
  useNode,
} from 'react-native-tgfx';

const H = 160;
const COLORS = ['#4F8EF7', '#FF9500', '#34C759', '#AF52DE', '#FF3B30'];

const SPOT = `
uniform float2 uCenter;
uniform float uRadius;
half4 main(float2 pos) {
  float d = length(pos - uCenter) / uRadius;
  float a = clamp(1.0 - d, 0.0, 1.0);
  return half4(half(0.31 * a), half(0.56 * a), half(0.97 * a), half(a));
}
`;

export function ImperativeSection() {
  const box = useNode();
  const dot = useNode();
  const label = useNode();
  const stage = useNode();
  const fx = useNode();

  const red = useSharedValue(0.2);
  useEffect(() => {
    red.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
  }, [red]);

  const geometry = useRef({ x: 20, width: 70, color: 0 });
  const renders = useRef(0);
  renders.current += 1;
  const [, forceRender] = useState(0);

  const move = () => {
    const g = geometry.current;
    g.x = g.x > 240 ? 20 : g.x + 40;
    box.set({ x: g.x });
    label.set({ x: g.x });
  };

  const grow = () => {
    const g = geometry.current;
    g.width = g.width > 140 ? 70 : g.width + 20;
    box.set({ width: g.width });
  };

  const recolor = () => {
    const g = geometry.current;
    g.color = (g.color + 1) % COLORS.length;
    box.set({ color: COLORS[g.color] });
  };

  const reset = () => {
    geometry.current = { x: 20, width: 70, color: 0 };
    box.set({ x: 20, width: 70, color: COLORS[0] });
    label.set({ x: 20 });
  };

  const pan = Gesture.Pan()
    .onBegin(e => {
      'worklet';
      dot.set({ cx: e.x, cy: e.y });
    })
    .onUpdate(e => {
      'worklet';
      dot.set({ cx: e.x, cy: e.y });
    });

  const spin = Gesture.Pan().onUpdate(e => {
    'worklet';
    stage.set({ rotate: e.translationX / 120 });
    fx.set({ uniforms: { uCenter: [e.x, e.y] } });
  });

  return (
    <View style={styles.section}>
      <RNText style={styles.label}>Imperative handles (drag the canvas)</RNText>
      <GestureDetector gesture={pan}>
        {/* A plain view for the detector to attach to: <Canvas> renders a
            fragment, and the gesture needs one host view. */}
        <View>
          <Canvas style={styles.canvas}>
            <RoundedRect
              ref={box}
              x={20}
              y={30}
              width={70}
              height={50}
              r={12}
              color={COLORS[0]}
            />
            <Text
              ref={label}
              x={20}
              y={102}
              text="ref"
              fontSize={16}
              color="#8E8E93"
            />
            <Circle ref={dot} cx={300} cy={120} r={16} color="#FFCC00" />
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={move} testID="tgfx-move">
          <RNText style={styles.buttonText}>move</RNText>
        </Pressable>
        <Pressable style={styles.button} onPress={grow} testID="tgfx-grow">
          <RNText style={styles.buttonText}>grow</RNText>
        </Pressable>
        <Pressable style={styles.button} onPress={recolor} testID="tgfx-recolor">
          <RNText style={styles.buttonText}>recolor</RNText>
        </Pressable>
        <Pressable style={styles.button} onPress={reset} testID="tgfx-reset">
          <RNText style={styles.buttonText}>reset</RNText>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => forceRender(n => n + 1)}
          testID="tgfx-rerender"
        >
          <RNText style={styles.buttonText}>re-render</RNText>
        </Pressable>
      </View>
      <RNText style={styles.label}>
        Animated colour, transform slot and shader uniforms (drag)
      </RNText>
      <GestureDetector gesture={spin}>
        <View>
          <Canvas style={styles.canvas}>
            <Fill>
              <Shader
                ref={fx}
                source={SPOT}
                uniforms={{ uCenter: [160, 80], uRadius: 90 }}
              />
            </Fill>
            <Group ref={stage} transform={[{ rotate: 0 }]} origin={{ x: 160, y: 80 }}>
              <RoundedRect
                x={110}
                y={55}
                width={100}
                height={50}
                r={10}
                color={[red, 0.35, 0.9, 1]}
              />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      <RNText style={styles.status} testID="tgfx-render-count">
        React renders: {renders.current} · a re-render puts the JSX values back
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 },
  canvas: { height: H, backgroundColor: '#0B1020', borderRadius: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#111',
  },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  status: { marginTop: 8, fontSize: 12, color: '#666' },
});
