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
  glyphPositionAtCoordinate,
  loadFonts,
  measureText,
  rectsForRange,
  registeredFontFamilies,
  textPath,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const FAMILY = 'PT Serif';

/** The range APIs take UTF-8 byte offsets, which for ASCII are string indices. */
const byteLength = (text: string) =>
  [...text].reduce((total, character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      total + (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4)
    );
  }, 0);

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

  test('resolves a coordinate to a caret offset', () => {
    const style = { fontSize: 22, fontFamily: FAMILY };
    const box = measureText('abcdef', style);

    // Left of the string is the very start, on the leading half of the glyph.
    const start = glyphPositionAtCoordinate('abcdef', style, -50, 0);
    expect(start.index).toBe(0);
    expect(start.leading).toBe(true);

    // Past the right edge is after the last byte, and no longer leading.
    const end = glyphPositionAtCoordinate('abcdef', style, box.width + 50, 0);
    expect(end.index).toBe(6);
    expect(end.leading).toBe(false);

    // Sweeping left to right never moves the caret backwards.
    let previous = 0;
    for (let step = 0; step <= 12; step += 1) {
      const at = glyphPositionAtCoordinate(
        'abcdef',
        style,
        (box.width * step) / 12,
        0,
      );
      expect(at.index).toBeGreaterThanOrEqual(previous);
      previous = at.index;
    }
    expect(previous).toBe(6);
  });

  test('a wrapped paragraph resolves a point onto its own line', () => {
    const style = { fontSize: 14, fontFamily: FAMILY, width: 160 };
    const wrapped = measureText(PARAGRAPH, style);
    expect(wrapped.lines.length).toBeGreaterThan(1);

    const second = glyphPositionAtCoordinate(
      PARAGRAPH,
      style,
      0,
      wrapped.lines[1]!.baseline,
    );
    expect(second.line).toBe(1);
    // At x = 0 it is exactly the line's first byte, not merely at or after it.
    expect(second.index).toBe(wrapped.lines[1]!.startIndex);
  });

  // The byte offsets exist for text where they differ from JS string indices.
  test('multi-byte text resolves on codepoint boundaries', () => {
    const style = { fontSize: 22, fontFamily: FAMILY };
    // h=1 byte, é=2, l l o=1 each, so the only valid offsets are these.
    const boundaries = [0, 1, 3, 4, 5, 6];
    const box = measureText('héllo', style);
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const at = glyphPositionAtCoordinate(
        'héllo',
        style,
        (box.width * step) / 20,
        0,
      );
      expect(boundaries).toContain(at.index);
      expect(at.index).toBeGreaterThanOrEqual(previous);
      previous = at.index;
    }
    // One accented letter is one box covering both its bytes, not half of it.
    const accent = rectsForRange('héllo', style, 1, 2);
    expect(accent.length).toBe(1);
    expect(accent[0]!.startIndex).toBe(1);
    expect(accent[0]!.endIndex).toBe(3);
  });

  test('reports the boxes a byte range occupies', () => {
    const style = { fontSize: 22, fontFamily: FAMILY };
    const box = measureText('abcdef', style);

    const one = rectsForRange('abcdef', style, 0, 1);
    expect(one.length).toBe(1);
    expect(one[0]!.width).toBeGreaterThan(0);
    // Baseline-relative like measureText, so the top of the box is above it.
    expect(one[0]!.y).toBeLessThan(0);
    expect(one[0]!.line).toBe(0);

    const all = rectsForRange('abcdef', style, 0, 6);
    expect(all.length).toBe(1);
    expect(all[0]!.width).toBeGreaterThan(one[0]!.width);
    expect(Math.abs(all[0]!.width - box.width)).toBeLessThan(1);

    // Nothing to highlight, rather than a zero-width box.
    expect(rectsForRange('abcdef', style, 3, 3).length).toBe(0);

    // One box per line the range crosses, in order, going down the page. The
    // range is in bytes, and PARAGRAPH is ASCII, so its length is its own — a
    // paragraph that was not would need the encoder.
    const wrapStyle = { fontSize: 14, fontFamily: FAMILY, width: 160 };
    const wrapped = measureText(PARAGRAPH, wrapStyle);
    const crossing = rectsForRange(
      PARAGRAPH,
      wrapStyle,
      0,
      byteLength(PARAGRAPH),
    );
    expect(crossing.length).toBe(wrapped.lines.length);
    for (let i = 1; i < crossing.length; i += 1) {
      expect(crossing[i]!.line).toBe(crossing[i - 1]!.line + 1);
      expect(crossing[i]!.y).toBeGreaterThan(crossing[i - 1]!.y);
    }
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

  // The one check the API most wants: the boxes have to land on the glyphs the
  // renderer drew, not merely be self-consistent. Drawn behind the text, so a
  // frame that is off by a line or a quantised pixel shows as a shifted band.
  test('draws the boxes rectsForRange reported behind the text it measured', async () => {
    const style = { fontSize: 18, fontFamily: FAMILY, width: 170 } as const;
    const boxes = rectsForRange(PARAGRAPH, style, 0, byteLength(PARAGRAPH));
    expect(boxes.length).toBeGreaterThan(1);
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateX: 12 }, { translateY: 26 }]}>
          {boxes.map((box, i) => (
            <Rect
              key={i}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              color="#cfe4ff"
            />
          ))}
          <Text x={0} y={0} text={PARAGRAPH} {...style} color="#111" />
        </Group>
      </Stage>,
    );
    await snapshot('text-range-boxes');
  });

  // #143. The fallback chain is emoji-only by design, so a script needs a face
  // registered for it — which is what the once-per-codepoint warning says. On
  // Android the device ships them, so the tests below register those.
  // One family per script: a family resolves to a single face, so an Arabic and
  // a Hebrew one filed together would leave whichever lost drawing .notdef.
  const RTL_FAMILY = 'Harness Arabic';
  const HEBREW_FAMILY = 'Harness Hebrew';
  let rtlReady = false;
  beforeAll(async () => {
    try {
      await loadFonts({
        [RTL_FAMILY]: ['file:///system/fonts/NotoNaskhArabic-Regular.ttf'],
        [HEBREW_FAMILY]: ['file:///system/fonts/NotoSansHebrew-Regular.ttf'],
      });
      rtlReady = true;
    } catch {
      // A host without those files skips the drawing test below; the ordering
      // tests still run, because .notdef glyphs still carry advances.
      rtlReady = false;
    }
  });

  // The caret API is the probe: on a right-to-left line the leftmost glyph is
  // the last character of the string.
  test('right-to-left text reads right to left', async () => {
    const arabic = 'مرحبا';
    const style = { fontSize: 28, fontFamily: RTL_FAMILY };
    const box = measureText(arabic, style);
    expect(box.width).toBeGreaterThan(0);

    const bytes = byteLength(arabic);
    const left = glyphPositionAtCoordinate(arabic, style, 0, 0);
    const right = glyphPositionAtCoordinate(arabic, style, box.width, 0);
    expect(left.index).toBe(bytes);
    expect(right.index).toBe(0);

    // Latin in the same run still reads the other way, so this is not simply
    // everything coming out reversed.
    const latin = measureText('abcdef', style);
    expect(glyphPositionAtCoordinate('abcdef', style, 0, 0).index).toBe(0);
    expect(
      glyphPositionAtCoordinate('abcdef', style, latin.width, 0).index,
    ).toBe(6);
  });

  test('a mixed-direction line resolves into runs', async () => {
    const mixed = 'ab مرحبا cd';
    const style = { fontSize: 24, fontFamily: RTL_FAMILY };
    const box = measureText(mixed, style);
    expect(box.width).toBeGreaterThan(0);
    // The paragraph starts Latin, so its ends are the string's ends.
    expect(glyphPositionAtCoordinate(mixed, style, 0, 0).index).toBe(0);
    expect(glyphPositionAtCoordinate(mixed, style, box.width, 0).index).toBe(
      byteLength(mixed),
    );
    // But somewhere in the middle the offsets run backwards, which they never
    // would in a line laid out purely left to right.
    let previous = -1;
    let backwards = 0;
    for (let step = 0; step <= 40; step += 1) {
      const at = glyphPositionAtCoordinate(
        mixed,
        style,
        (box.width * step) / 40,
        0,
      );
      if (at.index < previous) {
        backwards += 1;
      }
      previous = at.index;
    }
    expect(backwards).toBeGreaterThan(0);
  });

  // Two scripts, two families — a mixed Latin/Arabic line is not drawn here
  // because one family resolves to one face and the fallback chain is
  // emoji-only, so the Latin would come out .notdef. Its ordering is covered
  // above, where .notdef advances are enough to prove it.
  test('draws Arabic and Hebrew right to left, with joined forms', async () => {
    if (!rtlReady) {
      return;
    }
    await render(
      <Stage>
        <Fill color="white" />
        <Text
          x={8}
          y={36}
          text="مرحبا بالعالم"
          fontSize={26}
          fontFamily={RTL_FAMILY}
          color="#111"
        />
        <Text
          x={8}
          y={80}
          text="שלום עולם"
          fontSize={26}
          fontFamily={HEBREW_FAMILY}
          color="#111"
        />
      </Stage>,
    );
    await snapshot('text-bidi');
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
