/**
 * tgfx vs @shopify/react-native-skia — symmetric perf harness.
 *
 * Fairness rules baked in:
 *  - one scene builder and one UI-thread driver per workload, shared by both engines
 *  - identical canvas pixel size, identical colors/geometry
 *  - one engine mounted at a time; 2.5 s warmup discarded; 6 s window
 *  - lib order flipped so each lib runs first exactly half the time per config
 *  - a discarded pre-roll config per lib absorbs cold start / first shader compile
 *  - SharedValues allocated ONCE for the whole sweep and sliced per config, so
 *    later configs do not pay for earlier ones' leaked mutables
 *  - Skia gets colorSpace="srgb" so it is not silently color-managing on iOS
 *  - all three engines animate from ONE UI-thread worklet: tgfx/skia via
 *    SharedValues, thor via its imperative drawShapes fast path
 *
 * Logs consumed by bench.sh:
 *   BENCH_BASELINE                      (nothing mounted — idle PSS reference)
 *   BENCH_START lib= wl= n= run=
 *   BENCH_END   lib= wl= n= run= uiFps= jsFps= uiJank= uiMaxMs= secs=
 *   BENCH_SWEEP_DONE
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  makeMutable,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Canvas as TgfxCanvas,
  Circle as TgfxCircle,
  Group as TgfxGroup,
  LinearGradient as TgfxLinearGradient,
  Paint as TgfxPaint,
  Path as TgfxPath,
  Rect as TgfxRect,
  RoundedRect as TgfxRoundedRect,
  Shader as TgfxShader,
  SweepGradient as TgfxSweepGradient,
} from 'react-native-tgfx';
import { callback } from 'react-native-nitro-modules';
import {
  ThorCanvasNative,
  type ThorShape,
  type ThorView,
} from 'react-native-nitro-thor';
import {
  Canvas as SkiaCanvas,
  Circle as SkiaCircle,
  Group as SkiaGroup,
  LinearGradient as SkiaLinearGradient,
  Path as SkiaPath,
  Rect as SkiaRect,
  RoundedRect as SkiaRoundedRect,
  Shader as SkiaShader,
  Skia,
  SweepGradient as SkiaSweepGradient,
  vec,
} from '@shopify/react-native-skia';

// A realistic composite frame: gradient background, a runtime-shader panel,
// animated particles, a rotating card deck with sweep gradients, and a stroked
// path. Identical geometry for both engines; the shader is one SkSL source that
// Skia compiles natively and tgfx transpiles to GLSL.
const SHOWCASE_SHADER = `
uniform float2 size;
uniform float phase;
vec4 main(vec2 pos) {
  vec2 uv = pos / size;
  float band = 0.5 + 0.5 * sin((uv.x - uv.y) * 9.0 + phase);
  return vec4(0.12 + 0.5 * band, 0.15, 0.55 - 0.3 * band, 1.0);
}`;
const showcaseEffect = Skia.RuntimeEffect.Make(SHOWCASE_SHADER);
// Must not fail silently: a null effect would drop Skia's costliest showcase primitive.
if (showcaseEffect == null) {
  throw new Error('showcase SkSL failed to compile under Skia');
}
const SHOWCASE_EFFECT = showcaseEffect;
const CARD_PATH = 'M0 40 C 30 0, 90 0, 120 40 S 210 80, 240 40';

type Lib = 'tgfx' | 'skia' | 'thor';
type Workload = 'leaves' | 'group' | 'mixed' | 'idle' | 'rects' | 'rrects' | 'strokes' | 'showcase';

const FULL_PLAN: { wl: Workload; counts: number[]; runs: number }[] = [
  { wl: 'leaves', counts: [100, 600, 1500], runs: 4 },
  { wl: 'group', counts: [1500], runs: 4 },
  { wl: 'mixed', counts: [600], runs: 4 },
  { wl: 'showcase', counts: [300, 900], runs: 4 },
  { wl: 'idle', counts: [600], runs: 4 },
];

// Single-primitive probes: isolate which draw kind is slow.
const PROBE_PLAN: { wl: Workload; counts: number[]; runs: number }[] = [
  { wl: 'leaves', counts: [600], runs: 3 },
  { wl: 'rects', counts: [600], runs: 3 },
  { wl: 'rrects', counts: [600], runs: 3 },
  { wl: 'strokes', counts: [600], runs: 3 },
];

const WARMUP_MS = 2500;
const WINDOW_MS = 6000;
const SETTLE_MS = 3500;
const BASELINE_MS = 4000;

type Config = { lib: Lib; wl: Workload; n: number; run: number; preroll?: boolean };

function buildConfigs(plan: typeof FULL_PLAN): Config[] {
  // Pre-roll on `mixed` so every draw kind's first shader compile is absorbed,
  // not just circles'.
  const out: Config[] = [
    { lib: 'tgfx', wl: 'mixed', n: 300, run: 0, preroll: true },
    { lib: 'skia', wl: 'mixed', n: 300, run: 0, preroll: true },
    { lib: 'thor', wl: 'leaves', n: 300, run: 0, preroll: true },
  ];
  const pairs: { wl: Workload; n: number; runs: number; wi: number; ci: number }[] = [];
  plan.forEach((p, wi) =>
    p.counts.forEach((n, ci) => pairs.push({ wl: p.wl, n, runs: p.runs, wi, ci }))
  );
  const maxRuns = Math.max(...pairs.map((p) => p.runs));
  for (let run = 1; run <= maxRuns; run++) {
    // Rotate the workload order every run so no workload always runs last, on
    // the hottest die and the most fragmented heap.
    const k = run % pairs.length;
    for (const p of [...pairs.slice(k), ...pairs.slice(0, k)]) {
      if (run > p.runs) {
        continue;
      }
      // Thor's scene only implements circles, so it is compared on `leaves`
      // only rather than silently drawing the wrong scene elsewhere.
      const engines: Lib[] = p.wl === 'leaves' ? ['tgfx', 'skia', 'thor'] : ['tgfx', 'skia'];
      const k = (run + p.ci + p.wi) % engines.length;
      const order: Lib[] = [...engines.slice(k), ...engines.slice(0, k)];
      for (const lib of order) {
        out.push({ lib, wl: p.wl, n: p.n, run });
      }
    }
  }
  return out;
}

const MAX_N = 1500;

// Allocated once for the entire sweep and sliced per config (no per-config leak).
const POOL = {
  cxs: Array.from({ length: MAX_N }, () => makeMutable(0)),
  cys: Array.from({ length: MAX_N }, () => makeMutable(0)),
  angle: makeMutable(0),
};

const uiFrames = makeMutable(0);
const uiJank = makeMutable(0);
const uiMaxMs = makeMutable(0);
const measuring = makeMutable(0);

function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Static layout shared by both engines for a given (n, size). */
function useLayout(n: number, width: number, height: number) {
  return useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * width) / height)));
    const rows = Math.ceil(n / cols);
    const sx = width / cols;
    const sy = height / rows;
    const bx: number[] = [];
    const by: number[] = [];
    const colors: string[] = [];
    for (let i = 0; i < n; i++) {
      bx.push((i % cols) * sx + sx / 2);
      by.push(Math.floor(i / cols) * sy + sy / 2);
      colors.push(hsl((i * 37) % 360, 70, 55));
    }
    return { bx, by, colors, amp: Math.min(sx, sy) * 0.35, r: Math.max(3, Math.min(sx, sy) * 0.32), sx, sy };
  }, [n, width, height]);
}

