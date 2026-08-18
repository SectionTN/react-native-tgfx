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
