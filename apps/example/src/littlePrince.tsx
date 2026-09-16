// Port of Enzo Mangano's "The Little Prince" Skia demo: a page of text whose
// letters fly into an ink sampling of the illustration, and back.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import {
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Atlas,
  Canvas,
  Fill,
  Group,
  measureText,
  Text,
  useFonts,
  useImage,
  useOffscreenImage,
  useSpriteBuffer,
  type TgfxImage,
} from 'react-native-tgfx';

// The rose and the fox's farewell; '\n' starts an indented paragraph.
const TEXT =
  '“You are beautiful, but you are empty,” he went on. “One could not die ' +
  'for you. To be sure, an ordinary passerby would think that my rose ' +
  'looked just like you—the rose that belongs to me. But in herself alone ' +
  'she is more important than all the hundreds of you other roses: because ' +
  'it is she that I have watered; because it is she that I have put under ' +
  'the glass globe; because it is she that I have sheltered behind the ' +
  'screen; because it is for her that I have killed the caterpillars ' +
  '(except the two or three that we saved to become butterflies); because ' +
  'it is she that I have listened to, when she grumbled, or boasted, or ' +
  'even sometimes when she said nothing. Because she is my rose.”\n' +
  'And he went back to meet the fox.\n' +
  '“Goodbye,” he said.\n' +
  '“Goodbye,” said the fox.\n' +
  '“And now here is my secret, a very simple secret: It is only with the ' +
  'heart that one can see rightly; what is essential is invisible to the ' +
  'eye.”\n' +
  'What is essential is invisible to the eye, the little prince repeated, ' +
  'so that he would be sure to remember.\n' +
  '“It is the time you have wasted for your rose that makes your rose so ' +
  'important.”\n' +
  '“It is the time I have wasted for my rose…” the little prince repeated, ' +
  'so that he would be sure to remember.\n' +
  '“Men have forgotten this truth,” said the fox. “But you must not forget ' +
  'it. You become responsible, forever, for what you have tamed. You are ' +
  'responsible for your rose…”';

const FAMILY = 'Newsreader';
const STYLE = { fontSize: 30, fontFamily: FAMILY };
const PAGE_BG = '#f7f4ec';
const INK = '#1c1a17';
const CELL = 40;
const PAD = 3;
// Glyph sheet rasterised at 2× so a letter scaled down to the page stays crisp.
const PR = 2;
const PAGE_SCALE = 0.48;
const PICTURE_SCALE = 0.44;
const MARGIN = 0.09;
const MIN_SPACING = 0.014;
const MAX_TRIES = 800;
const PRUNE_RADIUS = 3.2;
const PRUNE_MIN = 6;
const BOX_W = 0.9;
const BOX_H = 0.7;
const STAGGER = 0.55;
const JITTER = 0.15;
const DURATION = 2000;
const CAMERA_Z = 820;
const Z_BASE = 85;
const Z_MOVE = 290;
const FADE = 0.42;
const INK_FLOOR = 0.18;
const SAT_WEIGHT = 0.45;
const GAMMA = 1.4;

const CHARS = [...new Set([...TEXT].filter(c => c !== ' ' && c !== '\n'))];
const INDEX = new Map(CHARS.map((c, i) => [c, i]));
const COLS = Math.ceil(Math.sqrt(CHARS.length));
const ROWS = Math.ceil(CHARS.length / COLS);

type Layout = { xy: Float32Array; cell: Float32Array };
type Targets = { pic: Float32Array; delays: Float32Array };

// Word-wrapped page with a first-line indent: one glyph-cell centre per letter.
function buildLayout(W: number, H: number): Layout {
  const ds = PAGE_SCALE;
  const advance = CHARS.map(
    c => (measureText(c, STYLE).width || STYLE.fontSize * 0.5) * ds,
  );
  const spaceW =
    (measureText('a a', STYLE).width - measureText('aa', STYLE).width) * ds;
  const half = (CELL / 2) * ds;
  const padX = PAD * ds;
  const marginX = W * MARGIN;
  const marginY = H * 0.13;
  const right = W - marginX;
  const bottom = H - marginY;
  const lineHeight = STYLE.fontSize * ds * 1.55;
  const adv = (ch: string) => advance[INDEX.get(ch) ?? -1] ?? 0;
  const xy: number[] = [];
  const cell: number[] = [];
  const done = () => ({
    xy: Float32Array.from(xy),
    cell: Float32Array.from(cell),
  });
  let y = marginY;
  for (const para of TEXT.split('\n')) {
    let x = marginX + spaceW * 3;
    for (const word of para.trim().split(/\s+/)) {
      let wordW = 0;
      for (const ch of word) {
        wordW += adv(ch);
      }
      if (x + wordW > right && x > marginX) {
        x = marginX;
        y += lineHeight;
        if (y > bottom) {
          return done();
        }
      }
      for (const ch of word) {
        const idx = INDEX.get(ch);
        if (idx === undefined) {
          continue;
        }
        xy.push(x - padX + half, y + half);
        cell.push(idx);
        x += advance[idx]!;
      }
      x += spaceW;
    }
    y += lineHeight;
    if (y > bottom) {
      break;
    }
  }
  return done();
}

