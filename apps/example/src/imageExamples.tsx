// Everything <Image> and <ImageShader> can do. Every source is a require()d asset, decoded natively.
import { useEffect, useMemo, useState } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Circle,
  ColorMatrix,
  Fill,
  Group,
  Atlas,
  Image,
  ImageShader,
  Vertices,
  renderToImage,
  Paint,
  Path,
  RoundedRect,
  Text,
  useImage,
  type Fit,
  type TgfxImage,
} from 'react-native-tgfx';

const sample = require('./assets/sample.png');
const jpeg = require('./assets/sample.jpg');
const webp = require('./assets/sample.webp');
const sprites = require('./assets/sprites.png');
const tile = require('./assets/tile.png');
const logo = require('./assets/logo.svg');
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

/** The same sheet again, but 120 sprites from one node instead of 120 nodes. */
export function AtlasField() {
  const sheet = useImage(sprites);
  const field = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const angle = i * 0.7;
        const radius = 4 + i * 1.1;
        return {
          rect: { x: (i % 4) * 32, y: 0, width: 32, height: 32 },
          x: 180 + Math.cos(angle) * radius,
          y: 70 + Math.sin(angle) * radius * 0.5,
          scale: 0.3 + (i % 5) * 0.12,
        };
      }),
    []
  );
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Atlas> — 120 sprites, one node'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 140 }]}>
        <Fill color="#f2f2f7" />
        {sheet != null && (
          <Atlas image={sheet} sprites={field} sampling="nearest" />
        )}
      </Canvas>
    </View>
  );
}

/** Below the shape level: a colour mesh, and the same mesh warping an image. */
export function VerticesMeshes() {
  const photo = useImage(sample);
  const grid = useMemo(() => {
    const size = 3;
    const step = 110 / size;
    const points: { x: number; y: number }[] = [];
    const coords: { x: number; y: number }[] = [];
    const hues = ['#f2a33c', '#4f8ef7', '#34c759', '#ff2d55'];
    const colors: string[] = [];
    for (let row = 0; row <= size; row++) {
      for (let col = 0; col <= size; col++) {
        // A sine bulge along the rows, so the warp is visible in both panels.
        const wobble = Math.sin((col / size) * Math.PI) * 12;
        points.push({ x: 8 + col * step, y: 8 + row * step + wobble });
        coords.push({ x: (col / size) * 128, y: (row / size) * 128 });
        colors.push(hues[(row + col) % hues.length]!);
      }
    }
    const indices: number[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const at = row * (size + 1) + col;
        indices.push(at, at + 1, at + size + 1, at + 1, at + size + 1, at + size + 2);
      }
    }
    return { points, coords, colors, indices };
  }, []);

  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Vertices> — colour mesh, then the same mesh warping an image'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 140 }]}>
        <Fill color="#f2f2f7" />
        <Vertices
          vertices={grid.points}
          colors={grid.colors}
          indices={grid.indices}
        />
        {photo != null && (
          <Group transform={[{ translateX: 130 }]}>
            <Vertices
              vertices={grid.points}
              textures={grid.coords}
              indices={grid.indices}
            >
              <ImageShader image={photo} />
            </Vertices>
          </Group>
        )}
      </Canvas>
    </View>
  );
}

/** A scene rendered with no <Canvas> mounted, then drawn as an ordinary image. */
export function OffscreenRender() {
  const [made, setMade] = useState<TgfxImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    renderToImage(
      <>
        <Fill color="#101725" />
        {[0, 1, 2, 3, 4].map(i => (
          <Circle
            key={i}
            cx={24 + i * 32}
            cy={64 - i * 8}
            r={18}
            color={`hsl(${i * 48}, 80%, 60%)`}
          />
        ))}
      </>,
      { width: 160, height: 100, pixelRatio: 2 }
    )
      .then(image => {
        if (live) {
          setMade(image);
        }
      })
      .catch(e => live && setError(String(e)));
    return () => {
      live = false;
      setMade(image => {
        image?.dispose();
        return null;
      });
    };
  }, []);

  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'renderToImage — drawn with no <Canvas> mounted'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 120 }]}>
        <Fill color="#f2f2f7" />
        {made != null && (
          <>
            <Image image={made} x={8} y={10} width={160} height={100} />
            {/* The same handle again, so it is a real image and not a one-shot. */}
            <Image image={made} x={184} y={10} width={80} height={50} />
            <Image image={made} x={184} y={64} width={80} height={50}>
              <ColorMatrix matrix={GREY} />
            </Image>
          </>
        )}
      </Canvas>
      <RNText style={styles.caption}>
        {error ?? 'One offscreen render, drawn three times.'}
      </RNText>
    </View>
  );
}

const GREY = [
  0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0,
  0, 0, 0, 0, 1, 0,
];

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

/**
 * An SVG document through the ordinary `useImage`. The file declares 24x24 over a
 * 0 0 48 48 viewBox, so the handle reports 24x24 — yet the 120px draw is as crisp
 * as the 24px one, because the picture is replayed at draw size, not resampled.
 */
export function SvgSources() {
  const svg = useImage(logo);
  return (
    <View style={styles.section}>
      <RNText style={styles.label}>
        {'<Image> — one SVG handle, drawn 1x and 5x'}
      </RNText>
      <Canvas style={[styles.canvas, { height: 148 }]}>
        <Fill color="#f2f2f7" />
        {svg != null && (
          <>
            <Image x={0} y={0} width={120} height={120} image={svg} />
            <Image x={132} y={48} width={24} height={24} image={svg} />
            <Text
              x={168}
              y={62}
              text={`handle ${svg.width}x${svg.height}`}
              fontSize={13}
              color="#3a3a3c"
            />
            <Text
              x={168}
              y={82}
              text="crisp at 120 all the same"
              fontSize={12}
              color="#8e8e93"
            />
          </>
        )}
        <Text x={0} y={140} text="drawn 120" fontSize={12} color="#8e8e93" />
        <Text x={132} y={140} text="drawn 24" fontSize={12} color="#8e8e93" />
      </Canvas>
    </View>
  );
}

export function ImageSection() {
  return (
    <>
      <FitModes />
      <CodecFormats />
      <SvgSources />
      <ExifOrientation />
      <SamplingModes />
      <SpriteSheet />
      <AtlasField />
      <VerticesMeshes />
      <OffscreenRender />
      <ImageShaderExamples />
    </>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 10 },
  label: { fontSize: 13, fontWeight: '600', color: '#3a3a3c', marginBottom: 6 },
  canvas: { width: '100%', backgroundColor: 'transparent' },
  caption: { fontSize: 11, color: '#8e8e93', marginTop: 4 },
});
