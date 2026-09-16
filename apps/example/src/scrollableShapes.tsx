// Port of Enzo Mangano's "scrollable shapes" Skia demo with logos and a photo
// for shapes: 20k points morph Margelo → Callstack → Margelo × Callstack →
// the handshake photo (a halftone) as an invisible paged ScrollView drives them.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Atlas,
  Blur,
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  renderToImage,
  SPRITE_FLOATS,
  spriteFloats,
  useImage,
  useOffscreenImage,
  useSpriteBuffer,
} from 'react-native-tgfx';
import { CALLSTACK, CALLSTACK_BOX, MARGELO, MARGELO_BOX } from './brandLogos';

const N = 20000;
// x, y, z, dot size per point.
const STRIDE = 4;
const PAGES = 4;
const MAX_W = 330;
const TARGET_HEIGHT = 330;
const DISTANCE = 600;
const TILT_COS = Math.cos(0.2);
const TILT_SIN = Math.sin(0.2);
// Flat pages swing instead of spinning: a mark edge-on is unreadable.
const SWING = 0.5;
const DEPTH = 12;
// The original's paint gradient, baked to a strip each dot samples by screen position.
const STRIP = 256;
// Offscreen raster each logo page is sampled from.
const RW = 480;
const RH = 240;

type Box = { w: number; h: number };

const fitted = (
  path: string,
  box: Box,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const s = Math.min(w / box.w, h / box.h);
  return (
    <Group
      transform={[
        { translateX: x + (w - box.w * s) / 2 },
        { translateY: y + (h - box.h * s) / 2 },
        { scale: s },
      ]}
    >
      <Path path={path} color="#000" />
    </Group>
  );
};

const cross = (cx: number, cy: number, r: number) => (
  <Group>
    <Line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} color="#000" strokeWidth={r * 0.55} strokeCap="round" />
    <Line x1={cx + r} y1={cy - r} x2={cx - r} y2={cy + r} color="#000" strokeWidth={r * 0.55} strokeCap="round" />
  </Group>
);

const LOGO_SCENES = [
  fitted(MARGELO, MARGELO_BOX, 0, 0, RW, RH),
  fitted(CALLSTACK, CALLSTACK_BOX, 0, 0, RW, RH),
  <Group>
    {fitted(MARGELO, MARGELO_BOX, 0, RH * 0.2, RW * 0.26, RH * 0.6)}
    {cross(RW * 0.33, RH * 0.5, RH * 0.07)}
    {fitted(CALLSTACK, CALLSTACK_BOX, RW * 0.4, 0, RW * 0.6, RH)}
  </Group>,
];

// A logo is its alpha.
const alphaWeights = (px: Uint8Array): Float32Array => {
  const out = new Float32Array(px.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = px[i * 4 + 3]! > 127 ? 1 : 0;
  }
  return out;
};

// A photo is a halftone: one dot per grid cell over the whole picture, sized
// by the cell's darkness. The cell is box-filtered so the blinds do not alias.
const halftone = (px: Uint8Array, w: number, h: number): Float32Array => {
  const cols = Math.floor(Math.sqrt((N * w) / h));
  const rows = Math.floor(N / cols);
  const cw = w / cols;
  const ch = h / rows;
  const s = Math.min(MAX_W / w, TARGET_HEIGHT / h);
  const out = new Float32Array(N * STRIDE);
  for (let i = 0; i < N; i++) {
    const cell = i % (cols * rows);
    const col = Math.floor(cell / rows);
    const row = cell % rows;
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(row * ch); y < Math.floor((row + 1) * ch); y++) {
      for (let x = Math.floor(col * cw); x < Math.floor((col + 1) * cw); x++) {
        const q = (y * w + x) * 4;
        sum += 0.299 * px[q]! + 0.587 * px[q + 1]! + 0.114 * px[q + 2]!;
        n++;
      }
    }
    const lum = n > 0 ? sum / (n * 255) : 1;
    const dark = Math.max(0, (0.92 - lum) / 0.92);
    out[i * STRIDE] = ((col + 0.5) * cw - w / 2) * s;
    out[i * STRIDE + 1] = ((row + 0.5) * ch - h / 2) * s;
    out[i * STRIDE + 2] = (Math.random() - 0.5) * DEPTH;
    out[i * STRIDE + 3] = Math.pow(dark, 0.9) * cw * s * 1.15;
  }
  return out;
};

