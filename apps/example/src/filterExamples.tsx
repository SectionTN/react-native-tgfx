// Colour filters, blend modes and image filters (#134), all built once when the scene compiles.
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Blend,
  BlendColor,
  Blur,
  Canvas,
  Circle,
  ColorMatrix,
  ColorShader,
  DropShadow,
  Fill,
  Image,
  Paint,
  Luma,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  useImage,
  type BlendMode,
} from 'react-native-tgfx';

const sample = require('./assets/sample.png');

const MODES: BlendMode[] = [
  'srcOver',
  'multiply',
  'screen',
  'difference',
  'colorDodge',
  'luminosity',
];

const GREYSCALE = [
  0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0,
  0, 0, 0, 0, 1, 0,
];

const CHANNEL_SWAP = [
  0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
];

const SATURATE = (() => {
  const s = 1.8;
  const [r, g, b] = [0.213, 0.715, 0.072];
  return [
    r + s * (1 - r), g - s * g, b - s * b, 0, 0,
    r - s * r, g + s * (1 - g), b - s * b, 0, 0,
    r - s * r, g - s * g, b + s * (1 - b), 0, 0,
    0, 0, 0, 1, 0,
  ];
})();

/** An amber disc under a blue one, drawn once per blend mode. */
export function BlendModes() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>blendMode — amber disc under blue</RNText>
      <Canvas style={[styles.canvas, { height: 84 }]}>
        <Fill color="#ffffff" />
        {/* Six pairs inside 288pt, so the row still fits the narrowest phone. */}
        {MODES.map((mode, i) => (
          <Circle key={`under-${mode}`} cx={20 + i * 44} cy={42} r={16} color="#f2a33c" />
        ))}
        {MODES.map((mode, i) => (
          <Circle
            key={mode}
            cx={32 + i * 44}
            cy={42}
            r={16}
            color="#4f8ef7"
            blendMode={mode}
          />
        ))}
      </Canvas>
      <RNText style={styles.caption}>{MODES.join(' · ')}</RNText>
    </View>
  );
}

/** The same photo four times: unfiltered, greyscale, swapped, saturated. */
export function ColorMatrices() {
  const img = useImage(sample);
  const box = { y: 0, width: 84, height: 84 };
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<ColorMatrix> — none · greyscale · R↔B · saturate'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 92 }]}>
        <Fill color="#ffffff" />
        {img != null && (
          <>
            <Image image={img} x={4} {...box} fit="cover" />
            <Image image={img} x={92} {...box} fit="cover">
              <ColorMatrix matrix={GREYSCALE} />
            </Image>
            <Image image={img} x={180} {...box} fit="cover">
              <ColorMatrix matrix={CHANNEL_SWAP} />
            </Image>
            <Image image={img} x={268} {...box} fit="cover">
              <ColorMatrix matrix={SATURATE} />
            </Image>
          </>
        )}
      </Canvas>
    </View>
  );
}

/** A white diamond tinted three ways by a constant colour. */
export function BlendColors() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<BlendColor> — src · multiply · screen over white'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 92 }]}>
        <Fill color="#dfe4ec" />
        <Path path="M46 8 L84 46 L46 84 L8 46 Z" color="#ffffff" />
        <Path path="M150 8 L188 46 L150 84 L112 46 Z" color="#ffffff">
          <BlendColor color="#e0533d" mode="src" />
        </Path>
        <Path path="M254 8 L292 46 L254 84 L216 46 Z" color="#8fd0ff">
          <BlendColor color="#e0533d" mode="multiply" />
        </Path>
      </Canvas>
    </View>
  );
}

/** Blur and drop shadow: image filters, so both spread past their geometry. */
export function ImageFilters() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Blur> and <DropShadow> — offscreen filters, bounds grow'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 128 }]}>
        <Fill color="#101725" />
        {/* Glow: a blurred disc under a crisp one. */}
        <Circle cx={60} cy={64} r={26} color="#6aa9ff">
          <Blur blur={12} />
        </Circle>
        <Circle cx={60} cy={64} r={26} color="#dceaff" />
        {/* Directional smear. */}
        <RoundedRect x={116} y={44} width={64} height={40} r={10} color="#f2c088">
          <Blur blurX={14} blurY={0} />
        </RoundedRect>
        {/* Card with a shadow under it. */}
        <RoundedRect x={210} y={38} width={100} height={52} r={14} color="#f5f7fa">
          <DropShadow dx={0} dy={7} blur={7} color="rgba(0,0,0,0.7)" />
        </RoundedRect>
        {/* Shadow only: the caster is dropped. */}
        <Circle cx={340} cy={64} r={22} color="#ffffff">
          <Paint color="#ffffff">
            <DropShadow dx={4} dy={4} blur={4} color="#8fd0ff" shadowOnly />
          </Paint>
        </Circle>
      </Canvas>
    </View>
  );
}