/**
 * The one UI-thread driver. Animates according to the workload and counts UI
 * frames — identical code for both engines.
 */
function Driver({
  lib,
  wl,
  n,
  bx,
  by,
  amp,
  r,
  colors,
  thor,
}: {
  lib: Lib;
  wl: Workload;
  n: number;
  bx: number[];
  by: number[];
  amp: number;
  r: number;
  colors: string[];
  thor: SharedValue<ThorView | null>;
}) {
  const cxs = POOL.cxs;
  const cys = POOL.cys;
  const angle = POOL.angle;
  useFrameCallback((info) => {
    'worklet';
    const t = info.timeSinceFirstFrame / 1000;
    if (wl === 'showcase') {
      angle.value = t * 0.5;
    }
    if (lib === 'thor') {
      const obj = thor.value;
      if (obj != null) {
        const shapes: ThorShape[] = [];
        for (let i = 0; i < n; i++) {
          shapes.push({
            type: 'circle',
            cx: bx[i] + amp * Math.cos(t * 2 + i),
            cy: by[i] + amp * Math.sin(t * 2 + i * 1.3),
            radius: r,
            fill: colors[i],
          });
        }
        obj.drawShapes(shapes);
      }
    } else if (wl !== 'group' && wl !== 'idle') {
      for (let i = 0; i < n; i++) {
        cxs[i].value = bx[i] + amp * Math.cos(t * 2 + i);
        cys[i].value = by[i] + amp * Math.sin(t * 2 + i * 1.3);
      }
    } else if (wl === 'group') {
      angle.value = t * 0.6;
    }
    if (measuring.value === 1) {
      const dt = info.timeSincePreviousFrame ?? 0;
      uiFrames.value += 1;
      if (dt > 24) {
        uiJank.value += 1;
      }
      if (dt > uiMaxMs.value) {
        uiMaxMs.value = dt;
      }
    }
  });
  return null;
}

