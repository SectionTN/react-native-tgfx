/**
 * Everything <Text> gained: a bundled family in regular/bold/italic, a wrapped
 * and aligned paragraph, measurement, gradient-filled text, text on a path, and
 * the two scripts that are honest about their limits (emoji, RTL).
 */
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Fill,
  LinearGradient,
  Paint,
  Rect,
  Text,
  TextPath,
  measureText,
  useFonts,
} from 'react-native-tgfx';

const FAMILY = 'PT Serif';

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

  // measureText runs the same layout the renderer does, so the box behind the
  // label is exactly the label's box rather than a guess.
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
