/**
 * Reanimated-driven tgfx animations. SharedValues are passed STRAIGHT to the
 * declarative tgfx components — the reconciler turns them into value slots and
 * the native UI-thread driver updates them every frame with zero JS-thread work.
 */
import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Circle, Group, RoundedRect } from 'react-native-tgfx';
import { Star } from './customShapes';

const H = 120;

export function AnimatedSection() {
  const r = useSharedValue(14); // pulsing radius
  const angle = useSharedValue(0); // rotation (radians)
  const cy = useSharedValue(H / 2 - 22); // vertical bob
  const scale = useSharedValue(0.6); // spring scale

  useEffect(() => {
    r.value = withRepeat(
      withTiming(32, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    angle.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2200, easing: Easing.linear }),
      -1,
      false
    );
    cy.value = withRepeat(
      withTiming(H / 2 + 22, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    scale.value = withRepeat(withSpring(1.25, { damping: 5, stiffness: 80 }), -1, true);
    return () => {
      cancelAnimation(r);
      cancelAnimation(angle);
      cancelAnimation(cy);
      cancelAnimation(scale);
    };
  }, [angle, cy, r, scale]);

  return (
    <Canvas style={{ height: H, backgroundColor: '#FFFFFF', borderRadius: 12 }}>
      {/* pulsing radius */}
      <Circle cx={55} cy={H / 2} r={r} color="#FF3B30" />

      {/* continuous rotation about a point */}
      <Group transform={[{ rotate: angle }]} origin={{ x: 150, y: H / 2 }}>
        <RoundedRect x={126} y={H / 2 - 24} width={48} height={48} r={10} color="#5856D6" />
      </Group>

      {/* vertical bob (animated cy) */}
      <Circle cx={245} cy={cy} r={15} color="#34C759" />

      {/* spring scale about a point */}
      <Group transform={[{ scale }]} origin={{ x: 335, y: H / 2 }}>
        <Star cx={335} cy={H / 2} outerR={26} points={5} color="#FF9500" />
      </Group>
    </Canvas>
  );
}
