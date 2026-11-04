// Node handles and shared values: the two ways a scene changes without a React commit.
import React, { useRef } from 'react';
import { View } from 'react-native';
import { describe, expect, render, test } from 'react-native-harness';
import { useSharedValue } from 'react-native-reanimated';
import {
  Circle,
  Fill,
  Group,
  LinearGradient,
  Rect,
  Shader,
  createHandle,
  useNode,
  type CanvasHandle,
  type NodeHandle,
} from 'react-native-tgfx';
import { Stage, sameFrame, snapshot, sleep, stageBytes } from './testSupport';

const RINGS = `
uniform float2 uSize;
uniform float uBands;
half4 main(float2 pos) {
  float2 uv = pos / uSize;
  float band = fract(length(uv - float2(0.5, 0.5)) * uBands);
  return half4(half3(0.2, 0.6, 1.0) * band, 1.0);
}
`;

/** A scene whose only mutation path is the handle handed in. */
function Patched({
  handle,
  children,
}: {
  handle: NodeHandle;
  children?: React.ReactNode;
}) {
  return (
    <Stage>
      <Fill color="white" />
      <Rect ref={handle} x={20} y={20} width={60} height={60} color="#0A84FF" />
      {children}
    </Stage>
  );
}

describe('tgfx node handles', () => {
  test('createHandle returns a settable handle before it is attached', () => {
    const handle = createHandle();
    // Nothing is mounted yet: a write is a no-op, not a throw.
    expect(() => handle.set({ x: 10 })).not.toThrow();
  });

  test('renders the node at its committed props', async () => {
    function Scene() {
      const rect = useNode();
      return <Patched handle={rect} />;
    }
    await render(<Scene />);
    await snapshot('imperative-rect-committed');
  });

  test('moves and resizes a node through set() with no re-render', async () => {
    let renders = 0;
    let rect: NodeHandle | null = null;

    function Scene() {
      renders += 1;
      const handle = useNode();
      rect = handle;
      return <Patched handle={handle} />;
    }

    await render(<Scene />);
    const before = renders;
    const unpatched = await stageBytes();

    rect!.set({ x: 110, y: 110, width: 70, height: 70, color: '#FF3B30' });
    await sleep(200);
    const patched = await stageBytes(0);

    // The whole point: the patch redraws without another React commit.
    expect(renders).toBe(before);
    // Asserted against the previous frame, not a baseline: a patch that never
    // lands would otherwise write the unpatched frame and pass from then on.
    expect(sameFrame(unpatched, patched)).toBe(false);
    await snapshot('imperative-rect-patched');
  });

  // The write above took the recompile path (`color` on a packed-colour node
  // has no slot). This is the pure slot path: no colour, one prop, only
  // pushValues() — the #230 shape, asserted as a frame change because a
  // baseline written from an unpatched frame passes forever.
  test('a single-prop write with no colour repaints', async () => {
    let rect: NodeHandle | null = null;
    function Scene() {
      const handle = useNode();
      rect = handle;
      return <Patched handle={handle} />;
    }
    await render(<Scene />);
    const before = await stageBytes();

    rect!.set({ x: 110 });
    await sleep(200);
    expect(sameFrame(before, await stageBytes(0))).toBe(false);
  });

  test('hides a node through the visible slot', async () => {
    let rect: NodeHandle | null = null;
    function Scene() {
      const handle = useNode();
      rect = handle;
      return <Patched handle={handle} />;
    }
    await render(<Scene />);
    rect!.set({ visible: false });
    await sleep(120);
    await snapshot('imperative-rect-hidden');
  });

  test('patches gradient stops through a handle', async () => {
    let gradient: NodeHandle | null = null;
    function Scene() {
      const handle = useNode();
      gradient = handle;
      return (
        <Stage>
          <Fill color="white" />
          <Rect x={10} y={10} width={180} height={180}>
            <LinearGradient
              ref={handle}
              start={{ x: 10, y: 10 }}
              end={{ x: 190, y: 190 }}
              colors={['#FF6CAB', '#7366FF']}
            />
          </Rect>
        </Stage>
      );
    }
    await render(<Scene />);
    gradient!.set({ colors: ['#11998e', '#38ef7d'] });
    await sleep(120);
    await snapshot('imperative-gradient-patched');
  });

  test('patches a shader uniform through a handle', async () => {
    let shader: NodeHandle | null = null;
    function Scene() {
      const handle = useNode();
      shader = handle;
      return (
        <Stage>
          <Fill>
            <Shader
              ref={handle}
              source={RINGS}
              uniforms={{ uSize: [200, 200], uBands: 4 }}
            />
          </Fill>
        </Stage>
      );
    }
    await render(<Scene />);
    shader!.set({ uniforms: { uSize: [200, 200], uBands: 14 } });
    await sleep(120);
    await snapshot('imperative-shader-uniform-patched');
  });

  test('pools nodes: an unused slot draws nothing at zero size', async () => {
    const SLOTS = [0, 1, 2, 3];
    let slots: NodeHandle[] = [];
    function Scene() {
      const handles = [useNode(), useNode(), useNode(), useNode()];
      slots = handles;
      return (
        <Stage>
          <Fill color="white" />
          {SLOTS.map(i => (
            <Circle
              key={i}
              ref={handles[i]}
              cx={0}
              cy={0}
              r={0}
              color="#34C759"
            />
          ))}
        </Stage>
      );
    }
    await render(<Scene />);
    const empty = await stageBytes();

    // Two of four filled, exactly how the face-blur screen drives its ovals.
    slots[0]!.set({ cx: 60, cy: 60, r: 40 });
    slots[1]!.set({ cx: 140, cy: 140, r: 30 });
    await sleep(200);
    const filled = await stageBytes(0);

    expect(sameFrame(empty, filled)).toBe(false);
    await snapshot('imperative-pooled-slots');
  });
});

