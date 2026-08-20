// Retained offscreen surface vs one-shot renderToImage: the iterate-and-export
// loop PR'd in react-native-tgfx#236. Self-measuring; results print to the
// screen and to console for RESULTS.md.
import React, { useEffect, useState } from 'react';
import { ScrollView, Text as RNText } from 'react-native';
import {
  Scene,
  circle,
  createHandle,
  createOffscreenSurface,
  fill,
  group,
  rect,
  renderToImage,
  type NodeHandle,
  type SceneNode,
} from 'react-native-tgfx';

const SIZE = 1024;
const EXPORTS = 20;
const OBJECTS = 400;

function buildScene(handle: NodeHandle): SceneNode[] {
  const nodes: SceneNode[] = [fill({ color: '#101725' })];
  for (let i = 0; i < OBJECTS; i += 1) {
    nodes.push(
      circle({
        cx: (i * 53) % SIZE,
        cy: (i * 97) % SIZE,
        r: 6 + (i % 12),
        color: i % 2 ? '#0A84FF' : '#ff3b30',
      }),
    );
  }
  nodes.push(
    group({ ref: handle, transform: [{ rotate: 0 }] }, [
      rect({
        x: SIZE / 2 - 40,
        y: SIZE / 2 - 40,
        width: 80,
        height: 80,
        color: 'gold',
      }),
    ]),
  );
  return nodes;
}

async function benchRetained(): Promise<number> {
  const spin = createHandle();
  const surface = createOffscreenSurface({
    width: SIZE,
    height: SIZE,
    opaque: true,
  });
  const scene = Scene.from(buildScene(spin));
  scene.attach(surface);
  scene.flush();
  const image = await surface.toImage(); // first frame: compile + surface alloc
  image.dispose();
  const start = Date.now();
  for (let f = 0; f < EXPORTS; f += 1) {
    spin.set({ rotate: (f / EXPORTS) * Math.PI });
    surface.flush();
    const frame = await surface.toImage();
    frame.dispose();
  }
  const elapsed = Date.now() - start;
  scene.dispose();
  surface.dispose();
  return elapsed;
}

async function benchOneShot(): Promise<number> {
  const spin = createHandle();
  const nodes = buildScene(spin);
  const start = Date.now();
  for (let f = 0; f < EXPORTS; f += 1) {
    spin.set({ rotate: (f / EXPORTS) * Math.PI });
    const image = await renderToImage(nodes, {
      width: SIZE,
      height: SIZE,
      opaque: true,
    });
    image.dispose();
  }
  return Date.now() - start;
}

export function OffscreenBench() {
  const [lines, setLines] = useState<string[]>(['running…']);
  useEffect(() => {
    void (async () => {
      const out: string[] = [];
      try {
        const retained = await benchRetained();
        out.push(
          `retained surface: ${EXPORTS} x (slot write + flush + toImage) @${SIZE}\u00b2: ${retained}ms (${(retained / EXPORTS).toFixed(1)}ms/export)`,
        );
        const oneShot = await benchOneShot();
        out.push(
          `one-shot renderToImage: ${EXPORTS} x @${SIZE}\u00b2: ${oneShot}ms (${(oneShot / EXPORTS).toFixed(1)}ms/export)`,
        );
        out.push(`speedup: ${(oneShot / Math.max(1, retained)).toFixed(1)}x`);
      } catch (e) {
        out.push(`OFFSCREEN_BENCH_ERROR ${String(e)}`);
      }
      console.log('OFFSCREEN_BENCH', JSON.stringify(out));
      setLines(out);
    })();
  }, []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff', paddingTop: 80 }}>
      {lines.map((line, i) => (
        <RNText key={i} style={{ padding: 8, fontFamily: 'monospace' }}>
          {line}
        </RNText>
      ))}
    </ScrollView>
  );
}