function TgfxScene({ wl, n, w, h }: { wl: Workload; n: number; w: number; h: number }) {
  const { bx, by, colors, r, sx, sy } = useLayout(n, w, h);
  const { cxs, cys, angle } = POOL;
  if (wl === 'leaves') {
    return (
      <>
        {colors.map((c, i) => (
          <TgfxCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />
        ))}
      </>
    );
  }
  if (wl === 'idle') {
    return (
      <>
        {colors.map((c, i) => (
          <TgfxCircle key={i} cx={bx[i]} cy={by[i]} r={r} color={c} />
        ))}
      </>
    );
  }
  if (wl === 'group') {
    return (
      <TgfxGroup origin={{ x: w / 2, y: h / 2 }} transform={[{ rotate: angle }]}>
        {colors.map((c, i) => (
          <TgfxCircle key={i} cx={bx[i]} cy={by[i]} r={r} color={c} />
        ))}
      </TgfxGroup>
    );
  }
  if (wl === 'rects' || wl === 'strokes') {
    return (
      <>
        {colors.map((c, i) => (
          <TgfxRect
            key={i}
            x={cxs[i]}
            y={cys[i]}
            width={sx * 0.6}
            height={sy * 0.6}
            color={c}
            {...(wl === 'strokes' ? { style: 'stroke' as const, strokeWidth: 2 } : null)}
          />
        ))}
      </>
    );
  }
  if (wl === 'rrects') {
    return (
      <>
        {colors.map((c, i) => (
          <TgfxRoundedRect
            key={i}
            x={cxs[i]}
            y={cys[i]}
            width={sx * 0.6}
            height={sy * 0.6}
            r={3}
            color={c}
          />
        ))}
      </>
    );
  }
  if (wl === 'showcase') {
    const cardW = w * 0.26;
    const cardH = h * 0.18;
    return (
      <>
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxPaint>
            <TgfxLinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: w, y: h }}
              colors={['#0b1021', '#1d1136', '#07131f']}
            />
          </TgfxPaint>
        </TgfxRect>
        <TgfxRect x={w * 0.06} y={h * 0.06} width={w * 0.88} height={h * 0.2}>
          <TgfxShader source={SHOWCASE_SHADER} uniforms={{ size: [w * 0.88, h * 0.2], phase: 1.2 }} />
        </TgfxRect>
        {colors.map((c, i) => (
          <TgfxCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />
        ))}
        <TgfxGroup origin={{ x: w / 2, y: h * 0.72 }} transform={[{ rotate: angle }]}>
          {[0, 1, 2, 3].map((i) => (
            <TgfxRoundedRect
              key={i}
              x={w / 2 - cardW / 2 + (i - 1.5) * cardW * 0.7}
              y={h * 0.72 - cardH / 2}
              width={cardW}
              height={cardH}
              r={10}
            >
              <TgfxPaint>
                <TgfxSweepGradient
                  c={{ x: w / 2, y: h * 0.72 }}
                  colors={['#22d3ee', '#a855f7', '#f59e0b', '#22d3ee']}
                />
              </TgfxPaint>
            </TgfxRoundedRect>
          ))}
        </TgfxGroup>
        <TgfxGroup transform={[{ translate: [w * 0.1, h * 0.82] }]}>
          <TgfxPath path={CARD_PATH} color="#e2e8f0" style="stroke" strokeWidth={3} />
        </TgfxGroup>
      </>
    );
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    const kind = i % 4;
    if (kind === 0) {
      out.push(<TgfxCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />);
    } else if (kind === 1) {
      out.push(
        <TgfxRect key={i} x={cxs[i]} y={cys[i]} width={sx * 0.6} height={sy * 0.6} color={c} />
      );
    } else if (kind === 2) {
      out.push(
        <TgfxRoundedRect
          key={i}
          x={cxs[i]}
          y={cys[i]}
          width={sx * 0.6}
          height={sy * 0.6}
          r={3}
          color={c}
        />
      );
    } else {
      out.push(
        <TgfxRect
          key={i}
          x={cxs[i]}
          y={cys[i]}
          width={sx * 0.6}
          height={sy * 0.6}
          color={c}
          style="stroke"
          strokeWidth={2}
        />
      );
    }
  }
  return <>{out}</>;
}

