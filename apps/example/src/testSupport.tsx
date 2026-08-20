// Shared stage + settle-then-screenshot helper for every *.harness.tsx suite.
// Not a test file: the runner only picks up `*.harness.[jt]sx`.
import React from 'react';
import { View } from 'react-native';
import { expect } from 'react-native-harness';
import { screen, type ElementReference } from '@react-native-harness/ui';
import {
  Canvas,
  type CanvasHandle,
  type ColorSpace,
  type Viewport,
} from 'react-native-tgfx';

export const CANVAS_ID = 'tgfx-harness-canvas';

/** Every baseline is this square, so a diff is a rendering change and nothing else. */
export const STAGE_SIZE = 200;

export function Stage({
  children,
  canvasRef,
  viewport,
  colorSpace,
}: {
  children: React.ReactNode;
  /** Only the readback and hit-test suites need one. */
  canvasRef?: React.Ref<CanvasHandle>;
  /** Only the viewport suite needs one. */
  viewport?: Viewport;
  /** Only the colour suite needs one. Read once, when the canvas mounts. */
  colorSpace?: ColorSpace;
}) {
  return (
    <View testID={CANVAS_ID} style={{ width: STAGE_SIZE, height: STAGE_SIZE }}>
      <Canvas
        ref={canvasRef}
        style={{ flex: 1 }}
        composite="texture"
        opaque
        viewport={viewport}
        colorSpace={colorSpace}
      >
        {children}
      </Canvas>
    </View>
  );
}

export const sleep = (ms: number) =>
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
export const WARMUP_MS = 700;

export async function stableScreenshot(
  element: ElementReference,
  warmupMs: number = WARMUP_MS,
) {
  await sleep(warmupMs);
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

/**
 * The settled frame's bytes, for tests that assert a scene *changed* rather
 * than that it matches a baseline. A patch test needs this: if the patch never
 * lands, a baseline written from the unpatched frame passes forever.
 */
export async function stageBytes(warmupMs?: number): Promise<Uint8Array> {
  const element = await screen.findByTestId(CANVAS_ID);
  return (await stableScreenshot(element, warmupMs)).data;
}

/** Whether two settled frames are pixel-identical. */
export function sameFrame(a: Uint8Array, b: Uint8Array): boolean {
  return sameBytes(a, b);
}

/**
 * Screenshot the stage once it stops changing and diff it against its baseline.
 * `warmupMs` buys extra settling time for scenes that decode or register first.
 */
export async function snapshot(name: string, warmupMs?: number) {
  const element = await screen.findByTestId(CANVAS_ID);
  const shot = await stableScreenshot(element, warmupMs);
  // GPU output is never bit-exact, so this budgets 0.1% of pixels on top of pixelmatch's AA pass.
  await expect(shot).toMatchImageSnapshot({
    name,
    failureThreshold: 0.001,
    failureThresholdType: 'percent',
  });
}
