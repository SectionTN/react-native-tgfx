// The headless callables against real frames: the boxed surface driven from
// the UI runtime and from a custom background runtime, the clock driving a
// visible uniform, a sprite buffer feeding a rendered atlas.
import { describe, expect, test } from 'react-native-harness';
import { NitroModules } from 'react-native-nitro-modules';
import {
  createWorkletRuntime,
  scheduleOnRuntime,
  scheduleOnUI,
} from 'react-native-worklets';
import {
  Scene,
  atlas,
  circle,
  createClock,
  createHandle,
  createOffscreenSurface,
  createSpriteBuffer,
  dispatchPress,
  fill,
  rect,
  renderToImage,
  shader,
} from 'react-native-tgfx';
import { sleep } from './testSupport';

const RAMP = `
uniform float uLevel;
half4 main(float2 p) {
  return half4(uLevel, 0.0, 0.0, 1.0);
}
`;

async function raw(surface: {
  toImage: () => Promise<{
    encode: (f?: string) => Promise<ArrayBuffer>;
    dispose: () => void;
  }>;
}): Promise<Uint8Array> {
  const image = await surface.toImage();
  const bytes = new Uint8Array(await image.encode('raw'));
  image.dispose();
  return bytes;
}

describe('tgfx headless callables', () => {
  test('a boxed surface renders from the UI runtime', async () => {
    const surface = createOffscreenSurface({
      width: 16,
      height: 16,
      opaque: true,
    });
    const box = createHandle();
    const scene = Scene.from([
      fill({ color: '#000' }),
      rect({ ref: box, x: 0, y: 0, width: 4, height: 4, color: '#ff2d55' }),
    ]);
    scene.attach(surface);
    scene.flush();
    const before = await raw(surface);
    expect(before[0]).toBe(0xff);

    const boxed = NitroModules.box(surface);
    scheduleOnUI(() => {
      'worklet';
      // Box the object, never destructure its methods.
      const s = boxed.unbox();
      s.setValues([12, 12, 4, 4]);
      s.flush();
    });
    await sleep(300);
    const after = await raw(surface);
    expect(after[0]).toBe(0); // origin vacated by the UI-runtime write
    const corner = (13 * 16 + 13) * 4;
    expect(after[corner]).toBe(0xff);
    scene.dispose();
    surface.dispose();
  });

  test('a background worklet runtime owns the mutate-flush loop', async () => {
    const surface = createOffscreenSurface({
      width: 8,
      height: 8,
      opaque: true,
    });
    const box = createHandle();
    const scene = Scene.from([
      fill({ color: '#000' }),
      rect({ ref: box, x: 0, y: 0, width: 2, height: 2, color: '#0a84ff' }),
    ]);
    scene.attach(surface);
    scene.flush();
    await raw(surface); // surface exists before the guest runtime drives it

    const runtime = createWorkletRuntime({ name: 'tgfx-headless-test' });
    const boxed = NitroModules.box(surface);
    scheduleOnRuntime(runtime, () => {
      'worklet';
      const s = boxed.unbox();
      s.setValues([6, 6, 2, 2]);
      s.flush();
    });
    await sleep(400);
    const after = await raw(surface);
    const corner = (6 * 8 + 6) * 4;
    expect(after[corner + 2]).toBe(0xff); // blue landed bottom-right
    scene.dispose();
    surface.dispose();
  });

  test('createClock advances a uniform the render can see', async () => {
    const clock = createClock();
    await sleep(250);
    const early = clock.value.value;
    expect(early).toBeGreaterThan(0);
    const frame = await renderToImage(
      [fill({}, [shader({ source: RAMP, uniforms: { uLevel: 1 } })])],
      { width: 4, height: 4 },
    );
    const bytes = new Uint8Array(await frame.encode('raw'));
    expect(bytes[0]).toBe(0xff); // the shader path itself renders
    frame.dispose();
    await sleep(250);
    expect(clock.value.value).toBeGreaterThan(early);
    clock.stop();
    const stopped = clock.value.value;
    await sleep(200);
    expect(clock.value.value).toBe(stopped);
  });

  test('a sprite buffer feeds a rendered atlas', async () => {
    const sheet = await renderToImage(
      [rect({ x: 0, y: 0, width: 8, height: 8, color: '#34c759' })],
      { width: 8, height: 8 },
    );
    const sprites = createSpriteBuffer(4);
    sprites.set(0, 0, 0, 8, 8, 1, 20, 20);
    const count = { value: 1, _isReanimatedSharedValue: true as const };
    const still = await renderToImage(
      [
        fill({ color: '#000' }),
        atlas({ image: sheet, buffer: sprites, count } as never),
      ],
      { width: 32, height: 32, opaque: true },
    );
    const bytes = new Uint8Array(await still.encode('raw'));
    const at = (20 * 32 + 20) * 4;
    expect(bytes[at + 1]).toBeGreaterThan(0x80); // green sprite landed at (20,20)
    still.dispose();
    sheet.dispose();
  });

  test('dispatchPress with handlesAt answers headless taps', async () => {
    const surface = createOffscreenSurface({ width: 50, height: 50 });
    const box = createHandle();
    const scene = Scene.from([
      rect({ ref: box, x: 10, y: 10, width: 20, height: 20, color: '#fff' }),
      circle({ cx: 40, cy: 40, r: 5, color: '#fff' }),
    ]);
    scene.attach(surface);
    scene.flush();
    await sleep(50);
    const fired: string[] = [];
    const handlers: [typeof box, () => void][] = [
      [box, () => fired.push('box')],
    ];
    expect(
      dispatchPress(scene.handlesAt(surface.hitTest(15, 15, true)), handlers),
    ).toBe(true);
    expect(
      dispatchPress(scene.handlesAt(surface.hitTest(40, 40, true)), handlers),
    ).toBe(false); // hit the circle, which has no handle
    expect(fired).toEqual(['box']);
    scene.dispose();
    surface.dispose();
  });
});