/**
 * A blend mode on the same paint as an image filter. The filter takes an
 * offscreen layer, and the blend composites that layer's filtered result onto
 * the canvas — so the middle disc darkens the amber instead of covering it.
 */
export function BlendWithFilter() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'blendMode + <Blur> on one paint — srcOver · multiply · screen'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 100 }]}>
        <Fill color="#ffffff" />
        {(['srcOver', 'multiply', 'screen'] as BlendMode[]).map((mode, i) => (
          <Circle
            key={`under-${mode}`}
            cx={50 + i * 92}
            cy={50}
            r={30}
            color="#f2a33c"
          />
        ))}
        {(['srcOver', 'multiply', 'screen'] as BlendMode[]).map((mode, i) => (
          <Circle
            key={mode}
            cx={66 + i * 92}
            cy={50}
            r={26}
            color="#4f8ef7"
            blendMode={mode}
          >
            <Blur blur={6} />
          </Circle>
        ))}
      </Canvas>
      <RNText style={styles.caption}>
        A blurred disc that still blends: without the layer fix all three would
        look identical.
      </RNText>
    </View>
  );
}

function Composition() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Blend> shaders · two <Blur> composing'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 120 }]}>
        <Rect x={8} y={10} width={100} height={100}>
          <RadialGradient
            center={{ x: 58, y: 60 }}
            r={54}
            colors={['#4f8ef7', '#f2c94c']}
          />
        </Rect>
        <Rect x={120} y={10} width={100} height={100}>
          <Blend mode="multiply">
            <RadialGradient
              center={{ x: 170, y: 60 }}
              r={54}
              colors={['#4f8ef7', '#f2c94c']}
            />
            <ColorShader color="#ff6b6b" />
          </Blend>
        </Rect>
        <Circle cx={270} cy={60} r={30} color="#4f8ef7">
          <Blur blur={2} />
        </Circle>
        <Circle cx={345} cy={60} r={30} color="#4f8ef7">
          <Blur blur={2} />
          <Blur blur={6} />
        </Circle>
      </Canvas>
      <RNText style={styles.caption}>
        The gradient plain, then multiplied with a colour shader; then one blur,
        then two composing into a softer edge.
      </RNText>
    </View>
  );
}

function LateFilters() {
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<DropShadow> under · inner · <Luma>'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 120 }]}>
        <RoundedRect x={8} y={20} width={90} height={80} r={14} color="#f5f7fa">
          <DropShadow dx={0} dy={5} blur={7} color="rgba(0,0,0,0.55)" />
        </RoundedRect>
        <RoundedRect x={112} y={20} width={90} height={80} r={14} color="#f5f7fa">
          <DropShadow dx={0} dy={5} blur={7} color="rgba(0,0,0,0.55)" inner />
        </RoundedRect>
        <RoundedRect x={214} y={20} width={80} height={80} r={12} color="#1c1c1e" />
        <Circle cx={254} cy={60} r={34} color="#f2a33c" />
        <RoundedRect x={300} y={20} width={80} height={80} r={12} color="#1c1c1e" />
        <Circle cx={340} cy={60} r={34} color="#f2a33c">
          <Luma />
        </Circle>
      </Canvas>
      <RNText style={styles.caption}>
        The same card with the shadow under it, then inside it; then the same
        amber disc plain and through luma, both on a dark backdrop.
      </RNText>
    </View>
  );
}

export function FilterSection() {
  return (
    <>
      <BlendModes />
      <LateFilters />
      <Composition />
      <ColorMatrices />
      <BlendColors />
      <ImageFilters />
      <BlendWithFilter />
    </>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginTop: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  caption: { fontSize: 11, color: '#999', marginTop: 4 },
  canvas: { backgroundColor: '#FFFFFF', borderRadius: 12 },
});