// Poisson-disk sample the ink, prune strays, fit the content into a centred
// box, then pair letters to targets by angle around each centroid.
function computeTargets(
  xy: Float32Array,
  px: Uint8Array,
  w: number,
  h: number,
  W: number,
  H: number,
): Targets {
  const n = xy.length / 2;
  const stride = px.length / h;
  const ink = (x: number, y: number) => {
    const p = y * stride + x * 4;
    const a = px[p + 3]! / 255;
    const r = (px[p]! / 255) * a + 1 - a;
    const g = (px[p + 1]! / 255) * a + 1 - a;
    const b = (px[p + 2]! / 255) * a + 1 - a;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    const sat = mx <= 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
    const t = (Math.max(1 - lum, sat * SAT_WEIGHT) - INK_FLOOR) / (1 - INK_FLOOR);
    return Math.pow(Math.max(0, Math.min(1, t)), GAMMA);
  };

  const minD = Math.max(w, h) * MIN_SPACING;
  const gh = Math.ceil(h / minD) + 1;
  const grid = new Map<number, number[]>();
  const tooClose = (x: number, y: number) => {
    const gx = Math.floor(x / minD);
    const gy = Math.floor(y / minD);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iy = gy - 1; iy <= gy + 1; iy++) {
        const bucket = grid.get(ix * gh + iy);
        if (!bucket) {
          continue;
        }
        for (let k = 0; k < bucket.length; k += 2) {
          const dx = bucket[k]! - x;
          const dy = bucket[k + 1]! - y;
          if (dx * dx + dy * dy < minD * minD) {
            return true;
          }
        }
      }
    }
    return false;
  };
  let pts: number[] = [];
  for (let tries = 0; pts.length < n * 2 && tries < n * MAX_TRIES; tries++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (Math.random() < ink(x, y) && !tooClose(x, y)) {
      const key = Math.floor(x / minD) * gh + Math.floor(y / minD);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(x, y);
      } else {
        grid.set(key, [x, y]);
      }
      pts.push(x, y);
    }
  }
  for (let tries = 0; pts.length < n * 2 && tries < n * MAX_TRIES; tries++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (Math.random() < ink(x, y)) {
      pts.push(x, y);
    }
  }

  // ponytail: O(n²) stray prune over ~1k points; grid it if the paragraph grows.
  const r2 = (minD * PRUNE_RADIUS) ** 2;
  const m = pts.length / 2;
  const keep: number[] = [];
  for (let i = 0; i < m; i++) {
    let near = 0;
    for (let j = 0; j < m && near < PRUNE_MIN; j++) {
      const dx = pts[j * 2]! - pts[i * 2]!;
      const dy = pts[j * 2 + 1]! - pts[i * 2 + 1]!;
      if (j !== i && dx * dx + dy * dy < r2) {
        near++;
      }
    }
    if (near >= PRUNE_MIN) {
      keep.push(pts[i * 2]!, pts[i * 2 + 1]!);
    }
  }
  if (keep.length > 16) {
    const dense = keep.length / 2;
    while (keep.length < pts.length) {
      const s = Math.floor(Math.random() * dense) * 2;
      keep.push(
        keep[s]! + (Math.random() - 0.5) * minD,
        keep[s + 1]! + (Math.random() - 0.5) * minD,
      );
    }
    pts = keep;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]!);
    maxX = Math.max(maxX, pts[i]!);
    minY = Math.min(minY, pts[i + 1]!);
    maxY = Math.max(maxY, pts[i + 1]!);
  }
  if (pts.length === 0) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const cw = Math.max(1, maxX - minX);
  const ch = Math.max(1, maxY - minY);
  const areaW = Math.min(W * BOX_W, H * BOX_H * (cw / ch));
  const areaH = areaW / (cw / ch);
  const ox = (W - areaW) / 2;
  const oy = (H - areaH) / 2;
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    if (i * 2 < pts.length) {
      samples[i * 2] = ox + ((pts[i * 2]! - minX) / cw) * areaW;
      samples[i * 2 + 1] = oy + ((pts[i * 2 + 1]! - minY) / ch) * areaH;
    } else {
      samples[i * 2] = ox + areaW * (0.4 + Math.random() * 0.2);
      samples[i * 2 + 1] = oy + areaH * (0.4 + Math.random() * 0.2);
    }
  }

  const byAngle = (a: Float32Array) => {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += a[i * 2]!;
      cy += a[i * 2 + 1]!;
    }
    cx /= n;
    cy /= n;
    const angle = (i: number) => Math.atan2(a[i * 2 + 1]! - cy, a[i * 2]! - cx);
    return Array.from({ length: n }, (_, i) => i).sort(
      (u, v) => angle(u) - angle(v),
    );
  };
  const pageOrder = byAngle(xy);
  const picOrder = byAngle(samples);
  let maxR = 1;
  for (let i = 0; i < n; i++) {
    maxR = Math.max(maxR, Math.hypot(xy[i * 2]! - W, xy[i * 2 + 1]! - H));
  }
  const pic = new Float32Array(n * 2);
  const delays = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = pageOrder[k]!;
    const j = picOrder[k]!;
    pic[i * 2] = samples[j * 2]!;
    pic[i * 2 + 1] = samples[j * 2 + 1]!;
    // Ripple out of the bottom-right button, smootherstep eased, jittered.
    const r = Math.hypot(xy[i * 2]! - W, xy[i * 2 + 1]! - H) / maxR;
    const e = r * r * r * (r * (r * 6 - 15) + 10);
    delays[i] = e * (1 - JITTER) + Math.random() * JITTER;
  }
  return { pic, delays };
}

