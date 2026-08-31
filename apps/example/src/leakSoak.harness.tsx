// A memory soak for scripts/leak-check.mjs: ~100s of image, scene, and canvas
// churn while the script watches the process from outside through
// `adb shell dumpsys meminfo`. Deliberately no on-device memory reads here —
// in-process numbers are the flaky kind, the OS accounting is the verdict.
//
// One harness render() for the whole soak, self-driven by state: the harness
// retains bookkeeping per render() call, and a render-per-iteration soak
// measured that retention (~12MB per 90s) instead of the library. The file
// still must finish inside `bridgeTimeout`, raised to 180s in
// rn-harness.config.mjs.
import React, { useEffect, useState } from 'react';
import { describe, render, test } from 'react-native-harness';
import {
  Fill,
  Path,
  Text,
  TgfxImage as TgfxImageView,
  imageFromPixels,
  type TgfxImage,
} from 'react-native-tgfx';
import { Stage, sleep } from './testSupport';

/** 256×256 RGBA: 256 KiB of pixels registered and released per iteration. */
const SIZE = 256;
const ITERATIONS = 450;
/** Surface lifecycle churn too, not just scene churn. */
const REMOUNT_EVERY = 10;

/** Unique pixels per iteration, so nothing upstream can dedupe them. */
function noisePixels(seed: number): ArrayBuffer {
  const words = new Uint32Array(SIZE * SIZE);
  let state = (seed * 2654435761) >>> 0;
  for (let i = 0; i < words.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    words[i] = state | 0xff000000;
  }
  return words.buffer;
}

function zigzag(seed: number): string {
  let d = 'M 10 100';
  for (let i = 1; i <= 12; i += 1) {
    d += ` L ${10 + i * 15} ${100 + ((seed * i * 37) % 80) - 40}`;
  }
  return d;
}

let finish: (() => void) | null = null;
const doneSignal = new Promise<void>(resolve => {
  finish = resolve;
});

function AutoSoak() {
  const [iteration, setIteration] = useState(0);
  const [image, setImage] = useState<TgfxImage | null>(null);

  useEffect(() => {
    if (iteration >= ITERATIONS) {
      image?.dispose();
      finish?.();
      return;
    }
    const next = imageFromPixels(noisePixels(iteration + 1), SIZE, SIZE);
    setImage(previous => {
      previous?.dispose();
      return next;
    });
    const timer = setTimeout(() => setIteration(iteration + 1), 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iteration]);

  return (
    <Stage key={Math.floor(iteration / REMOUNT_EVERY)}>
      <Fill color="white" />
      {image != null && (
        <TgfxImageView x={10} y={10} width={120} height={120} image={image} />
      )}
      <Path
        path={zigzag(iteration + 1)}
        color="#0A84FF"
        style="stroke"
        strokeWidth={3}
      />
      <Text
        x={10}
        y={180}
        text={`soak iteration ${iteration}`}
        fontSize={16}
        color="#111"
      />
    </Stage>
  );
}

describe('leak soak', () => {
  test('churns images, scenes, and surfaces for the meminfo watcher', async () => {
    await render(<AutoSoak />);
    await doneSignal;
    await sleep(500);
  }, 170_000);
});
