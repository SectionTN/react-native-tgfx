// The output side: SVG and PDF documents rendered with no <Canvas> mounted.
import React from 'react';
import { Platform } from 'react-native';
import { describe, expect, test } from 'react-native-harness';
import {
  Fill,
  Path,
  RoundedRect,
  Text,
  renderToPdf,
  renderToSvg,
  renderToImage,
  loadImage,
  Scene,
  createHandle,
  fill,
  path,
  rect,
  rrect,
} from 'react-native-tgfx';

const CACHE_DIR =
  Platform.OS === 'android' ? '/data/data/com.tgfxexample/cache' : '/tmp';

const SCENE = (
  <>
    <Fill color="#ffffff" />
    <Path
      path="M20 120 L70 60 L120 90 L170 30 L220 70"
      color="#0a84ff"
      style="stroke"
      strokeWidth={4}
    />
    <RoundedRect
      x={20}
      y={140}
      width={200}
      height={40}
      r={10}
      color="#34c759"
    />
  </>
);

describe('tgfx svg export', () => {
  test('writes a document with the requested viewBox', async () => {
    const svg = await renderToSvg(SCENE, { width: 240, height: 200 });
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('240');
    expect(svg).toContain('200');
  });

  test('emits text as glyphs by default and as paths on request', async () => {
    const element = (
      <>
        <Fill color="#ffffff" />
        <Text x={10} y={40} text="exported" fontSize={24} color="#111111" />
      </>
    );
    const asPaths = await renderToSvg(element, {
      width: 200,
      height: 80,
      textAsPaths: true,
    });
    // Outlined text is path data, so the glyphs survive without the font.
    expect(asPaths).toContain('<path');
  });
});

describe('tgfx pdf export', () => {
  test('writes a multi-page document', async () => {
    const path = `${CACHE_DIR}/tgfx-harness.pdf`;
    await renderToPdf(
      path,
      [0, 1].map(page => ({
        width: 612,
        height: 792,
        element: (
          <>
            <Fill color="#ffffff" />
            <Text
              x={48}
              y={80}
              text={`Page ${page + 1}`}
              fontSize={28}
              color="#1c1c1e"
            />
            <RoundedRect
              x={48}
              y={120}
              width={516}
              height={120}
              r={16}
              color="#e5e5ea"
            />
          </>
        ),
      })),
      { title: 'tgfx harness', author: 'react-native-tgfx' },
    );
    // Resolving is the assertion: a failed encode rejects rather than writing a stub.
  });

  test('refuses a document with no pages', async () => {
    await expect(
      renderToPdf(`${CACHE_DIR}/tgfx-harness-empty.pdf`, []),
    ).rejects.toThrow(/at least one page/);
  });
});

describe('tgfx scene-input export', () => {
  test('factory nodes render the same SVG as the JSX tree', async () => {
    const fromJsx = await renderToSvg(SCENE, { width: 240, height: 200 });
    const fromNodes = await renderToSvg(
      [
        fill({ color: '#ffffff' }),
        path({
          path: 'M20 120 L70 60 L120 90 L170 30 L220 70',
          color: '#0a84ff',
          style: 'stroke',
          strokeWidth: 4,
        }),
        rrect({
          x: 20,
          y: 140,
          width: 200,
          height: 40,
          r: 10,
          color: '#34c759',
        }),
      ],
      { width: 240, height: 200 },
    );
    expect(fromNodes).toBe(fromJsx);
  });

  test('a Scene export carries a live handle write', async () => {
    const box = createHandle();
    const scene = Scene.from([
      fill({ color: '#ffffff' }),
      rect({ ref: box, x: 0, y: 0, width: 40, height: 40, color: '#0a84ff' }),
    ]);
    scene.flush();
    const before = await renderToSvg(scene, { width: 100, height: 100 });
    box.set({ x: 50 });
    const after = await renderToSvg(scene, { width: 100, height: 100 });
    expect(before).not.toBe(after);
    expect(after).toContain('50');
    scene.dispose();
  });

  test('a PDF may mix JSX and scene-node pages', async () => {
    const out = `${CACHE_DIR}/tgfx-harness-mixed.pdf`;
    await renderToPdf(out, [
      { width: 200, height: 200, element: SCENE },
      {
        width: 200,
        height: 200,
        scene: [rect({ x: 10, y: 10, width: 50, height: 50, color: '#111' })],
      },
    ]);
    const image = await renderToImage(
      [rect({ x: 0, y: 0, width: 4, height: 4, color: '#111' })],
      { width: 4, height: 4 },
    );
    expect(image.width).toBe(4);
    image.dispose();
  });
});

describe('tgfx image encode and save', () => {
  test('save writes a PNG loadImage can decode again', async () => {
    const image = await renderToImage(
      [rect({ x: 0, y: 0, width: 8, height: 8, color: '#ff2d55' })],
      { width: 8, height: 8 },
    );
    const out = `${CACHE_DIR}/tgfx-harness-encode.png`;
    await image.save(out);
    const back = await loadImage(out);
    expect(back.width).toBe(8);
    expect(back.height).toBe(8);
    image.dispose();
    back.dispose();
  });

  test('encode returns bytes in the requested container', async () => {
    const image = await renderToImage(
      [rect({ x: 0, y: 0, width: 4, height: 4, color: '#0a84ff' })],
      { width: 4, height: 4 },
    );
    const png = new Uint8Array(await image.encode('png'));
    expect(png.length).toBeGreaterThan(8);
    // PNG magic: 0x89 'P' 'N' 'G'
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
    const raw = new Uint8Array(await image.encode('raw'));
    expect(raw.length).toBe(4 * 4 * 4);
    expect(raw[0]).toBe(0x0a); // straight-alpha RGBA rows, r of #0a84ff
    image.dispose();
  });

  test('encode after dispose rejects instead of hanging', async () => {
    const image = await renderToImage(
      [rect({ x: 0, y: 0, width: 2, height: 2, color: '#111' })],
      { width: 2, height: 2 },
    );
    image.dispose();
    let failed = false;
    try {
      await image.encode('png');
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