describe('tgfx shared values', () => {
  test('renders a scene driven by a shared value', async () => {
    function Scene() {
      const radius = useSharedValue(70);
      const opacity = useSharedValue(0.55);
      return (
        <Stage>
          <Fill color="white" />
          <Group opacity={opacity}>
            <Circle cx={100} cy={100} r={radius} color="#5856D6" />
          </Group>
        </Stage>
      );
    }
    await render(<Scene />);
    await snapshot('animated-shared-value');
  });

  test('a shared value write redraws without a commit', async () => {
    let renders = 0;
    let radius: { value: number } | null = null;

    function Scene() {
      renders += 1;
      const r = useSharedValue(30);
      radius = r;
      return (
        <Stage>
          <Fill color="white" />
          <Circle cx={100} cy={100} r={r} color="#FF9500" />
        </Stage>
      );
    }

    await render(<Scene />);
    const before = renders;
    const unwritten = await stageBytes();
    radius!.value = 85;
    await sleep(200);

    expect(renders).toBe(before);
    // Against the previous frame too: if the write never lands, the baseline
    // below is captured from the unwritten frame and passes forever after.
    expect(sameFrame(unwritten, await stageBytes(0))).toBe(false);
    await snapshot('animated-shared-value-written');
  });

  test('a new shared value set keeps redrawing after the driver rebinds', async () => {
    let grow: (() => void) | null = null;
    let width: { value: number } | null = null;

    function Scene() {
      const r = useSharedValue(30);
      const w = useSharedValue(40);
      const [both, setBoth] = React.useState(false);
      grow = () => setBoth(true);
      width = w;
      return (
        <Stage>
          <Fill color="white" />
          <Circle cx={60} cy={60} r={r} color="#FF9500" />
          {both ? (
            <Rect x={20} y={120} width={w} height={40} color="#34C759" />
          ) : null}
        </Stage>
      );
    }

    await render(<Scene />);
    // A second shared value changes the set, so the driver starts on a new mirror.
    grow!();
    await sleep(200);
    const grown = await stageBytes(0);
    width!.value = 160;
    await sleep(200);
    // Only a push from the new block carries the width slot.
    expect(sameFrame(grown, await stageBytes(0))).toBe(false);
  });

  test('a canvas hidden and shown again keeps animating', async () => {
    let hide: ((hidden: boolean) => void) | null = null;
    let radius: { value: number } | null = null;

    function Scene() {
      const r = useSharedValue(30);
      const [hidden, setHidden] = React.useState(false);
      radius = r;
      hide = setHidden;
      return (
        <View style={{ display: hidden ? 'none' : 'flex' }}>
          <Stage>
            <Fill color="white" />
            <Circle cx={100} cy={100} r={r} color="#5856D6" />
          </Stage>
        </View>
      );
    }

    await render(<Scene />);
    // iOS unmounts a hidden view and recycles it, which drops its value binding.
    hide!(true);
    await sleep(200);
    hide!(false);
    await sleep(200);
    const shown = await stageBytes(0);
    radius!.value = 85;
    await sleep(200);
    expect(sameFrame(shown, await stageBytes(0))).toBe(false);
  });
});

describe('tgfx canvas handle', () => {
  test('hit-tests the node under a point', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;
    let disc: NodeHandle | null = null;

    function Scene() {
      const ref = useRef<CanvasHandle>(null);
      const handle = useNode();
      canvas = ref;
      disc = handle;
      return (
        <Stage canvasRef={ref}>
          <Fill color="white" />
          <Circle ref={handle} cx={60} cy={60} r={40} color="#0A84FF" />
        </Stage>
      );
    }

    await render(<Scene />);
    await sleep(300);

    const inside = canvas!.current!.hitTest(60, 60);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside[0]!.node).toBe(disc);

    // Outside the disc only the unnamed <Fill> under it answers.
    const outside = canvas!.current!.hitTest(190, 190);
    expect(outside.some(hit => hit.node === disc)).toBe(false);
  });

  test('reads the canvas back as encoded png bytes', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;

    function Scene() {
      const ref = useRef<CanvasHandle>(null);
      canvas = ref;
      return (
        <Stage canvasRef={ref}>
          <Fill color="#0A84FF" />
        </Stage>
      );
    }

    await render(<Scene />);
    await sleep(300);

    const shot = await canvas!.current!.snapshot();
    expect(shot.format).toBe('png');
    expect(shot.width).toBeGreaterThan(0);
    expect(shot.height).toBeGreaterThan(0);
    expect(shot.data.byteLength).toBeGreaterThan(0);
  });

  test('crops and scales a readback', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;

    function Scene() {
      const ref = useRef<CanvasHandle>(null);
      canvas = ref;
      return (
        <Stage canvasRef={ref}>
          <Fill color="#34C759" />
        </Stage>
      );
    }

    await render(<Scene />);
    await sleep(300);

    const full = await canvas!.current!.snapshot({ format: 'raw' });
    const half = await canvas!.current!.snapshot({
      format: 'raw',
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    // Device pixel ratios are not all integers, so the half-crop can land a
    // pixel either side of exactly half.
    expect(Math.abs(half.width - full.width / 2)).toBeLessThanOrEqual(1);
    // raw is straight RGBA8888 rows, so the byte count follows the pixel count.
    expect(half.data.byteLength).toBe(half.width * half.height * 4);
  });
});