function SkiaScene({ wl, n, w, h }: { wl: Workload; n: number; w: number; h: number }) {
  const { bx, by, colors, r, sx, sy } = useLayout(n, w, h);
  const { cxs, cys, angle } = POOL;
  // Skia's documented way to animate a transform: a derived value holding the
  // whole transform array.
  const transform = useDerivedValue(() => [{ rotate: angle.value }]);
  if (wl === 'leaves') {
    return (
      <>
        {colors.map((c, i) => (
          <SkiaCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />
        ))}
      </>
    );
  }
  if (wl === 'idle') {
    return (
      <>
        {colors.map((c, i) => (
          <SkiaCircle key={i} cx={bx[i]} cy={by[i]} r={r} color={c} />
        ))}
      </>
    );
  }
  if (wl === 'group') {
    return (
      <SkiaGroup origin={vec(w / 2, h / 2)} transform={transform}>
        {colors.map((c, i) => (
          <SkiaCircle key={i} cx={bx[i]} cy={by[i]} r={r} color={c} />
        ))}
      </SkiaGroup>
    );
  }
  if (wl === 'rects' || wl === 'strokes') {
    return (
      <>
        {colors.map((c, i) => (
          <SkiaRect
            key={i}
            x={cxs[i]}
            y={cys[i]}
            width={sx * 0.6}
            height={sy * 0.6}
            color={c}
            {...(wl === 'strokes' ? { style: 'stroke' as const, strokeWidth: 2 } : null)}
          />
        ))}
      </>
    );
  }
  if (wl === 'rrects') {
    return (
      <>
        {colors.map((c, i) => (
          <SkiaRoundedRect
            key={i}
            x={cxs[i]}
            y={cys[i]}
            width={sx * 0.6}
            height={sy * 0.6}
            r={3}
            color={c}
          />
        ))}
      </>
    );
  }
  if (wl === 'showcase') {
    const cardW = w * 0.26;
    const cardH = h * 0.18;
    return (
      <>
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaLinearGradient
            start={vec(0, 0)}
            end={vec(w, h)}
            colors={['#0b1021', '#1d1136', '#07131f']}
          />
        </SkiaRect>
        <SkiaRect x={w * 0.06} y={h * 0.06} width={w * 0.88} height={h * 0.2}>
          <SkiaShader
            source={SHOWCASE_EFFECT}
            uniforms={{ size: [w * 0.88, h * 0.2], phase: 1.2 }}
          />
        </SkiaRect>
        {colors.map((c, i) => (
          <SkiaCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />
        ))}
        <SkiaGroup origin={vec(w / 2, h * 0.72)} transform={transform}>
          {[0, 1, 2, 3].map((i) => (
            <SkiaRoundedRect
              key={i}
              x={w / 2 - cardW / 2 + (i - 1.5) * cardW * 0.7}
              y={h * 0.72 - cardH / 2}
              width={cardW}
              height={cardH}
              r={10}
            >
              <SkiaSweepGradient
                c={vec(w / 2, h * 0.72)}
                colors={['#22d3ee', '#a855f7', '#f59e0b', '#22d3ee']}
              />
            </SkiaRoundedRect>
          ))}
        </SkiaGroup>
        <SkiaGroup transform={[{ translateX: w * 0.1 }, { translateY: h * 0.82 }]}>
          <SkiaPath path={CARD_PATH} color="#e2e8f0" style="stroke" strokeWidth={3} />
        </SkiaGroup>
      </>
    );
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    const kind = i % 4;
    if (kind === 0) {
      out.push(<SkiaCircle key={i} cx={cxs[i]} cy={cys[i]} r={r} color={c} />);
    } else if (kind === 1) {
      out.push(
        <SkiaRect key={i} x={cxs[i]} y={cys[i]} width={sx * 0.6} height={sy * 0.6} color={c} />
      );
    } else if (kind === 2) {
      out.push(
        <SkiaRoundedRect
          key={i}
          x={cxs[i]}
          y={cys[i]}
          width={sx * 0.6}
          height={sy * 0.6}
          r={3}
          color={c}
        />
      );
    } else {
      out.push(
        <SkiaRect
          key={i}
          x={cxs[i]}
          y={cys[i]}
          width={sx * 0.6}
          height={sy * 0.6}
          color={c}
          style="stroke"
          strokeWidth={2}
        />
      );
    }
  }
  return <>{out}</>;
}

