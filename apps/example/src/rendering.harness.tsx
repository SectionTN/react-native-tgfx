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

// 8x8 opaque red PNG, so <Image> needs no asset pipeline. The base64 path is
// still supported; it is just no longer how bytes reach the engine.
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHx9mGBkKAMLXf4EvceABAAAAAElFTkSuQmCC';

/// <Image> takes a native handle, so the base64 goes through useImage first.
function RedImage(props: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const image = useImage(RED_PNG);
  return image == null ? null : <Image {...props} image={image} fit="fill" />;
}

/**
 * `composite="texture"` puts the canvas in the view hierarchy: the harness
 * screenshot walks the view tree, so a separate compositor layer is invisible
 * to it.
 */
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

// ponytail: before the GPU surface presents its first frame the capture is a
// flat fill, and two of those in a row look exactly as "settled" as a finished
// frame — a pure stability poll captures black on the first test of a run. So
// stability is only trusted after the surface has had time to come up. Drop the
// floor if the engine ever exposes a "frame presented" callback to await.
const WARMUP_MS = 700;

/**
 * The engine has no "frame presented" callback, so settling is observed rather
 * than waited out: capture until two consecutive frames are byte-identical.
 * PNG encoding is deterministic, so equal bytes mean an equal image. Unlike a
 * fixed delay this also absorbs a slow frame instead of snapshotting mid-draw.
 */
async function stableScreenshot(element: ElementReference) {
  await sleep(WARMUP_MS);
  let previous: Uint8Array | undefined;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const shot = await screen.screenshot(element);
    // Native capture returns null on failure; toMatchImageSnapshot would then
    // fail on `received.data` with an unrelated message.
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
  // GPU output is never bit-exact across drivers, and the harness default is
  // `failureThreshold: 0` / `'pixel'` — zero differing pixels. pixelmatch's own
  // per-pixel `threshold` (0.1) plus AA detection already absorbs edge jitter;
  // this budgets 0.1% of pixels on top for the rest. SSIM was the alternative
  // and loses on small-area damage: erasing a 4 px slice of stroke scores 0.9805,
  // passing its 0.95 default, where pixelmatch reports 0.332% and fails.
  // Ceiling of both: pixelmatch's 0.1 threshold absorbs a ~14/255 channel delta,
  // so a 0.25 -> 0.30 opacity drift measures 0.000% and escapes this suite.
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

  // PR #69: group / paint / image opacity were parsed but never applied.
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

  // PR #89: an animated field's literal is its current value, not 0, so a
  // never-changing SharedValue still renders.
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

  // PR #80: elliptical arcs are drawn as arcs, and the compact flag form
  // ("110-14" => large=1, sweep=1, x=0, y=-14) is split correctly.
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

  // PR #73: the palette is the full CSS list, so `darkgrey` is #a9a9a9 (not
  // black), `green` is #008000 and `lime` is #00ff00. Every bar is a different
  // colour, so the black fallback bar cannot be confused with a missing name.
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
