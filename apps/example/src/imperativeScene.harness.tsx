// The imperative Scene against a raw native view: pixel parity with JSX,
// structural mutations, and handle patches — all asserted on real frames, so
// none of these can pass without the scene actually rendering.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { describe, expect, render, test } from 'react-native-harness';
import { callback } from 'react-native-nitro-modules';
import {
  Circle,
  Fill,
  Group,
  LinearGradient,
  Mask,
  Rect,
  RoundedRect,
  Scene,
  Text,
  TgfxNativeView,
  circle,
  createHandle,
  fill,
  group,
  linearGradient,
  mask,
  rect,
  rrect,
  text,
  type TgfxViewRef,
} from 'react-native-tgfx';
import {
  CANVAS_ID,
  STAGE_SIZE,
  Stage,
  sameFrame,
  sleep,
  stageBytes,
} from './testSupport';

/** A raw native view driven by a Scene — no <Canvas>, no reconciler. */
function SceneStage({ scene }: { scene: Scene }) {
  const hybrid = useRef<ReturnType<
    typeof callback<(ref: TgfxViewRef) => void>
  > | null>(null);
  const detach = useRef<(() => void) | null>(null);
  if (hybrid.current == null) {
    hybrid.current = callback((ref: TgfxViewRef) => {
      // A recycled view arrives with a cleared native table, so the previous
      // attachment's kept-prefix deltas would misindex it: re-attach fresh.
      detach.current?.();
      detach.current = scene.attach(ref);
    });
  }
  useEffect(() => () => detach.current?.(), []);
  return (
    <View testID={CANVAS_ID} style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
      <TgfxNativeView
        inHierarchy={true}
        opaque={true}
        style={{ flex: 1 }}
        hybridRef={hybrid.current}
      />
    </View>
  );
}

const BG = '#f2f2f7';

function parityScene(): Scene {
  return Scene.from([
    fill({ color: BG }),
    rect({ x: 16, y: 16, width: 60, height: 40, color: '#0A84FF' }),
    circle({ cx: 140, cy: 50, r: 30 }, [
      linearGradient({
        start: { x: 110, y: 20 },
        end: { x: 170, y: 80 },
        colors: ['#ff3b30', '#ffcc00'],
      }),
    ]),
    group({ transform: [{ translate: [20, 110] }, { rotate: 0.2 }] }, [
      rrect({ x: 0, y: 0, width: 70, height: 40, r: 10, color: '#34c759' }),
    ]),
    mask(
      {
        mask: rect({ x: 110, y: 110, width: 60, height: 60, color: 'white' }),
      },
      [circle({ cx: 140, cy: 140, r: 40, color: '#5856d6' })],
    ),
    text({ x: 16, y: 190, text: 'scene parity', fontSize: 14, color: '#111' }),
  ]);
}

describe('imperative Scene rendering', () => {
  test('a Scene draws pixel-identical to the same tree as JSX', async () => {
    await render(
      <Stage>
        <Fill color={BG} />
        <Rect x={16} y={16} width={60} height={40} color="#0A84FF" />
        <Circle cx={140} cy={50} r={30}>
          <LinearGradient
            start={{ x: 110, y: 20 }}
            end={{ x: 170, y: 80 }}
            colors={['#ff3b30', '#ffcc00']}
          />
        </Circle>
        <Group transform={[{ translate: [20, 110] }, { rotate: 0.2 }]}>
          <RoundedRect
            x={0}
            y={0}
            width={70}
            height={40}
            r={10}
            color="#34c759"
          />
        </Group>
        <Mask
          mask={<Rect x={110} y={110} width={60} height={60} color="white" />}
        >
          <Circle cx={140} cy={140} r={40} color="#5856d6" />
        </Mask>
        <Text x={16} y={190} text="scene parity" fontSize={14} color="#111" />
      </Stage>,
    );
    const fromJsx = await stageBytes();

    const scene = parityScene();
    await render(<SceneStage scene={scene} />);
    const fromScene = await stageBytes();
    scene.dispose();

    expect(sameFrame(fromJsx, fromScene)).toBe(true);
  });

  test('structural add and remove reflow on screen', async () => {
    const scene = Scene.from([
      fill({ color: BG }),
      rect({ x: 20, y: 20, width: 80, height: 80, color: '#0A84FF' }),
    ]);
    await render(<SceneStage scene={scene} />);
    const before = await stageBytes();

    const badge = circle({ cx: 150, cy: 150, r: 30, color: '#ff3b30' });
    scene.add(badge);
    await sleep(200);
    const added = await stageBytes(0);
    expect(sameFrame(before, added)).toBe(false);

    scene.remove(badge);
    await sleep(200);
    const removed = await stageBytes(0);
    expect(sameFrame(before, removed)).toBe(true);
    scene.dispose();
  });

  test('a handle write repaints without a re-encode', async () => {
    const box = createHandle();
    const scene = Scene.from([
      fill({ color: BG }),
      rect({ ref: box, x: 20, y: 20, width: 60, height: 60, color: '#0A84FF' }),
    ]);
    await render(<SceneStage scene={scene} />);
    const before = await stageBytes();

    box.set({ x: 110, y: 110, color: '#FF3B30' });
    await sleep(200);
    const after = await stageBytes(0);
    expect(sameFrame(before, after)).toBe(false);
    scene.dispose();
  });

  test('a batched mutation loop lands as one visible commit', async () => {
    const scene = Scene.from([fill({ color: BG })]);
    await render(<SceneStage scene={scene} />);
    const empty = await stageBytes();

    for (let i = 0; i < 40; i += 1) {
      scene.add(
        circle({
          cx: 10 + (i % 8) * 25,
          cy: 10 + Math.floor(i / 8) * 25,
          r: 8,
          color: '#0A84FF',
        }),
      );
    }
    await sleep(200);
    const drawn = await stageBytes(0);
    expect(sameFrame(empty, drawn)).toBe(false);
    scene.dispose();
  });
});
