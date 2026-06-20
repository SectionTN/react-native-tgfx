/**
 * react-native-tgfx example — shapes, strokes, gradients, image and text,
 * all rendered through tgfx via the declarative <Canvas> API.
 */
import { Text as RNText, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Circle,
  Group,
  Image,
  LinearGradient,
  Line,
  Oval,
  Path,
  Paint,
  RadialGradient,
  Rect,
  RoundedRect,
  Text,
  useImage,
} from 'react-native-tgfx';
import { sampleImageBase64 } from './src/sampleImage';
import {
  BarChart,
  CircleField,
  Heart,
  RegularPolygon,
  Spiral,
  Star,
  Wave,
} from './src/customShapes';
import { AnimatedSection } from './src/animatedExamples';

function Demo() {
  const insets = useSafeAreaInsets();
  const img = useImage(sampleImageBase64);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <RNText style={styles.title}>react-native-tgfx</RNText>
      <RNText style={styles.subtitle}>declarative tgfx canvas · Nitro</RNText>

      <Section label="Shapes (fill)">
        <Rect x={0} y={0} width={80} height={56} color="#4F8EF7" />
        <RoundedRect x={96} y={0} width={80} height={56} r={14} color="#34C759" />
        <Circle cx={216} cy={28} r={28} color="#FF9500" />
        <Oval x={256} y={0} width={92} height={56} color="#AF52DE" />
      </Section>

      <Section label="Strokes (cap / join / path)">
        <Circle cx={28} cy={28} r={24} color="#FF3B30" style="stroke" strokeWidth={6} />
        <RoundedRect
          x={72}
          y={2}
          width={84}
          height={52}
          r={12}
          color="#111"
          style="stroke"
          strokeWidth={4}
        />
        <Line
          x1={176}
          y1={6}
          x2={250}
          y2={52}
          color="#1C1C1E"
          style="stroke"
          strokeWidth={8}
          strokeCap="round"
        />
        <Path
          path="M262 50 q24 -52 48 0 t48 0"
          color="#5856D6"
          style="stroke"
          strokeWidth={5}
          strokeJoin="round"
        />
      </Section>

      <Section label="Gradients">
        <RoundedRect x={0} y={0} width={170} height={64} r={16}>
          <LinearGradient
            start={{ x: 0, y: 0 }}
            end={{ x: 170, y: 64 }}
            colors={['#FF6CAB', '#7366FF']}
          />
        </RoundedRect>
        <Circle cx={250} cy={32} r={32}>
          <RadialGradient center={{ x: 250, y: 32 }} r={32} colors={['#FFE259', '#FFA751']} />
        </Circle>
        <Group transform={[{ translateX: 300 }]}>
          <Rect x={0} y={0} width={56} height={64}>
            <Paint>
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 64 }}
                colors={['#11998e', '#38ef7d']}
              />
            </Paint>
          </Rect>
        </Group>
      </Section>

      <Section label="Image (fit: cover / contain)">
        {img != null && <Image x={0} y={0} width={88} height={88} image={img} fit="cover" />}
        {img != null && <Image x={104} y={0} width={88} height={88} image={img} fit="contain" />}
        {img != null && (
          <Group transform={[{ translateX: 208 }, { rotate: '8deg' }]}>
            <Image x={0} y={0} width={88} height={88} image={img} fit="cover" />
          </Group>
        )}
      </Section>

      <Section label="Text">
        <Text x={0} y={26} text="Shapes · Strokes · Image · Text" fontSize={20} color="#111" />
        <Text x={0} y={56} text="rendered through tgfx + Nitro" fontSize={16} color="#888" />
        <Group transform={[{ translateX: 0 }, { translateY: 72 }]}>
          <Text x={0} y={20} text="GPU 2D · Metal / OpenGL" fontSize={15} color="#4F8EF7" />
        </Group>
      </Section>

      <Section label="Custom shapes (composed from primitives)" height={150}>
        <Star cx={42} cy={74} outerR={36} points={5} color="#FF9500" />
        <Star
          cx={124}
          cy={74}
          outerR={34}
          innerR={22}
          points={6}
          color="#FF3B30"
          style="stroke"
          strokeWidth={3}
          strokeJoin="round"
        />
        <RegularPolygon cx={206} cy={74} r={36} sides={6} color="#34C759" />
        <RegularPolygon
          cx={282}
          cy={74}
          r={36}
          sides={3}
          color="#5856D6"
          style="stroke"
          strokeWidth={3}
          strokeJoin="round"
        />
        <Heart cx={344} cy={70} size={42} color="#FF2D55" />
      </Section>

      <Section label="Procedural / generative (hsl palettes)" height={220}>
        <Spiral cx={80} cy={102} count={120} spacing={7} dotR={3.5} />
        <CircleField x={175} y={16} cols={5} rows={6} cell={28} />
        <Wave x={8} y={200} width={345} amplitude={12} wavelength={80} color="#0A84FF" strokeWidth={3} />
      </Section>

      <Section label="Bar chart from data" height={140}>
        <BarChart
          x={8}
          y={10}
          width={350}
          height={118}
          data={[12, 28, 18, 40, 33, 52, 22, 36, 47, 30]}
        />
      </Section>

      <View style={styles.section}>
        <RNText style={styles.sectionLabel}>
          Animated · Reanimated UI-thread driver (zero JS / frame)
        </RNText>
        <AnimatedSection />
      </View>
    </ScrollView>
  );
}

function Section({
  label,
  children,
  height = 100,
}: {
  label: string;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <View style={styles.section}>
      <RNText style={styles.sectionLabel}>{label}</RNText>
      <Canvas style={[styles.canvas, { height }]}>{children}</Canvas>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Demo />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F2F2F7' },
  title: { fontSize: 28, fontWeight: '700', color: '#111', paddingHorizontal: 16 },
  subtitle: { fontSize: 14, color: '#888', paddingHorizontal: 16, marginBottom: 8 },
  section: { paddingHorizontal: 16, marginTop: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  canvas: {
    height: 100,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
});