// N weighted samples, sorted left→right so morphs pair nearby points, centred
// and fitted, packed as x,y,z,size.
const cloud = (weights: Float32Array, w: number): Float32Array => {
  const ink: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    if (Math.random() < weights[i]!) {
      ink.push(i);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ink) {
    minX = Math.min(minX, p % w);
    maxX = Math.max(maxX, p % w);
    minY = Math.min(minY, Math.floor(p / w));
    maxY = Math.max(maxY, Math.floor(p / w));
  }
  const s = Math.min(MAX_W / Math.max(1, maxX - minX), TARGET_HEIGHT / Math.max(1, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pts = Array.from({ length: N }, () => ink[Math.floor(Math.random() * ink.length)] ?? 0)
    .sort((a, b) => (a % w) - (b % w));
  const out = new Float32Array(N * STRIDE);
  pts.forEach((p, i) => {
    out[i * STRIDE] = ((p % w) + Math.random() - cx) * s;
    out[i * STRIDE + 1] = (Math.floor(p / w) + Math.random() - cy) * s;
    out[i * STRIDE + 2] = (Math.random() - 0.5) * DEPTH;
    out[i * STRIDE + 3] = 1;
  });
  return out;
};

function Dot({
  index,
  scrollX,
  width,
}: {
  index: number;
  scrollX: SharedValue<number>;
  width: number;
}) {
  const style = useAnimatedStyle(() => {
    const p =
      width > 0
        ? Math.max(0, Math.min(2, (scrollX.value - (index - 1) * width) / width))
        : 0;
    const k = p <= 1 ? p : 2 - p;
    return { width: 6 + 10 * k, opacity: 0.3 + 0.7 * k };
  }, [width, index]);
  return <Animated.View style={[styles.dot, style]} />;
}

export function ScrollableShapesScreen() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [shapes, setShapes] = useState<Float32Array[] | null>(null);
  const photo = useImage(require('./assets/handshake.png'));
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const scrollX = useSharedValue(0);
  const sprites = useSpriteBuffer(N);
  const count = useSharedValue(0);
  // Every dot is the same 1×1 texel of the strip; only its column, size and centre move per frame.
  useEffect(() => {
    for (let i = 0; i < N; i++) {
      sprites.data[i * SPRITE_FLOATS + 2] = 1;
      sprites.data[i * SPRITE_FLOATS + 3] = 1;
    }
  }, [sprites]);
  const strip = useOffscreenImage(
    <Rect x={0} y={0} width={STRIP} height={1}>
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: STRIP, y: 0 }}
        colors={['#00d9ff', '#ffffff', '#ff006e']}
      />
    </Rect>,
    { width: STRIP, height: 1 },
    [],
  );

  useEffect(() => {
    if (!photo) {
      return;
    }
    let live = true;
    (async () => {
      const out: Float32Array[] = [];
      for (const scene of LOGO_SCENES) {
        const image = await renderToImage(scene, { width: RW, height: RH });
        out.push(cloud(alphaWeights(new Uint8Array(await image.encode('raw'))), image.width));
        image.dispose();
      }
      const raw = new Uint8Array(await photo.encode('raw'));
      out.push(halftone(raw, photo.width, photo.height));
      if (live) {
        setShapes(out);
      }
    })();
    return () => {
      live = false;
    };
  }, [photo]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: e => {
      'worklet';
      scrollX.value = e.contentOffset.x;
    },
  });

  useFrameCallback(frame => {
    'worklet';
    const width = vw.value;
    const height = vh.value;
    if (width === 0 || shapes === null) {
      return;
    }
    const t = (frame.timeSinceFirstFrame ?? 0) / 1000;
    const swing = SWING * Math.sin((t * Math.PI * 2) / 6);
    const cosT = Math.cos(swing);
    const sinT = Math.sin(swing);
    const page = Math.max(0, Math.min(PAGES - 1, scrollX.value / width));
    const idx = Math.min(Math.floor(page), PAGES - 2);
    const k = page - idx;
    const a = shapes[idx]!;
    const b = shapes[idx + 1]!;
    const cx = width / 2;
    const cy = height / 2;
    const diag = 1 / (width * width + height * height);
    const f = spriteFloats(sprites);
    for (let i = 0; i < N; i++) {
      const j = i * STRIDE;
      const x = a[j]! + (b[j]! - a[j]!) * k;
      const y = a[j + 1]! + (b[j + 1]! - a[j + 1]!) * k;
      const z = a[j + 2]! + (b[j + 2]! - a[j + 2]!) * k;
      const d = a[j + 3]! + (b[j + 3]! - a[j + 3]!) * k;
      const y1 = y * TILT_COS - z * TILT_SIN;
      const z1 = y * TILT_SIN + z * TILT_COS;
      const x2 = x * cosT + z1 * sinT;
      const z2 = -x * sinT + z1 * cosT;
      const s = DISTANCE / (DISTANCE + z2);
      const sx = cx + x2 * s;
      const sy = cy + y1 * s;
      const g = Math.max(0, Math.min(1, (sx * width + sy * height) * diag));
      const o = i * SPRITE_FLOATS;
      f[o] = Math.floor(g * (STRIP - 1));
      f[o + 4] = d * s;
      f[o + 5] = sx;
      f[o + 6] = sy;
    }
    // ponytail: Reanimated drops same-value writes, so a constant count would never wake the renderer; the fraction truncates natively.
    count.value = N + (frame.timestamp % 1000) * 1e-6;
  });

  const { width, height } = size;
  return (
    <View
      style={styles.root}
      onLayout={e => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize({ width: w, height: h });
        vw.value = w;
        vh.value = h;
      }}
    >
      {width > 0 && (
        <Canvas style={StyleSheet.absoluteFill}>
          <Circle cx={width / 2} cy={height / 2} r={width * 0.6}>
            <RadialGradient
              center={{ x: width / 2, y: height / 2 }}
              r={width * 0.6}
              colors={['#ffffff40', '#ffffff00']}
            />
            <Blur blur={60} />
          </Circle>
          {strip && (
            <Atlas image={strip} buffer={sprites} count={count} sampling="nearest" />
          )}
        </Canvas>
      )}
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={width}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ width: width * PAGES }}
      />
      <View style={styles.dots}>
        {Array.from({ length: PAGES }, (_, i) => (
          <Dot key={i} index={i} scrollX={scrollX} width={width} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 60,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: { height: 6, borderRadius: 3, backgroundColor: '#fff' },
});
