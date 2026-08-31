// getCacheInfo/purgeCaches: cache accounting, and the immediate drop a purge is.
import React from 'react';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  render,
  test,
} from 'react-native-harness';
import {
  Fill,
  Rect,
  TgfxImage as TgfxImageView,
  getCacheInfo,
  loadImage,
  purgeCaches,
  renderToImage,
  type TgfxImage,
} from 'react-native-tgfx';
import { Stage, sleep } from './testSupport';

/** 256×256 RGBA: 256 KiB of decoded pixels per image. */
const SIZE = 256;
const COUNT = 8;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

const decoded: TgfxImage[] = [];
let peak = { imageBytes: 0, imageLimit: 0, gpuBytes: 0, offscreenGpuBytes: 0 };

describe('tgfx caches', () => {
  beforeAll(async () => {
    // Unique scene → PNG → decode back, so each handle is a real codec entry
    // whose resident pixels the image cache accounts for. (A fromPixels handle
    // is per-frame and refuses to encode, so the bytes come from renderToImage.)
    for (let i = 0; i < COUNT; i += 1) {
      const rendered = await renderToImage(
        <>
          <Fill color={`hsl(${(i * 41) % 360}, 80%, 60%)`} />
          <Rect x={i * 9} y={i * 5} width={90} height={90} color="#123456" />
        </>,
        { width: SIZE, height: SIZE }
      );
      const png = await rendered.encode('png');
      rendered.dispose();
      decoded.push(await loadImage(toBase64(png)));
    }
  }, 30_000);

  afterAll(() => {
    for (const image of decoded) {
      image.dispose();
    }
    decoded.length = 0;
  });

  test('counts the resident decoded pixels against the budget', () => {
    const info = getCacheInfo();
    expect(info.imageBytes).toBeGreaterThanOrEqual(COUNT * SIZE * SIZE * 4);
    expect(info.imageLimit).toBe(64 * 1024 * 1024);
  });

  test('publishes GPU bytes once frames have drawn', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {decoded.map((image, i) => (
          <TgfxImageView
            key={i}
            x={(i % 4) * 50}
            y={Math.floor(i / 4) * 50}
            width={50}
            height={50}
            image={image}
          />
        ))}
      </Stage>
    );
    await sleep(400);
    peak = getCacheInfo();
    expect(peak.gpuBytes).toBeGreaterThan(0);
    // encode() in beforeAll went through the shared offscreen context.
    expect(peak.offscreenGpuBytes).toBeGreaterThan(0);
  });

  test('purge frees the decoded pixels before it returns', async () => {
    // Off screen first: an image still in the scene would re-decode at once.
    await render(
      <Stage>
        <Fill color="white" />
      </Stage>
    );
    await sleep(200);
    expect(getCacheInfo().imageBytes).toBeGreaterThan(0);
    purgeCaches();
    expect(getCacheInfo().imageBytes).toBe(0);
  });

  test('purge drops the canvas GPU cache within a frame', async () => {
    await sleep(500);
    const after = getCacheInfo();
    expect(after.gpuBytes).toBeLessThan(peak.gpuBytes);
    expect(after.offscreenGpuBytes).toBeLessThanOrEqual(peak.offscreenGpuBytes);
  });

  test('handles survive a purge and re-decode on draw', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <TgfxImageView x={20} y={20} width={160} height={160} image={decoded[0]} />
      </Stage>
    );
    await sleep(500);
    expect(getCacheInfo().imageBytes).toBeGreaterThan(0);
  });
});
