// Everything <Text> gained: families, wrapping, measurement, gradients, text on a path, RTL.
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Fill,
  Glyphs,
  Group,
  Path,
  LinearGradient,
  Paint,
  Rect,
  Span,
  Text,
  TextPath,
  glyphIds,
  measureText,
  textPath,
  useFonts,
} from 'react-native-tgfx';

const FAMILY = 'PT Serif';

const RULED_TEXT =
  'measureText reports every line it laid out: width, x, baseline.';

const PARAGRAPH =
  'A paragraph that wraps inside an explicit width, breaks at word boundaries, and stacks on its own line height.';

export function TextSection() {
  const ready = useFonts({
    [FAMILY]: [
      require('./assets/fonts/PT_Serif-Web-Regular.ttf'),
      require('./assets/fonts/PT_Serif-Web-Bold.ttf'),
      require('./assets/fonts/PT_Serif-Web-Italic.ttf'),
    ],
  });

  const label = 'measured';
  const box = measureText(label, { fontSize: 22, fontFamily: FAMILY, fontWeight: 'bold' });

  return (
    <>
      <Panel label={`Bundled font · ${FAMILY} (${ready ? 'loaded' : 'loading'})`} height={130}>
        <Text x={0} y={28} text="Regular 400" fontSize={24} fontFamily={FAMILY} color="#111" />
        <Text
          x={0}
          y={62}
          text="Bold 700"
          fontSize={24}
          fontFamily={FAMILY}
          fontWeight="bold"
          color="#111"
        />
        <Text
          x={150}
          y={28}
          text="Italic"
          fontSize={24}
          fontFamily={FAMILY}
          fontStyle="italic"
          color="#111"
        />
        <Text
          x={150}
          y={62}
          text="Faux 900"
          fontSize={24}
          fontFamily={FAMILY}
          fontWeight={900}
          color="#111"
        />
        <Text
          x={0}
          y={100}
          text="letterspaced"
          fontSize={20}
          fontFamily={FAMILY}
          letterSpacing={4}
          color="#8E8E93"
        />
      </Panel>

      <Panel label="Paragraph · wrap + align + line height" height={230}>
        <Text
          x={0}
          y={16}
          text={PARAGRAPH}
          width={170}
          fontSize={13}
          lineHeight={17}
          fontFamily={FAMILY}
          color="#111"
        />
        <Text
          x={182}
          y={16}
          text={PARAGRAPH}
          width={170}
          textAlign="right"
          fontSize={13}
          lineHeight={17}
          fontFamily={FAMILY}
          color="#111"
        />
        <Text
          x={0}
          y={172}
          text={PARAGRAPH}
          width={170}
          textAlign="center"
          maxLines={2}
          ellipsis="…"
          fontSize={13}
          lineHeight={17}
          fontFamily={FAMILY}
          color="#5856D6"
        />
        <Text
          x={182}
          y={172}
          text={'explicit\nline\nbreaks'}
          fontSize={13}
          lineHeight={17}
          fontFamily={FAMILY}
          color="#34C759"
        />
      </Panel>

      <Panel label="measureText · gradient fill · text on a path" height={190}>
        {/* The rect is sized from the measurement, not from a magic number. */}
        <Rect
          x={0}
          y={30 + box.ascent}
          width={box.width}
          height={box.height}
          color="#FFD60A"
        />
        <Text
          x={0}
          y={30}
          text={label}
          fontSize={22}
          fontWeight="bold"
          fontFamily={FAMILY}
          color="#111"
        />
        <Text x={0} y={70} text="gradient filled" fontSize={28} fontFamily={FAMILY}>
          <Paint>
            <LinearGradient
              start={{ x: 0, y: 50 }}
              end={{ x: 240, y: 80 }}
              colors={['#FF6CAB', '#7366FF']}
            />
          </Paint>
        </Text>
        <TextPath
          path="M8 170 q90 -70 170 0 t160 -6"
          text="text bent along an SVG path"
          fontSize={16}
          fontFamily={FAMILY}
          color="#0A84FF"
        />
      </Panel>

      <Panel label="Styled runs · <Span> inside one paragraph" height={210}>
        {/* One paragraph: the spans wrap together and the line takes its height
            from the tallest one on it. */}
        <Text x={0} y={30} width={340} fontSize={18} fontFamily={FAMILY} color="#1c1c1e">
          <Span text="Total " />
          <Span text="4 500" fontWeight="bold" color="#d98a4a" fontSize={26} />
          <Span text=" credits, and a long tail that has to wrap onto the next line with " />
          <Span text="one italic run" fontStyle="italic" color="#0A84FF" />
          <Span text=" inside it." />
        </Text>

        {/* Per-line metrics, under a paragraph measureText can describe exactly:
            it takes a string, so a paragraph built from spans is not the thing
            being measured here. */}
        <Text
          x={0}
          y={150}
          width={340}
          fontSize={15}
          fontFamily={FAMILY}
          color="#8e8e93"
          text={RULED_TEXT}
        />
        {measureText(RULED_TEXT, {
          fontSize: 15,
          fontFamily: FAMILY,
          width: 340,
        }).lines.map((line, i) => (
          <Rect
            key={i}
            x={line.x}
            y={150 + line.baseline + line.descent + 1}
            width={line.width}
            height={1}
            color="#d98a4a"
          />
        ))}
      </Panel>

      <Panel label="textPath() · the same layout, stroked as a <Path>" height={110}>
        {/* SVG path data from the text layout, so it takes a stroke like any
            other path. Relative to the first baseline, hence the translate. */}
        <Group transform={[{ translateX: 0 }, { translateY: 60 }]}>
          <Path
            path={textPath('outlined', {
              fontSize: 44,
              fontFamily: FAMILY,
              fontWeight: 'bold',
            })}
            color="#d98a4a"
            style="stroke"
            strokeWidth={1.5}
            strokeJoin="round"
          />
        </Group>
      </Panel>

      <Panel label="<Glyphs> · ids placed by the caller, not by a layout" height={110}>
        {/* glyphIds gives the ids for this face; where they go is entirely ours,
            so the same string can ride a curve nothing in <Text> would produce. */}
        <Glyphs
          x={8}
          y={62}
          fontSize={34}
          fontFamily={FAMILY}
          color="#5856D6"
          glyphs={glyphIds('placed by hand', {
            fontSize: 34,
            fontFamily: FAMILY,
          }).map((id, i) => ({
            id,
            x: i * 17,
            y: Math.sin(i / 1.6) * 12,
          }))}
        />
      </Panel>

      <Panel label="Emoji fallback · RTL (see the PR: RTL is unshaped)" height={110}>
        <Text x={0} y={34} text="emoji 😀🎨🚀 fallback" fontSize={24} color="#111" />
        <Text x={0} y={76} text="مرحبا بالعالم" fontSize={24} color="#111" />
      </Panel>
    </>
  );
}

function Panel({
  label,
  children,
  height,
}: {
  label: string;
  children: React.ReactNode;
  height: number;
}) {
  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>{label}</RNText>
      <Canvas style={[styles.canvas, { height }]}>
        {/* Android composites the canvas as its own layer, so the view's own
            background does not show through. Paint one. */}
        <Fill color="#fff" />
        {children}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  canvas: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
});