/**
 * Thor via its documented worklet fast path: the native HybridObject is drawn
 * imperatively from the shared UI-thread Driver, so no Fabric commit or JS
 * render sits in the animation loop. `shapes` stays a stable empty array — a
 * re-commit would clobber the worklet-drawn frame.
 *
 * backend="cpu": ThorVG's software rasterizer. Its GL backend is a GLSurfaceView,
 * whose frames bypass HWUI and so cannot be counted by gfxinfo at all.
 */
const THOR_EMPTY: ThorShape[] = [];

function ThorScene({
  w,
  h,
  onRef,
}: {
  w: number;
  h: number;
  onRef: (ref: ThorView) => void;
}) {
  return (
    <ThorCanvasNative
      style={{ width: w, height: h }}
      backend="cpu"
      shapes={THOR_EMPTY}
      hybridRef={callback(onRef)}
    />
  );
}

const Scene = memo(function Scene({
  lib,
  wl,
  n,
  w,
  h,
}: {
  lib: Lib;
  wl: Workload;
  n: number;
  w: number;
  h: number;
}) {
  const { bx, by, amp, r, colors } = useLayout(n, w, h);
  const style = { width: w, height: h };
  const thor = useSharedValue<ThorView | null>(null);
  const onThorRef = useCallback((ref: ThorView) => { thor.value = ref; }, [thor]);
  return (
    <>
      <Driver lib={lib} wl={wl} n={n} bx={bx} by={by} amp={amp} r={r} colors={colors} thor={thor} />
      {lib === 'thor' ? (
        <ThorScene w={w} h={h} onRef={onThorRef} />
      ) : lib === 'skia' ? (
        <SkiaCanvas style={style} colorSpace="srgb">
          <SkiaScene wl={wl} n={n} w={w} h={h} />
        </SkiaCanvas>
      ) : (
        <TgfxCanvas style={style}>
          <TgfxScene wl={wl} n={n} w={w} h={h} />
        </TgfxCanvas>
      )}
    </>
  );
});

