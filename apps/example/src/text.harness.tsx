// Text: bundled faces, weights, paragraphs, spans, glyphs, text on a path, and measurement.
import React from 'react';
import {
  beforeAll,
  describe,
  expect,
  render,
  test,
} from 'react-native-harness';
import {
  Fill,
  Glyphs,
  Group,
  LinearGradient,
  Paint,
  Path,
  Rect,
  Span,
  Text,
  TextPath,
  glyphIds,
  loadFonts,
  measureText,
  registeredFontFamilies,
  textPath,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const FAMILY = 'PT Serif';

const PARAGRAPH =
  'A paragraph that wraps inside an explicit width, breaks at word boundaries, and stacks on its own line height.';

// Registered once for the whole file: a per-test `useFonts` would race the screenshot.
beforeAll(async () => {
  await loadFonts({
    [FAMILY]: [
      require('./assets/fonts/PT_Serif-Web-Regular.ttf'),
      require('./assets/fonts/PT_Serif-Web-Bold.ttf'),
      require('./assets/fonts/PT_Serif-Web-Italic.ttf'),
    ],
  });
});

describe('tgfx font registry', () => {
  test('lists the family it registered', () => {
    expect(registeredFontFamilies()).toContain(FAMILY);
  });

  test('measures a string it can lay out', () => {
    const box = measureText('measured', { fontSize: 22, fontFamily: FAMILY });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    // Baseline-relative: the ascent runs up from it, so it is negative.
    expect(box.ascent).toBeLessThan(0);
    expect(box.lines.length).toBe(1);
  });

  test('a bigger font size measures wider', () => {
    const small = measureText('measured', { fontSize: 12, fontFamily: FAMILY });
    const large = measureText('measured', { fontSize: 24, fontFamily: FAMILY });
    expect(large.width).toBeGreaterThan(small.width);
  });

  test('wrapping into a width produces more than one line', () => {
    const wrapped = measureText(PARAGRAPH, {
      fontSize: 14,
      fontFamily: FAMILY,
      width: 160,
    });
    expect(wrapped.lines.length).toBeGreaterThan(1);
    for (const line of wrapped.lines) {
      expect(line.width).toBeLessThanOrEqual(161);
    }
  });

  test('resolves a glyph id per codepoint', () => {
    const ids = glyphIds('abc', { fontSize: 20, fontFamily: FAMILY });
    expect(ids.length).toBe(3);
    // 0 is "this face has no glyph"; a Latin face has all three.
    expect(ids.every(id => id > 0)).toBe(true);
  });

  test('emits path data for a laid-out string', () => {
    const data = textPath('outlined', { fontSize: 44, fontFamily: FAMILY });
    expect(data.length).toBeGreaterThan(0);
    expect(data.startsWith('M')).toBe(true);
  });
});

describe('tgfx text rendering', () => {
  test('draws weights and styles from one family', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Text
          x={8}
          y={34}
          text="Regular 400"
          fontSize={22}
          fontFamily={FAMILY}
          color="#111"
        />
        <Text
          x={8}
          y={70}
          text="Bold 700"
          fontSize={22}
          fontFamily={FAMILY}
          fontWeight="bold"
          color="#111"
        />
        <Text
          x={8}
          y={106}
          text="Italic"
          fontSize={22}
          fontFamily={FAMILY}
          fontStyle="italic"
          color="#111"
        />
        <Text
          x={8}
          y={142}
          text="letterspaced"
          fontSize={20}
          fontFamily={FAMILY}
          letterSpacing={4}
          color="#8E8E93"
        />
        <Text
          x={8}
          y={182}
          text="fallback face"
          fontSize={20}
          color="#0A84FF"
        />
      </Stage>,
    );
    await snapshot('text-families');
  });

  test('synthesises emphasis the face does not have', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Text
          x={8}
          y={40}
          text="Regular"
          fontSize={24}
          fontFamily={FAMILY}
          color="#111"
        />
        <Text
          x={8}
          y={85}
          text="fauxBold"
          fontSize={24}
          fontFamily={FAMILY}
          fauxBold
          color="#111"
        />
        <Text
          x={8}
          y={130}
          text="fauxItalic"
          fontSize={24}
          fontFamily={FAMILY}
          fauxItalic
          color="#111"
        />
        <Text
          x={8}
          y={175}
          text="both"
          fontSize={24}
          fontFamily={FAMILY}
          fauxBold
          fauxItalic
          color="#111"
        />
      </Stage>,
    );
    await snapshot('text-synthetic-emphasis');
  });

  test('wraps, aligns and ellipsises a paragraph', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Text
          x={6}
          y={16}
          text={PARAGRAPH}
          width={188}
          fontSize={12}
          lineHeight={16}
          fontFamily={FAMILY}
          color="#111"
        />
        <Text
          x={6}
          y={96}
          text={PARAGRAPH}
          width={188}
          textAlign="right"
          fontSize={12}
          lineHeight={16}
          fontFamily={FAMILY}
          color="#5856D6"
        />
        <Text
          x={6}
          y={168}
          text={PARAGRAPH}
          width={188}
          textAlign="center"
          maxLines={2}
          ellipsis="…"
          fontSize={12}
          lineHeight={16}
          fontFamily={FAMILY}
          color="#34C759"
        />
      </Stage>,
    );
    await snapshot('text-paragraph-wrap');
  });

  test('draws the box measureText reported', async () => {
    const label = 'measured';
    const style = {
      fontSize: 26,
      fontFamily: FAMILY,
      fontWeight: 'bold' as const,
    };
    const box = measureText(label, style);
    await render(
      <Stage>
        <Fill color="white" />
        {/* Sized from the measurement, so a wrong metric misaligns visibly. */}
        <Rect
          x={10}
          y={100 + box.ascent}
          width={box.width}
          height={box.height}
          color="#FFD60A"
        />
        <Text x={10} y={100} text={label} {...style} color="#111" />
      </Stage>,
    );
    await snapshot('text-measured-box');
  });

  test('fills text with a gradient', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Text x={8} y={110} text="gradient" fontSize={44} fontFamily={FAMILY}>
          <Paint>
            <LinearGradient
              start={{ x: 8, y: 70 }}
              end={{ x: 190, y: 120 }}
              colors={['#FF6CAB', '#7366FF']}
            />
          </Paint>
        </Text>
      </Stage>,
    );
    await snapshot('text-gradient-fill');
  });

  test('bends text along a path', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <TextPath
          path="M10 140 q45 -80 90 0 t90 -10"
          text="bent along a path"
          fontSize={16}
          fontFamily={FAMILY}
          color="#0A84FF"
        />
      </Stage>,
    );
    await snapshot('text-on-path');
  });

  test('strokes the outline textPath() returned', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateX: 10 }, { translateY: 110 }]}>
          <Path
            path={textPath('outlined', {
              fontSize: 40,
              fontFamily: FAMILY,
              fontWeight: 'bold',
            })}
            color="#d98a4a"
            style="stroke"
            strokeWidth={1.5}
            strokeJoin="round"
          />
        </Group>
      </Stage>,
    );
    await snapshot('text-outlined-path');
  });

  test('styles runs inside one paragraph with <Span>', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Text
          x={6}
          y={30}
          width={188}
          fontSize={15}
          fontFamily={FAMILY}
          color="#1c1c1e"
        >
          <Span text="Total " />
          <Span text="4 500" fontWeight="bold" color="#d98a4a" fontSize={22} />
          <Span text=" credits, with " />
          <Span text="one italic run" fontStyle="italic" color="#0A84FF" />
          <Span text=" inside it." />
        </Text>
      </Stage>,
    );
    await snapshot('text-spans');
  });

  test('places glyph ids by hand', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Glyphs
          x={10}
          y={110}
          fontSize={28}
          fontFamily={FAMILY}
          color="#5856D6"
          glyphs={glyphIds('by hand', {
            fontSize: 28,
            fontFamily: FAMILY,
          }).map((id, i) => ({
            id,
            x: i * 22,
            // A sine ride nothing in <Text> would produce.
            y: Math.sin(i * 0.8) * 18,
          }))}
        />
      </Stage>,
    );
    await snapshot('text-glyphs-placed');
  });
});
