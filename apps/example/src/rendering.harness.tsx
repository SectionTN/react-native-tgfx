import React from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { describe, expect, render, test } from 'react-native-harness';
import { screen, type ElementReference } from '@react-native-harness/ui';
import {
  Canvas,
  Circle,
  Group,
  Image,
  Paint,
  Path,
  Rect,
  useImage,
} from 'react-native-tgfx';

const CANVAS_ID = 'tgfx-harness-canvas';

const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHx9mGBkKAMLXf4EvceABAAAAAElFTkSuQmCC';

function RedImage(props: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const image = useImage(RED_PNG);
  return image == null ? null : <Image {...props} image={image} fit="fill" />;
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <View testID={CANVAS_ID} style={{ width: 200, height: 200 }}>
      <Canvas style={{ flex: 1 }} composite="texture" opaque>
        {children}
      </Canvas>
    </View>
  );
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(() => resolve(), ms));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// ponytail: before the first frame presents, two flat fills look as settled as a finished frame.
const WARMUP_MS = 700;

async function stableScreenshot(element: ElementReference) {
  await sleep(WARMUP_MS);
  let previous: Uint8Array | undefined;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const shot = await screen.screenshot(element);
    if (!shot) {
      throw new Error(`Screenshot of "${CANVAS_ID}" failed`);
    }
    if (previous !== undefined && sameBytes(previous, shot.data)) {
      return shot;
    }
    previous = shot.data;
    await sleep(100);
  }
  throw new Error(`Canvas "${CANVAS_ID}" never settled to a stable frame`);
}

async function snapshot(name: string) {
  const element = await screen.findByTestId(CANVAS_ID);
  const shot = await stableScreenshot(element);
  // GPU output is never bit-exact, so this budgets 0.1% of pixels on top of pixelmatch's AA pass.
  await expect(shot).toMatchImageSnapshot({
    name,
    failureThreshold: 0.001,
    failureThresholdType: 'percent',
  });
}

describe('tgfx rendering', () => {
  test('draws basic shapes', async () => {
    await render(
      <Stage>
        <Rect x={20} y={20} width={80} height={60} color="#3366ff" />
        <Circle cx={140} cy={130} r={45} color="orange" />
      </Stage>,
    );
    await snapshot('shapes-rect-circle');
  });

  test('applies group opacity', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group opacity={0.25}>
          <Rect x={20} y={20} width={160} height={70} color="red" />
        </Group>
        <Group opacity={1}>
          <Rect x={20} y={110} width={160} height={70} color="red" />
        </Group>
      </Stage>,
    );
    await snapshot('opacity-group');
  });

  test('applies an animated group opacity', async () => {
    function AnimatedOpacity() {
      const opacity = useSharedValue(0.3);
      return (
        <Stage>
          <Rect x={0} y={0} width={200} height={200} color="white" />
          <Group opacity={opacity}>
            <Circle cx={100} cy={100} r={80} color="blue" />
          </Group>
        </Stage>
      );
    }

    await render(<AnimatedOpacity />);
    await snapshot('opacity-group-animated');
  });

  test('applies paint opacity and inherits it into an image', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group>
          <Paint color="green" opacity={0.4} />
          <Rect x={20} y={20} width={160} height={60} />
        </Group>
        <Group opacity={0.4}>
          <RedImage x={20} y={110} width={160} height={70} />
        </Group>
      </Stage>,
    );
    await snapshot('opacity-paint-and-image');
  });

  test('draws svg elliptical arcs', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Group transform={[{ translate: [20, 20] }, { scale: 8 }]}>
          <Path path="M8 15a7 7 0 110-14 7 7 0 010 14z" color="purple" />
        </Group>
        <Path
          path="M20 160 A 60 30 0 0 1 180 160"
          color="red"
          style="stroke"
          strokeWidth={6}
        />
      </Stage>,
    );
    await snapshot('path-elliptical-arcs');
  });

  test('resolves named and malformed colours', async () => {
    await render(
      <Stage>
        <Rect x={0} y={0} width={200} height={200} color="white" />
        <Rect x={10} y={8} width={180} height={32} color="darkgray" />
        <Rect x={10} y={44} width={180} height={32} color="darkgrey" />
        <Rect x={10} y={80} width={180} height={32} color="green" />
        <Rect x={10} y={116} width={180} height={32} color="lime" />
        <Rect x={10} y={152} width={180} height={32} color="not-a-colour" />
      </Stage>,
    );
    await snapshot('colors-named-and-malformed');
  });
});