export function Bench({ plan }: { plan?: string }) {
  const { width, height } = useWindowDimensions();
  const w = Math.floor(width);
  const h = Math.floor(Math.min(520, height * 0.62));
  const CONFIGS = useMemo(
    () => buildConfigs(plan === 'probe' ? PROBE_PLAN : FULL_PLAN),
    [plan]
  );

  const [idx, setIdx] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [liveFps, setLiveFps] = useState({ ui: 0, js: 0 });
  const jsFrames = useRef(0);
  const jsCounting = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (jsCounting.current) {
        jsFrames.current += 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Live readout, frozen while a window is measuring so the display cannot
  // perturb either engine.
  useEffect(() => {
    let ui = 0;
    let js = 0;
    const id = setInterval(() => {
      const nowUi = uiFrames.value;
      const nowJs = jsFrames.current;
      if (measuring.value !== 1) {
        setLiveFps({ ui: (nowUi - ui) * 2, js: (nowJs - js) * 2 });
      }
      ui = nowUi;
      js = nowJs;
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Idle phase first: nothing mounted, so the harness can read a PSS reference
  // that contains both libraries loaded but neither rendering.
  useEffect(() => {
    console.log('BENCH_BASELINE');
    const t = setTimeout(() => setIdx(0), BASELINE_MS);
    return () => clearTimeout(t);
  }, []);

  const done = idx >= CONFIGS.length;
  const cfg = CONFIGS[Math.min(Math.max(idx, 0), CONFIGS.length - 1)];

  useEffect(() => {
    if (idx < 0) {
      return;
    }
    if (done) {
      console.log('BENCH_SWEEP_DONE');
      return;
    }
    const { lib, wl, n, run, preroll } = cfg;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setMounted(true);

    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        if (preroll) {
          setMounted(false);
          console.log('BENCH_IDLE');
          timers.push(setTimeout(() => !cancelled && setIdx((i) => i + 1), SETTLE_MS));
          return;
        }
        uiFrames.value = 0;
        uiJank.value = 0;
        uiMaxMs.value = 0;
        jsFrames.current = 0;
        jsCounting.current = true;
        measuring.value = 1;
        const t0 = Date.now();
        console.log(`BENCH_START lib=${lib} wl=${wl} n=${n} run=${run}`);

        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            const secs = (Date.now() - t0) / 1000;
            measuring.value = 0;
            jsCounting.current = false;
            const uf = uiFrames.value;
            const jf = jsFrames.current;
            console.log(
              `BENCH_END lib=${lib} wl=${wl} n=${n} run=${run} ` +
                `uiFps=${(uf / secs).toFixed(2)} jsFps=${(jf / secs).toFixed(2)} ` +
                `uiFrames=${uf} jsFrames=${jf} uiJank=${uiJank.value} ` +
                `uiMaxMs=${uiMaxMs.value.toFixed(1)} secs=${secs.toFixed(2)}`
            );
            timers.push(
              setTimeout(() => {
                if (cancelled) return;
                setMounted(false);
                console.log('BENCH_IDLE');
              }, 800)
            );
            timers.push(setTimeout(() => !cancelled && setIdx((i) => i + 1), SETTLE_MS));
          }, WINDOW_MS)
        );
      }, WARMUP_MS)
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done]);

  return (
    <View style={st.root}>
      <View style={st.header}>
        <Text style={st.title}>tgfx-bench</Text>
        <Text style={st.fps}>
          {`UI ${liveFps.ui} fps   JS ${liveFps.js} fps`}
        </Text>
        <Text style={st.sub}>
          {idx < 0
            ? 'baseline (idle)'
            : done
              ? `done — ${CONFIGS.length} configs`
              : `${cfg.lib.toUpperCase()} · ${cfg.wl} · ${cfg.n} · run ${cfg.run}` +
                `${cfg.preroll ? ' (pre-roll)' : ''} · ${idx + 1}/${CONFIGS.length}`}
        </Text>
      </View>
      <View style={[st.canvasWrap, { width: w, height: h }]}>
        {idx >= 0 && !done && mounted && (
          <Scene key={idx} lib={cfg.lib} wl={cfg.wl} n={cfg.n} w={w} h={h} />
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { paddingTop: 44, paddingHorizontal: 14, paddingBottom: 6 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sub: { color: '#999', fontSize: 12, marginTop: 2 },
  fps: { color: '#4ade80', fontSize: 15, fontWeight: '700', marginTop: 2 },
  canvasWrap: { backgroundColor: '#000' },
});