function Morph({
  width: W,
  height: H,
  image,
}: {
  width: number;
  height: number;
  image: TgfxImage | null;
}) {
  const layout = useMemo(() => buildLayout(W, H), [W, H]);
  const n = layout.cell.length;
  const [targets, setTargets] = useState<Targets | null>(null);
  useEffect(() => {
    setTargets(null);
    if (!image) {
      return;
    }
    let live = true;
    // Deferred past the first paint so the page shows instantly.
    const id = setTimeout(() => {
      image.encode('raw').then(raw => {
        if (live) {
          setTargets(
            computeTargets(layout.xy, new Uint8Array(raw), image.width, image.height, W, H),
          );
        }
      });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [image, layout, W, H]);

  const sheet = useOffscreenImage(
    <Group>
      {CHARS.map((ch, i) => (
        <Text
          key={i}
          x={(i % COLS) * CELL + PAD}
          y={Math.floor(i / COLS) * CELL + CELL * 0.72}
          text={ch}
          color={INK}
          {...STYLE}
        />
      ))}
    </Group>,
    { width: COLS * CELL, height: ROWS * CELL, pixelRatio: PR },
    [],
  );
  const sprites = useSpriteBuffer(n);
  const count = useSharedValue(0);
  const fade = useSharedValue(1);
  const progress = useSharedValue(0);
  const [revealed, setRevealed] = useState(false);

  // Until sampling lands, target = page, so the morph is a no-op.
  const pic = targets?.pic ?? layout.xy;
  const delays = useMemo(
    () => targets?.delays ?? new Float32Array(n),
    [targets, n],
  );
  const { xy, cell } = layout;
  useAnimatedReaction(
    () => progress.value,
    p => {
      const cxC = W / 2;
      const cyC = H / 2;
      const cellPx = CELL * PR;
      for (let i = 0; i < n; i++) {
        const pe = Math.max(
          0,
          Math.min(1, (p - delays[i]! * STAGGER) / (1 - STAGGER)),
        );
        const sx = xy[i * 2]!;
        const sy = xy[i * 2 + 1]!;
        const dx = pic[i * 2]! - sx;
        const dy = pic[i * 2 + 1]! - sy;
        // Mid-flight surge toward the camera, projected toward the centre.
        const eff = Math.sin(pe * Math.PI);
        const norm = Math.min(Math.hypot(dx, dy) / W, 1);
        const persp = CAMERA_Z / (CAMERA_Z - eff * (Z_BASE + norm * Z_MOVE));
        const s =
          ((PAGE_SCALE + (PICTURE_SCALE - PAGE_SCALE) * pe) * persp) / PR;
        const c = cell[i]!;
        sprites.set(
          i,
          (c % COLS) * cellPx,
          Math.floor(c / COLS) * cellPx,
          cellPx,
          cellPx,
          s,
          cxC + (sx + dx * pe - cxC) * persp,
          cyC + (sy + dy * pe - cyC) * persp,
        );
      }
      fade.value = 1 - Math.sin(Math.min(1, p) * Math.PI) * FADE * 0.6;
      // ponytail: Reanimated drops same-value writes; the fraction keeps the count changing and truncates natively.
      count.value = n + p * 1e-3;
    },
    [xy, cell, pic, delays, n, W, H],
  );

  const toggle = () => {
    const next = !revealed;
    setRevealed(next);
    progress.value = withSpring(next ? 1 : 0, {
      dampingRatio: 1,
      duration: DURATION,
    });
  };

  return (
    <>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={PAGE_BG} />
        {sheet && (
          <Atlas image={sheet} buffer={sprites} count={count} opacity={fade} />
        )}
      </Canvas>
      <Pressable
        style={[styles.fab, { bottom: W * MARGIN, right: W * MARGIN }]}
        onPress={toggle}
      >
        <RNText style={styles.fabText}>{revealed ? 'Aa' : '❀'}</RNText>
      </Pressable>
    </>
  );
}

export function LittlePrinceScreen() {
  const ready = useFonts({ [FAMILY]: [require('./assets/fonts/Newsreader.ttf')] });
  const image = useImage(require('./assets/prince.png'));
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View style={styles.root} onLayout={e => setSize(e.nativeEvent.layout)}>
      {ready && size.width > 0 && (
        <Morph
          key={`${size.width}x${size.height}`}
          width={size.width}
          height={size.height}
          image={image}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  fab: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { color: '#efe7d6', fontSize: 18, fontWeight: '600' },
});
