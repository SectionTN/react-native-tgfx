/**
 * Standalone benchmark runner — tgfx vs @shopify/react-native-skia.
 *
 * Workload: N circles driven by Reanimated SharedValues, animated entirely on
 * the UI thread via useFrameCallback (zero JS-thread work per frame).
 * Only the rendering library differs.
 *
 * Emits logcat markers consumed by measure.sh:
 *   BENCH_START  lib=<tgfx|skia>  n=<N>
 *   BENCH_END    lib=<tgfx|skia>  n=<N>
 *   BENCH_SWEEP_DONE
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const COUNTS = [100, 300, 600, 1000, 1500, 2000];
const SECS = 10;   // seconds of active rendering per config
const SETTLE = 6;  // pause after BENCH_END so the harness has time to query gfxinfo/meminfo

const CONFIGS: { lib: Lib; n: number }[] = [];
for (const n of COUNTS) {
  CONFIGS.push({ lib: 'tgfx', n });
  CONFIGS.push({ lib: 'skia', n });
}

type BenchResult = { lib: Lib; n: number };

function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function BenchScene({ lib, n, width, height }: {
  lib: Lib; n: number; width: number; height: number;
}) {
  const { cxs, cys, bx, by, amp, r, colors } = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * width) / height)));
    const rows = Math.ceil(n / cols);
    const sx = width / cols;
    const sy = height / rows;
    const _cxs: SharedValue<number>[] = [];
    const _cys: SharedValue<number>[] = [];
    const _bx: number[] = [];
    const _by: number[] = [];
    const _colors: string[] = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * sx + sx / 2;
      const y = row * sy + sy / 2;
      _bx.push(x); _by.push(y);
      _cxs.push(makeMutable(x));
      _cys.push(makeMutable(y));
      _colors.push(hsl((i * 37) % 360, 70, 55));
    }
    return {
      cxs: _cxs, cys: _cys, bx: _bx, by: _by,
      amp: Math.min(sx, sy) * 0.35,
      r: Math.max(3, Math.min(sx, sy) * 0.32),
      colors: _colors,
    };
  }, [n, width, height]);

  useEffect(() => () => {
    for (let i = 0; i < cxs.length; i++) {
      cancelAnimation(cxs[i]);
      cancelAnimation(cys[i]);
    }
  }, [cxs, cys]);

  useFrameCallback((info) => {
    'worklet';
    const t = info.timeSinceFirstFrame / 1000;
    for (let i = 0; i < cxs.length; i++) {
      cxs[i].value = bx[i] + amp * Math.cos(t * 2 + i);
      cys[i].value = by[i] + amp * Math.sin(t * 2 + i * 1.3);
    }
  });

  if (lib === 'skia') {
    // Skia handles explicit {width, height} correctly.
    return (
      <SkiaCanvas style={{ width, height }}>
        {cxs.map((cx, i) => (
          <SkiaCircle key={i} cx={cx} cy={cys[i]} r={r} color={colors[i]} />
        ))}
      </SkiaCanvas>
    );
  }
  // TgfxCanvas: only pass height and let flex stretching set the width.
  // (Same pattern as the example app — explicit width on TgfxNativeView
  // is not respected due to a Nitro HybridView layout quirk.)
  return (
    <TgfxCanvas style={{ height, alignSelf: 'stretch' }}>
      {cxs.map((cx, i) => (
        <TgfxCircle key={i} cx={cx} cy={cys[i]} r={r} color={colors[i]} />
      ))}
    </TgfxCanvas>
  );
}

function ResultsTable({ results }: { results: BenchResult[] }) {
  return (
    <View style={st.table}>
      <Text style={st.resultTitle}>Completed configs</Text>
      <Text style={st.resultNote}>
        Run  bash measure.sh  for authoritative FPS / jank% / CPU% / memory data.
      </Text>
      <View style={st.tableHead}>
        <Text style={[st.cell, st.cLib]}>LIB</Text>
        <Text style={[st.cell, st.cN]}>CIRCLES</Text>
        <Text style={[st.cell, st.cDone]}>STATUS</Text>
      </View>
      {CONFIGS.map((cfg, i) => {
        const done = i < results.length;
        return (
          <View key={i} style={[st.tableRow, cfg.lib === 'tgfx' ? st.rowT : st.rowS]}>
            <Text style={[st.cell, st.cLib, st.rowText]}>{cfg.lib.toUpperCase()}</Text>
            <Text style={[st.cell, st.cN, st.rowText]}>{cfg.n}</Text>
            <Text style={[st.cell, st.cDone, done ? st.done : st.pending]}>
              {done ? '✓' : '…'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function BenchmarkRunner() {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const canvasH = Math.min(500, screenH * 0.60);

  // Use onLayout instead of useWindowDimensions().width so we get the
  // actual rendered container width (avoids density/window-inset mismatches).
  const [canvasW, setCanvasW] = useState(0);

  const [run, setRun] = useState(0); // increment to restart
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<BenchResult[]>([]);

  const done = idx >= CONFIGS.length;
  const cfg = CONFIGS[Math.min(idx, CONFIGS.length - 1)];
  const remaining = Math.max(0, SECS - elapsed);

  useEffect(() => {
    if (done) {
      console.log('BENCH_SWEEP_DONE');
      return;
    }
    const { lib, n } = cfg;
    console.log(`BENCH_START lib=${lib} n=${n}`);
    const t0 = Date.now();
    setElapsed(0);

    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 250);

    const sweep = setTimeout(() => {
      console.log(`BENCH_END lib=${lib} n=${n}`);
      setResults(prev => [...prev, { lib, n }]);
      // wait SETTLE seconds before next config so the harness has time to
      // run dumpsys gfxinfo + meminfo without missing the next BENCH_START
      setTimeout(() => setIdx(i => i + 1), SETTLE * 1000);
    }, SECS * 1000);

    return () => {
      clearTimeout(sweep);
      clearInterval(tick);
    };
  }, [idx, run, done]); // eslint-disable-line react-hooks/exhaustive-deps

  function restart() {
    setIdx(0);
    setResults([]);
    setElapsed(0);
    setRun(r => r + 1);
  }

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      {/* header */}
      <View style={st.header}>
        <Text style={st.title}>tgfx-bench</Text>
        {done ? (
          <Text style={st.subtitle}>Sweep complete — {CONFIGS.length} configs × {SECS}s</Text>
        ) : (
          <>
            <Text style={st.subtitle}>
              {cfg.lib.toUpperCase()}  ·  {cfg.n} circles  ·  {remaining}s left
            </Text>
            <Text style={st.sub2}>config {idx + 1}/{CONFIGS.length}</Text>
          </>
        )}
      </View>

      {/* canvas — always visible; onLayout gives the real container width */}
      <View
        style={[st.canvasWrap, { height: canvasH }]}
        onLayout={(e) => setCanvasW(e.nativeEvent.layout.width)}
      >
        {canvasW > 0 && (
          <BenchScene
            key={idx + run * 1000}
            lib={cfg.lib}
            n={cfg.n}
            width={canvasW}
            height={canvasH}
          />
        )}
      </View>

      {/* scrollable results + run-again button */}
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent}>
        {done && (
          <TouchableOpacity style={st.btn} onPress={restart} activeOpacity={0.75}>
            <Text style={st.btnText}>▶  Run again</Text>
          </TouchableOpacity>
        )}
        <ResultsTable results={results} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: 0.4 },
  subtitle: { color: '#ddd', fontSize: 14, marginTop: 3 },
  sub2: { color: '#777', fontSize: 12, marginTop: 1 },

  canvasWrap: { backgroundColor: '#111' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40, paddingTop: 8 },

  btn: {
    backgroundColor: '#0A84FF',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  resultTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginHorizontal: 16, marginBottom: 2 },
  resultNote: { color: '#555', fontSize: 11, marginHorizontal: 16, marginBottom: 10, lineHeight: 15 },

  table: {},
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#222',
    paddingBottom: 5,
    marginHorizontal: 16,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 20,
    borderRadius: 4,
    marginVertical: 1,
    marginHorizontal: 12,
  },
  rowT: { backgroundColor: '#0d1a16' },
  rowS: { backgroundColor: '#1a0d0d' },
  cell: { fontSize: 13, color: '#666', fontWeight: '600' },
  cLib: { width: 64 },
  cN: { flex: 1 },
  cDone: { width: 48, textAlign: 'right' },
  rowText: { color: '#ccc', fontWeight: '400' },
  done: { color: '#4ade80', fontWeight: '700' },
  pending: { color: '#555' },
});
