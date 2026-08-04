/**
 * Imperative node handles: useNode() + <Rect ref> changed from event handlers,
 * with no React render behind any of it. The render counter is the point — it
 * stays where it is however much the scene moves.
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Circle, RoundedRect, Text, useNode } from 'react-native-tgfx';

const H = 160;
const COLORS = ['#4F8EF7', '#FF9500', '#34C759', '#AF52DE', '#FF3B30'];

export function ImperativeSection() {
  const box = useNode();
  const dot = useNode();
  const label = useNode();

  // Not state: React must not learn about any of this.
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

  // No slot for a colour, so this one re-encodes the program — still without a
  // React render or a reconciler commit.
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

  // A drag is the case the API exists for. `set` is a worklet, so this never
  // leaves the UI thread: no touch event crosses to JS, and no frame waits on it.
  const pan = Gesture.Pan()
    .onBegin(e => {
      'worklet';
      dot.set({ cx: e.x, cy: e.y });
    })
    .onUpdate(e => {
      'worklet';
      dot.set({ cx: e.x, cy: e.y });
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
