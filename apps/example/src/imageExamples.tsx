// Everything <Image> and <ImageShader> can do. Every source is a require()d asset, decoded natively.
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Circle,
  Fill,
  Image,
  ImageShader,
  Paint,
  Path,
  RoundedRect,
  Text,
  useImage,
  type Fit,
} from 'react-native-tgfx';

const sample = require('./assets/sample.png');
const jpeg = require('./assets/sample.jpg');
const webp = require('./assets/sample.webp');
const sprites = require('./assets/sprites.png');
const tile = require('./assets/tile.png');
// Stored 240x120 landscape, with an EXIF marker saying "rotate 90 CW".
const portrait = require('./assets/portrait-exif.jpg');

const FITS: Fit[] = [
  'contain',
  'cover',
  'fill',
  'fitWidth',
  'fitHeight',
  'none',
  'scaleDown',
];

const CELL = 84;
const GAP = 8;

/** One box per fit mode, all drawing the same 128x128 source into 84x60. */
export function FitModes() {
  const img = useImage(sample);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>{'<Image fit> — the full Skia set'}</RNText>
      <Canvas style={[styles.canvas, { height: 160 }]}>
        <Fill color="#f2f2f7" />
        {img != null &&
          FITS.map((fit, i) => {
            const x = (i % 4) * (CELL + GAP);
            const y = Math.floor(i / 4) * 76;
            return (
              <Image
                key={fit}
                x={x}
                y={y}
                width={CELL}
                height={60}
                image={img}
                fit={fit}
              />
            );
          })}
        {FITS.map((fit, i) => (
          <Text
            key={`${fit}-label`}
            x={(i % 4) * (CELL + GAP) + 2}
            y={Math.floor(i / 4) * 76 + 72}
            text={fit}
            fontSize={11}
            color="#3a3a3c"
          />
        ))}
      </Canvas>
    </View>
  );
}

/** The same photo at 1/8 scale, sampled three ways. */
export function SamplingModes() {
  const img = useImage(sample);
  const modes = ['nearest', 'linear', 'mipmap'] as const;
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Image sampling> — 128px source into a 36px box'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 76 }]}>
        <Fill color="#f2f2f7" />
        {img != null &&
          modes.map((sampling, i) => (
            <Image
              key={sampling}
              x={i * 120}
              y={4}
              width={36}
              height={36}
              image={img}
              fit="contain"
              sampling={sampling}
            />
          ))}
        {modes.map((sampling, i) => (
          <Text
            key={`${sampling}-label`}
            x={i * 120}
            y={62}
            text={sampling}
            fontSize={12}
            color="#3a3a3c"
          />
        ))}
      </Canvas>
    </View>
  );
}

/** Four sprites out of one 128x32 sheet, no slicing in JS. */
export function SpriteSheet() {
  const sheet = useImage(sprites);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Image rect> — one 128x32 sheet, four sprites'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 72 }]}>
        <Fill color="#f2f2f7" />
        {sheet != null &&
          [0, 1, 2, 3].map(i => (
            <Image
              key={i}
              x={i * 68}
              y={4}
              width={60}
              height={60}
              image={sheet}
              fit="contain"
              sampling="nearest"
              rect={{ x: i * 32, y: 0, width: 32, height: 32 }}
            />
          ))}
      </Canvas>
    </View>
  );
}

/** The image as a paint source: tiled fills, and a masked shape. */
export function ImageShaderExamples() {
  const pattern = useImage(tile);
  const photo = useImage(sample);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<ImageShader> — clamp / repeat / mirror, and as a shape fill'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 210 }]}>
        <Fill color="#f2f2f7" />
        {pattern != null && (
          <>
            <RoundedRect x={0} y={0} width={112} height={92} r={10}>
              <ImageShader image={pattern} tx="clamp" ty="clamp" />
            </RoundedRect>
            <RoundedRect x={120} y={0} width={112} height={92} r={10}>
              <ImageShader image={pattern} tx="repeat" ty="repeat" />
            </RoundedRect>
            <RoundedRect x={240} y={0} width={112} height={92} r={10}>
              <ImageShader image={pattern} tx="mirror" ty="mirror" />
            </RoundedRect>
          </>
        )}
        {pattern != null && (
          <>
            <Text x={0} y={106} text="clamp" fontSize={11} color="#3a3a3c" />
            <Text x={120} y={106} text="repeat" fontSize={11} color="#3a3a3c" />
            <Text x={240} y={106} text="mirror" fontSize={11} color="#3a3a3c" />
          </>
        )}
        {photo != null && (
          <>
            {/* An image as the fill of an arbitrary shape — impossible before. */}
            <Circle cx={56} cy={168} r={38}>
              <ImageShader
                image={photo}
                rect={{ x: 18, y: 130, width: 76, height: 76 }}
                fit="cover"
              />
            </Circle>
            <Path path="M150 206 L192 122 L234 206 Z">
              <Paint>
                <ImageShader
                  image={photo}
                  rect={{ x: 150, y: 122, width: 84, height: 84 }}
                  fit="cover"
                />
              </Paint>
            </Path>
            <Text
              x={252}
              y={160}
              text="image-filled"
              fontSize={12}
              color="#3a3a3c"
            />
            <Text x={252} y={176} text="shapes" fontSize={12} color="#3a3a3c" />
          </>
        )}
      </Canvas>
    </View>
  );
}

/** The same picture as PNG, JPEG and WebP — a blank cell means that decoder is dead. */
export function CodecFormats() {
  const png = useImage(sample);
  const jpg = useImage(jpeg);
  const wbp = useImage(webp);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Image> — png · jpeg · webp all decode'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 96 }]}>
        <Fill color="#f2f2f7" />
        {[png, jpg, wbp].map(
          (img, i) =>
            img != null && (
              <Image
                key={i}
                x={i * (CELL + GAP)}
                y={0}
                width={CELL}
                height={72}
                image={img}
                fit="contain"
              />
            ),
        )}
        {['png', 'jpeg', 'webp'].map((name, i) => (
          <Text
            key={name}
            x={i * (CELL + GAP) + 2}
            y={90}
            text={name}
            fontSize={11}
            color="#3a3a3c"
          />
        ))}
      </Canvas>
    </View>
  );
}

/**
 * A photo shot in portrait: the pixels are landscape and the EXIF marker says to
 * turn them, so the drawn box is taller than it is wide. Android decodes it with
 * tgfx's own JPEG codec, which reads that marker; through BitmapFactory without
 * androidx.exifinterface it drew on its side.
 */
export function ExifOrientation() {
  const photo = useImage(portrait);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Image> — EXIF orientation (stored landscape, drawn portrait)'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 130 }]}>
        <Fill color="#f2f2f7" />
        {photo != null && (
          <Image
            x={0}
            y={0}
            width={CELL}
            height={120}
            image={photo}
            fit="contain"
          />
        )}
        <Text
          x={CELL + GAP}
          y={20}
          text={photo != null ? `${photo.width}x${photo.height}` : 'loading'}
          fontSize={13}
          color="#3a3a3c"
        />
        <Text
          x={CELL + GAP}
          y={40}
          text="upright means EXIF was applied"
          fontSize={12}
          color="#8e8e93"
        />
      </Canvas>
    </View>
  );
}

export function ImageSection() {
  return (
    <>
      <FitModes />
      <CodecFormats />
      <ExifOrientation />
      <SamplingModes />
      <SpriteSheet />
      <ImageShaderExamples />
    </>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  label: { fontSize: 13, fontWeight: '600', color: '#3a3a3c', marginBottom: 6 },
  canvas: { width: '100%', backgroundColor: 'transparent' },
});
