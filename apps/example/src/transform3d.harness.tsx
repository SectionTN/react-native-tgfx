// 3D transforms and preserve3d, asserted on pixels so no device has to own a baseline.
import React, { useRef } from 'react';
import { describe, expect, render, test } from 'react-native-harness';
import {
  Fill,
  Group,
  Rect,
  renderToSvg,
  type CanvasHandle,
} from 'react-native-tgfx';
import { STAGE_SIZE, Stage, WARMUP_MS, sleep } from './testSupport';

const CENTER = STAGE_SIZE / 2;

async function readBack(scene: React.ReactNode) {
  let canvas: React.RefObject<CanvasHandle | null> | null = null;

  function Scene() {
    const ref = useRef<CanvasHandle>(null);
    canvas = ref;
    return (
      <Stage canvasRef={ref}>
        <Fill color="white" />
        {scene}
      </Stage>
    );
  }

  await render(<Scene />);
  await sleep(WARMUP_MS);
  const shot = await canvas!.current!.snapshot({ format: 'raw', scale: 1 });
  const px = new Uint8Array(shot.data);
  return {
    width: shot.width,
    height: shot.height,
    at(x: number, y: number) {
      const i = (y * shot.width + x) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    },
  };
}

const isRed = ([r, , b]: number[]) => r > 200 && b < 60;
const isBlue = ([r, , b]: number[]) => b > 200 && r < 60;

describe('tgfx 3D transforms', () => {
  // A positive rotateY turns the right edge away.
  test('perspective draws the far edge of a turned square shorter', async () => {
    const frame = await readBack(
      <Group
        transform={[
          { translate: [CENTER, CENTER] },
          { perspective: 300 },
          { rotateY: '45deg' },
        ]}
      >
        <Rect x={-60} y={-60} width={120} height={120} color="#ff0000" />
      </Group>,
    );
    const columnHeight = (x: number) => {
      let count = 0;
      for (let y = 0; y < frame.height; y += 1) {
        if (isRed(frame.at(x, y))) {
          count += 1;
        }
      }
      return count;
    };
    let left = 0;
    while (left < frame.width && columnHeight(left) === 0) {
      left += 1;
    }
    let right = frame.width - 1;
    while (right > left && columnHeight(right) === 0) {
      right -= 1;
    }
    expect(right).toBeGreaterThan(left);
    expect(columnHeight(right - 2)).toBeLessThan(columnHeight(left + 2) * 0.9);
  });

  const stacked = (preserve3d: boolean) => (
    <Group
      preserve3d={preserve3d}
      transform={[{ translate: [CENTER, CENTER] }, { perspective: 300 }]}
    >
      <Group transform={[{ translateZ: 40 }]}>
        <Rect x={-50} y={-50} width={100} height={100} color="#ff0000" />
      </Group>
      <Group transform={[{ translateZ: -40 }]}>
        <Rect x={-50} y={-50} width={100} height={100} color="#0000ff" />
      </Group>
    </Group>
  );

  test('without preserve3d the child drawn last covers the other', async () => {
    const frame = await readBack(stacked(false));
    expect(isBlue(frame.at(frame.width / 2, frame.height / 2))).toBe(true);
  });

  test('with preserve3d the nearer child covers the other, whatever the order', async () => {
    const frame = await readBack(stacked(true));
    expect(isRed(frame.at(frame.width / 2, frame.height / 2))).toBe(true);
  });

  test('under picture, preserve3d falls back to draw order', async () => {
    const frame = await readBack(<Group picture>{stacked(true)}</Group>);
    expect(isBlue(frame.at(frame.width / 2, frame.height / 2))).toBe(true);
  });

  test('an svg export of preserve3d keeps both children, in draw order', async () => {
    const svg = (
      await renderToSvg(stacked(true), {
        width: STAGE_SIZE,
        height: STAGE_SIZE,
      })
    ).toLowerCase();
    const red = svg.indexOf('fill="#f00"');
    const blue = svg.indexOf('fill="#00f"');
    expect(red).toBeGreaterThan(-1);
    expect(blue).toBeGreaterThan(red);
  });
});
