// A cube from six <Group>s under one preserve3d group, after tgfx's Layer3DTree demo. Drag to spin it.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useSharedValue, withDecay } from 'react-native-reanimated';
import {
  Canvas,
  Fill,
  Group,
  Rect,
  Text,
  type Transform,
} from 'react-native-tgfx';

const SIZE = 180;
const HALF = SIZE / 2;
/** Radians per point dragged. */
const DRAG = 0.01;

const FACES: { name: string; color: string; transform: Transform }[] = [
  {
    name: 'back',
    color: '#be3592',
    transform: [{ rotateY: '180deg' }, { translateZ: HALF }],
  },
  {
    name: 'left',
    color: '#ff3b30',
    transform: [{ rotateY: '-90deg' }, { translateZ: HALF }],
  },
  {
    name: 'right',
    color: '#5a9992',
    transform: [{ rotateY: '90deg' }, { translateZ: HALF }],
  },
  {
    name: 'top',
    color: '#00992e',
    transform: [{ rotateX: '90deg' }, { translateZ: HALF }],
  },
  {
    name: 'bottom',
    color: '#97992e',
    transform: [{ rotateX: '-90deg' }, { translateZ: HALF }],
  },
  { name: 'front', color: '#0a84ff', transform: [{ translateZ: HALF }] },
];

function Cube({ width, height }: { width: number; height: number }) {
  const tilt = useSharedValue(-0.4);
  const turn = useSharedValue(0.6);
  const drag = usePanGesture({
    onUpdate: e => {
      'worklet';
      turn.value += e.changeX * DRAG;
      tilt.value -= e.changeY * DRAG;
    },
    onDeactivate: e => {
      'worklet';
      turn.value = withDecay({ velocity: e.velocityX * DRAG });
      tilt.value = withDecay({ velocity: -e.velocityY * DRAG });
    },
  });

  return (
    <GestureDetector gesture={drag}>
      {/* A <Canvas> as the detector's direct child draws nothing; a View between works. */}
      <View style={styles.root}>
        <Canvas style={{ width, height }}>
          <Fill color="#101010" />
          <Group
            preserve3d
            transform={[
              { translate: [width / 2, height / 2] },
              { perspective: 900 },
              { rotateX: tilt },
              { rotateY: turn },
            ]}
          >
            {FACES.map(face => (
              <Group key={face.name} transform={face.transform}>
                <Rect
                  x={-HALF}
                  y={-HALF}
                  width={SIZE}
                  height={SIZE}
                  color={face.color}
                />
                <Text
                  x={-HALF + 16}
                  y={HALF - 20}
                  text={face.name}
                  fontSize={26}
                  color="#fff"
                />
              </Group>
            ))}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

export function CubeScreen() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View style={styles.root} onLayout={e => setSize(e.nativeEvent.layout)}>
      {size.width > 0 && (
        <Cube
          key={`${size.width}x${size.height}`}
          width={size.width}
          height={size.height}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
