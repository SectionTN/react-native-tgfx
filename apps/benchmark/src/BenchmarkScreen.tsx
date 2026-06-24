/**
 * Head-to-head benchmark: react-native-tgfx vs @shopify/react-native-skia.
 *
 * Identical workload for both: N circles whose (cx, cy) are 2N Reanimated
 * SharedValues animated entirely on the UI thread by a single useFrameCallback
 * (zero JS-thread work per frame). Only the rendering library differs.
 *
 * It auto-sweeps [tgfx, skia] x [shape counts], logging BENCH_START / BENCH_END
 * markers to the console so the adb harness (bench-app/measure.sh) can attribute
 * FPS / CPU / memory / GPU samples to each config.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  cancelAnimation,
  makeMutable,
  useFrameCallback,
  type SharedValue,
} from 'react-native-reanimated';
import { Canvas as TgfxCanvas, Circle as TgfxCircle } from 'react-native-tgfx';
import {
  Canvas as SkiaCanvas,
  Circle as SkiaCircle,
} from '@shopify/react-native-skia';

type Lib = 'tgfx' | 'skia';
const COUNTS = [100, 300, 600, 1000, 1500];
const SECONDS_PER_CONFIG = 7;

const CONFIGS: { lib: Lib; n: number }[] = [];
for (const n of COUNTS) {
  CONFIGS.push({ lib: 'tgfx', n });
  CONFIGS.push({ lib: 'skia', n });
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** One config's animated field of N circles, mounted fresh per config. */
function BenchScene({ lib, n, width, height }: { lib: Lib; n: number; width: number; height: number }) {
  const { cxs, cys, bx, by, amp, r, colors } = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * width) / height)));
    const rows = Math.ceil(n / cols);
    const sx = width / cols;
    const sy = height / rows;
    const cxs: SharedValue<number>[] = [];
    const cys: SharedValue<number>[] = [];
    const bx: number[] = [];
    const by: number[] = [];
    const colors: string[] = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * sx + sx / 2;
      const y = row * sy + sy / 2;
      bx.push(x);
      by.push(y);
      cxs.push(makeMutable(x));
      cys.push(makeMutable(y));
      colors.push(hslToHex((i * 37) % 360, 70, 55));
    }
    const amp = Math.min(sx, sy) * 0.35;
    const r = Math.max(3, Math.min(sx, sy) * 0.32);
    return { cxs, cys, bx, by, amp, r, colors };
  }, [n, width, height]);

  useEffect(() => {
    return () => {
      for (let i = 0; i < cxs.length; i++) {
        cancelAnimation(cxs[i]);
        cancelAnimation(cys[i]);
      }
    };
  }, [cxs, cys]);

  useFrameCallback((info) => {
    'worklet';
    const t = info.timeSinceFirstFrame / 1000;
    for (let i = 0; i < cxs.length; i++) {
      cxs[i].value = bx[i] + amp * Math.cos(t * 2 + i);
      cys[i].value = by[i] + amp * Math.sin(t * 2 + i * 1.3);
    }
  });

  const style = { width, height } as const;
  if (lib === 'skia') {
    return (
      <SkiaCanvas style={style}>
        {cxs.map((cx, i) => (
          <SkiaCircle key={i} cx={cx} cy={cys[i]} r={r} color={colors[i]} />
        ))}
      </SkiaCanvas>
    );
  }
  return (
    <TgfxCanvas style={style}>
      {cxs.map((cx, i) => (
        <TgfxCircle key={i} cx={cx} cy={cys[i]} r={r} color={colors[i]} />
      ))}
    </TgfxCanvas>
  );
}

export function BenchmarkScreen({ onExit }: { onExit: () => void }) {
  const { width } = useWindowDimensions();
  const canvasH = 560;
  const [idx, setIdx] = useState(0);
  const done = idx >= CONFIGS.length;
  const cfg = done ? CONFIGS[CONFIGS.length - 1] : CONFIGS[idx];
  const startedAt = useRef(0);

  useEffect(() => {
    if (done) {
      console.log('BENCH_SWEEP_DONE');
      return;
    }
    console.log(`BENCH_START lib=${cfg.lib} n=${cfg.n}`);
    startedAt.current = Date.now();
    const t = setTimeout(() => {
      console.log(`BENCH_END lib=${cfg.lib} n=${cfg.n}`);
      setIdx((i) => i + 1);
    }, SECONDS_PER_CONFIG * 1000);
    return () => clearTimeout(t);
  }, [idx, cfg.lib, cfg.n, done]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {done ? 'Sweep complete' : `${cfg.lib.toUpperCase()} · ${cfg.n} circles`}
        </Text>
        <Text style={styles.sub}>
          {done ? 'tap to exit' : `config ${idx + 1}/${CONFIGS.length} · ${SECONDS_PER_CONFIG}s each`}
        </Text>
        <Text style={styles.exit} onPress={onExit}>
          ✕ Exit
        </Text>
      </View>
      <View style={[styles.canvasWrap, { height: canvasH }]}>
        {!done && (
          <BenchScene key={idx} lib={cfg.lib} n={cfg.n} width={width} height={canvasH} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#888', fontSize: 13, marginTop: 2 },
  exit: { color: '#0A84FF', fontSize: 15, marginTop: 8 },
  canvasWrap: { backgroundColor: '#000' },
});
