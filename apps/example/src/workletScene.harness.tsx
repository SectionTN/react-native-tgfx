// Scenes CREATED on worklet runtimes — not merely driven from them: built,
// attached and flushed with no JS thread involved, asserted on rendered
// pixels against a JS-built twin, so a pass means the worklet path draws.
import { describe, expect, test } from 'react-native-harness';
import { NitroModules } from 'react-native-nitro-modules';
import {
  createWorkletRuntime,
  scheduleOnRuntime,
  scheduleOnUI,
} from 'react-native-worklets';
import {
  Scene,
  circle,
  createOffscreenSurface,
  createScene,
  fill,
  rect,
} from 'react-native-tgfx';
import { sleep } from './testSupport';

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

/** The one scene both sides build; parity is the whole point. */
function jsTwin(): Scene {
  return Scene.from([
    fill({ color: '#101725' }),
    rect({ x: 2, y: 2, width: 8, height: 4, color: '#ff2d55' }),
    circle({ cx: 8, cy: 10, r: 4, color: '#0a84ff' }),
  ]);
}

describe('scenes built on worklet runtimes', () => {
  test('the UI runtime builds a scene pixel-identical to the JS build', async () => {
    const expected = createOffscreenSurface({
      width: 16,
      height: 16,
      opaque: true,
    });
    const twin = jsTwin();
    twin.attach(expected);
    twin.flush();
    const wanted = await raw(expected);

    const surface = createOffscreenSurface({
      width: 16,
      height: 16,
      opaque: true,
    });
    const boxed = NitroModules.box(surface);
    scheduleOnUI(() => {
      'worklet';
      // createScene, not Scene.create: statics do not cross into a worklet.
      const scene = createScene();
      scene.add(fill({ color: '#101725' }));
      scene.add(rect({ x: 2, y: 2, width: 8, height: 4, color: '#ff2d55' }));
      scene.add(circle({ cx: 8, cy: 10, r: 4, color: '#0a84ff' }));
      scene.attach(boxed.unbox());
      scene.flush();
      boxed.unbox().flush();
      // Keep it alive on this runtime for the structural test below.
      (globalThis as { __workletSceneTest?: unknown }).__workletSceneTest =
        scene;
    });
    await sleep(400);
    const got = await raw(surface);
    expect(got.length).toBe(wanted.length);
    let diff = 0;
    for (let i = 0; i < got.length; i++) {
      if (got[i] !== wanted[i]) diff++;
    }
    expect(diff).toBe(0);

    // Structural mutation in a later worklet invocation repaints.
    scheduleOnUI(() => {
      'worklet';
      const scene = (globalThis as { __workletSceneTest?: Scene })
        .__workletSceneTest;
      if (scene != null) {
        scene.add(rect({ x: 12, y: 0, width: 4, height: 4, color: '#ffd60a' }));
        scene.flush();
        boxed.unbox().flush();
      }
    });
    await sleep(400);
    const after = await raw(surface);
    const corner = (1 * 16 + 13) * 4;
    expect(after[corner]).toBe(0xff); // yellow landed top-right
    expect(after[corner + 1]).toBe(0xd6);
    twin.dispose();
    expected.dispose();
    surface.dispose();
  });

  test('a background worklet runtime builds and renders a scene', async () => {
    const expected = createOffscreenSurface({
      width: 16,
      height: 16,
      opaque: true,
    });
    const twin = jsTwin();
    twin.attach(expected);
    twin.flush();
    const wanted = await raw(expected);

    const surface = createOffscreenSurface({
      width: 16,
      height: 16,
      opaque: true,
    });
    const boxed = NitroModules.box(surface);
    const runtime = createWorkletRuntime({ name: 'tgfx-worklet-scene-test' });
    scheduleOnRuntime(runtime, () => {
      'worklet';
      const scene = createScene();
      scene.add(fill({ color: '#101725' }));
      scene.add(rect({ x: 2, y: 2, width: 8, height: 4, color: '#ff2d55' }));
      scene.add(circle({ cx: 8, cy: 10, r: 4, color: '#0a84ff' }));
      scene.attach(boxed.unbox());
      scene.flush();
      boxed.unbox().flush();
    });
    await sleep(500);
    const got = await raw(surface);
    let diff = 0;
    for (let i = 0; i < got.length; i++) {
      if (got[i] !== wanted[i]) diff++;
    }
    expect(diff).toBe(0);
    twin.dispose();
    expected.dispose();
    surface.dispose();
  });
});
