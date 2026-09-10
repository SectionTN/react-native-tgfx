import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Canvas, RoundedRect } from 'react-native-tgfx';

const COLOR = '#4F8EF7';
const BG = '#FFFFFF';
const BOX = 96;
const WIN = Dimensions.get('window');

interface Pan {
  x: SharedValue<number>;
  y: SharedValue<number>;
  size: SharedValue<{ w: number; h: number }>;
}

function clamp(v: number, max: number) {
  'worklet';
  return v < 0 ? 0 : v > max ? max : v;
}

function PanelA({ x, y, size }: Pan) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  return (
    <View
      style={styles.panel}
      onLayout={e => {
        size.value = {
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        };
      }}
    >
      <Animated.View style={[styles.box, style]} />
    </View>
  );
}

function PanelB({ x, y }: Pan) {
  return (
    <View style={styles.panel}>
      <Canvas style={styles.fill}>
        <RoundedRect x={x} y={y} width={BOX} height={BOX} r={18} color={COLOR} />
      </Canvas>
    </View>
  );
}

function blockJs() {
  const until = Date.now() + 3000;
  while (Date.now() < until) {}
}

export function PanScreen() {
  const x = useSharedValue(24);
  const y = useSharedValue(24);
  // Seeded, not zero: a zero size makes the clamp's max negative and parks the box off-screen.
  const size = useSharedValue({ w: WIN.width, h: WIN.height / 2 });
  const pan: Pan = { x, y, size };

  // One gesture, one pair of values, both panels: no skew between the two.
  const drag = Gesture.Pan().onChange(e => {
    x.value = clamp(x.value + e.changeX, size.value.w - BOX);
    y.value = clamp(y.value + e.changeY, size.value.h - BOX);
  });

  return (
    <GestureDetector gesture={drag}>
      <View style={styles.fill}>
        <PanelA {...pan} />
        <View
          style={styles.divider}
          hitSlop={{ top: 24, bottom: 24 }}
          onTouchEnd={blockJs}
        />
        <PanelB {...pan} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  panel: { flex: 1, backgroundColor: BG, overflow: 'hidden' },
  divider: { height: 3, backgroundColor: '#8E8E93' },
  box: {
    position: 'absolute',
    width: BOX,
    height: BOX,
    borderRadius: 18,
    backgroundColor: COLOR,
  },
});
