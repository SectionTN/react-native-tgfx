// The device half of scripts/cache-purge-check.mjs: fill the tgfx caches, hold
// so the script can measure the plateau in `adb shell dumpsys meminfo`, purge,
// hold again so it can measure the drop. The verdict lives in OS accounting on
// the host — nothing in here reads memory. Phase edges are logcat markers
// (console.log lands in ReactNativeJS).
import React from 'react';
import {
  afterAll,
  beforeAll,
  describe,
  render,
  test,
} from 'react-native-harness';
import {
  Fill,
  Rect,
  TgfxImage as TgfxImageView,
  loadImage,
  purgeCaches,
  renderToImage,
  type TgfxImage,
} from 'react-native-tgfx';
import { Stage, sleep } from './testSupport';

/** 512×512 RGBA: 1 MiB of decoded pixels per image. */
const SIZE = 512;
const COUNT = 20;
const HOLD_MS = 10_000;

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

describe('cache purge, watched over adb', () => {
  beforeAll(async () => {
    // Unique scene → PNG → decode back: real codec entries. A fromPixels
    // handle is per-frame and refuses to encode.
    for (let i = 0; i < COUNT; i += 1) {
      const rendered = await renderToImage(
        <>
          <Fill color={`hsl(${(i * 41) % 360}, 80%, 60%)`} />
          <Rect x={i * 9} y={i * 5} width={200} height={200} color="#123456" />
        </>,
        { width: SIZE, height: SIZE }
      );
      const png = await rendered.encode('png');
      rendered.dispose();
      decoded.push(await loadImage(toBase64(png)));
    }
  }, 45_000);

  afterAll(() => {
    for (const image of decoded) {
      image.dispose();
    }
    decoded.length = 0;
  });

  test('fills the caches and holds', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {decoded.map((image, i) => (
          <TgfxImageView
            key={i}
            x={(i % 5) * 40}
            y={Math.floor(i / 5) * 40}
            width={40}
            height={40}
            image={image}
          />
        ))}
      </Stage>
    );
    await sleep(600);
    console.log('[cache-adb] filled');
    await sleep(HOLD_MS);
  }, 30_000);

  test('purges and holds', async () => {
    // Empty the scene but keep the canvas mounted: its GPU context must stay
    // alive so the purge — not a context teardown — is what frees the memory.
    await render(
      <Stage>
        <Fill color="white" />
      </Stage>
    );
    await sleep(300);
    purgeCaches();
    await sleep(300);
    console.log('[cache-adb] purged');
    await sleep(HOLD_MS);
  }, 30_000);
});
