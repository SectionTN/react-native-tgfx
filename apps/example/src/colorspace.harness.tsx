// Colour management: every surface this package makes carries a space, so a
// readback and an offscreen render are tagged rather than left to be guessed at.
import React, { useRef } from 'react';
import { describe, expect, render, test } from 'react-native-harness';
import { Fill, Rect, type CanvasHandle, type ColorSpace } from 'react-native-tgfx';
import { Stage, WARMUP_MS, sleep } from './testSupport';

/**
 * True when the PNG declares `name` as a chunk type. Walks the chunk list rather
 * than scanning: an iCCP payload is deflated and IDAT is compressed pixel data,
 * so a plain scan can match those four bytes inside either by chance.
 */
function hasChunk(png: Uint8Array, name: string): boolean {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // Past the 8-byte signature; each chunk is length, type, data, CRC.
  for (let at = 8; at + 8 <= png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      png[at + 4]!,
      png[at + 5]!,
      png[at + 6]!,
      png[at + 7]!,
    );
    if (type === name) {
      return true;
    }
    if (type === 'IEND') {
      return false;
    }
    at += 12 + length;
  }
  return false;
}

async function readBack(
  format: 'png' | 'raw',
  scale: number,
  colorSpace?: ColorSpace,
) {
  let canvas: React.RefObject<CanvasHandle | null> | null = null;

  function Scene() {
    const ref = useRef<CanvasHandle>(null);
    canvas = ref;
    return (
      <Stage canvasRef={ref} colorSpace={colorSpace}>
        <Fill color="white" />
        <Rect x={20} y={20} width={120} height={120} color="#ff0000" />
      </Stage>
    );
  }

  await render(<Scene />);
  await sleep(WARMUP_MS);
  const shot = await canvas!.current!.snapshot({ format, scale });
  return new Uint8Array(shot.data);
}

describe('tgfx colour spaces', () => {
  test('an unscaled png readback carries a colour profile', async () => {
    expect(hasChunk(await readBack('png', 1), 'iCCP')).toBe(true);
  });

  // The scaled path renders through a scratch surface of its own. Untagged, the
  // encoder had nothing to write, so `scale` alone silently dropped the profile.
  test('a scaled png readback carries the same profile', async () => {
    expect(hasChunk(await readBack('png', 2), 'iCCP')).toBe(true);
  });

  // Chunk presence alone proves nothing about P3 — an sRGB profile is a profile
  // too. The pixels are what shows the surface converted on the way in: sRGB red
  // is (255, 0, 0), and the same colour encoded for P3's wider primaries is not.
  test('a display-p3 surface encodes the same red differently', async () => {
    const srgb = await readBack('raw', 1);
    const p3 = await readBack('raw', 1, 'display-p3');
    const at = (px: Uint8Array) => {
      // Inside the rect, in surface pixels: the stage is 200pt at the device ratio.
      const stride = Math.round(Math.sqrt(px.length / 4));
      const i = (Math.round(stride * 0.4) * stride + Math.round(stride * 0.4)) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!];
    };
    const [sr, sg] = at(srgb);
    const [pr, pg] = at(p3);
    expect(sr).toBeGreaterThan(250);
    expect(sg).toBeLessThan(5);
    // Less red, and some green with it — the conversion, not a relabelling.
    expect(pr).toBeLessThan(sr);
    expect(pg).toBeGreaterThan(sg);
  });
});
