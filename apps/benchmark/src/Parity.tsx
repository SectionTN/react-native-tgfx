/**
 * Pixel-parity harness: renders the SAME static scene with tgfx and Skia at the
 * SAME pixel size, both on screen at once in known absolute rects. One
 * screenshot per scene, two deterministic crops, numeric diff — no timing race
 * and no eyeballing.
 *
 * Logs for the harness:
 *   PARITY_LAYOUT ratio=<> x=<> w=<> h=<> yTgfx=<> ySkia=<>
 *   PARITY_SCENE name=<> index=<>/<>
 *   PARITY_DONE
 */
import { useEffect, useState } from 'react';
import { makeMutable } from 'react-native-reanimated';
import { PixelRatio, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  Canvas as TgfxCanvas,
  Circle as TgfxCircle,
  Group as TgfxGroup,
  FractalNoise as TgfxFractalNoise,
  LinearGradient as TgfxLinearGradient,
  Line as TgfxLine,
  Oval as TgfxOval,
  Paint as TgfxPaint,
  Path as TgfxPath,
  RadialGradient as TgfxRadialGradient,
  Rect as TgfxRect,
  RoundedRect as TgfxRoundedRect,
  Shader as TgfxShader,
  SweepGradient as TgfxSweepGradient,
  Turbulence as TgfxTurbulence,
} from 'react-native-tgfx';
import {
  Canvas as SkiaCanvas,
  Circle as SkiaCircle,
  Group as SkiaGroup,
  FractalNoise as SkiaFractalNoise,
  LinearGradient as SkiaLinearGradient,
  Line as SkiaLine,
  Oval as SkiaOval,
  Path as SkiaPath,
  RadialGradient as SkiaRadialGradient,
  Rect as SkiaRect,
  RoundedRect as SkiaRoundedRect,
  Shader as SkiaShader,
  Skia,
  SweepGradient as SkiaSweepGradient,
  Turbulence as SkiaTurbulence,
  vec,
} from '@shopify/react-native-skia';

const SCENES = [
  'circles',
  'rects',
  'strokes',
  'rrects',
  'ovals',
  'lines',
  'path',
  'lingrad',
  'radgrad',
  'opacity',
  'transform',
  'sweep',
  'noise',
  'turb',
  'zorder',
  'slots',
  'shader',
] as const;
type SceneName = (typeof SCENES)[number];

const HOLD_MS = 3000;

// The `slots` scene drives geometry through Reanimated SharedValues, so both
// engines render via their animated-value path rather than a static scene. Held
// constant so the image is deterministic.
// One source, both engines: Skia compiles it as SkSL, tgfx transpiles it to the
// GLSL its fragment builder emits (and Metal cross-compiles that to MSL).
const SHADER_SRC = `
uniform float2 size;
uniform float phase;
vec4 main(vec2 pos) {
  vec2 uv = pos / size;
  float band = 0.5 + 0.5 * sin((uv.x + uv.y) * 12.0 + phase);
  return vec4(uv.x, uv.y * band, band, 1.0);
}`;

const SKIA_EFFECT = Skia.RuntimeEffect.Make(SHADER_SRC);

const SLOT_CX = Array.from({ length: 12 }, () => makeMutable(0));
const SLOT_CY = Array.from({ length: 12 }, () => makeMutable(0));

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

const PATH_D =
  'M10 60 C 40 10, 90 10, 120 60 S 200 110, 230 60 L 230 110 Q 120 150, 10 110 Z';

function TgfxScene({ name, w, h }: { name: SceneName; w: number; h: number }) {
  switch (name) {
    case 'circles': {
      const out = [];
      for (let i = 0; i < 24; i++) {
        const col = i % 6;
        const row = Math.floor(i / 6);
        out.push(
          <TgfxCircle
            key={i}
            cx={(col + 0.5) * (w / 6)}
            cy={(row + 0.5) * (h / 4)}
            r={Math.min(w / 6, h / 4) * 0.36}
            color={hsl((i * 37) % 360, 70, 55)}
          />
        );
      }
      return <>{out}</>;
    }
    case 'rects':
      return (
        <>
          <TgfxRect x={0} y={0} width={w} height={h} color="#101820" />
          <TgfxRect x={8} y={8} width={w / 2 - 12} height={h / 2 - 12} color="#e5484d" />
          <TgfxRect x={w / 2 + 4} y={8} width={w / 2 - 12} height={h / 2 - 12} color="#30a46c" />
          <TgfxRect x={8} y={h / 2 + 4} width={w - 16} height={h / 2 - 12} color="#0091ff" />
        </>
      );
    case 'strokes':
      return (
        <>
          {[1, 2, 4, 8, 16].map((sw, i) => (
            <TgfxRect
              key={i}
              x={10 + i * (w / 5.5)}
              y={10 + i * 6}
              width={w / 6}
              height={h - 40 - i * 12}
              color="#ffb224"
              style="stroke"
              strokeWidth={sw}
            />
          ))}
        </>
      );
    case 'rrects':
      return (
        <>
          {[0, 4, 12, 28].map((r, i) => (
            <TgfxRoundedRect
              key={i}
              x={8 + (i % 2) * (w / 2)}
              y={8 + Math.floor(i / 2) * (h / 2)}
              width={w / 2 - 16}
              height={h / 2 - 16}
              r={r}
              color={hsl(i * 80, 65, 55)}
            />
          ))}
        </>
      );
    case 'ovals':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <TgfxOval
              key={i}
              x={8}
              y={8 + i * (h / 3)}
              width={w - 16 - i * 40}
              height={h / 3 - 16}
              color={hsl(i * 110 + 20, 70, 55)}
            />
          ))}
        </>
      );
    case 'lines':
      return (
        <>
          {(['butt', 'round', 'square'] as const).map((cap, i) => (
            <TgfxLine
              key={i}
              x1={20}
              y1={20 + i * (h / 3)}
              x2={w - 20}
              y2={20 + i * (h / 3) + 30}
              color="#f5f5f5"
              style="stroke"
              strokeWidth={12}
              strokeCap={cap}
            />
          ))}
        </>
      );
    case 'path':
      return (
        <TgfxGroup transform={[{ scale: Math.min(w / 240, h / 160) }]}>
          <TgfxPath path={PATH_D} color="#8e4ec6" />
        </TgfxGroup>
      );
    case 'lingrad':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxPaint>
            <TgfxLinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: w, y: h }}
              colors={['#ff0000', '#00ff00', '#0000ff']}
            />
          </TgfxPaint>
        </TgfxRect>
      );
    case 'radgrad':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxPaint>
            <TgfxRadialGradient
              center={{ x: w / 2, y: h / 2 }}
              r={Math.min(w, h) / 2}
              colors={['#ffffff', '#0091ff', '#00000000']}
            />
          </TgfxPaint>
        </TgfxRect>
      );
    case 'opacity':
      return (
        <>
          <TgfxRect x={0} y={0} width={w} height={h} color="#202020" />
          <TgfxCircle cx={w * 0.38} cy={h * 0.5} r={Math.min(w, h) * 0.3} color="#e5484d" opacity={0.5} />
          <TgfxCircle cx={w * 0.62} cy={h * 0.5} r={Math.min(w, h) * 0.3} color="#0091ff" opacity={0.5} />
        </>
      );
    case 'transform':
      return (
        <TgfxGroup
          origin={{ x: w / 2, y: h / 2 }}
          transform={[{ rotate: Math.PI / 6 }, { scale: 0.8 }]}
        >
          <TgfxRect x={w * 0.2} y={h * 0.2} width={w * 0.6} height={h * 0.6} color="#30a46c" />
          <TgfxCircle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.2} color="#ffb224" />
        </TgfxGroup>
      );
    case 'sweep':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxSweepGradient
            c={{ x: w / 2, y: h / 2 }}
            colors={['#00ffff', '#ff00ff', '#ffff00', '#00ffff']}
          />
        </TgfxRect>
      );
    case 'noise':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxFractalNoise freqX={0.05} freqY={0.05} octaves={4} seed={0} />
        </TgfxRect>
      );
    case 'turb':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxTurbulence freqX={0.05} freqY={0.05} octaves={4} seed={0} />
        </TgfxRect>
      );
    case 'zorder': {
      // Deliberately overlapping shapes of DIFFERENT kinds, so any reordering
      // of draw commands for batching shows up as a wrong stacking order.
      const out = [];
      for (let i = 0; i < 10; i++) {
        const x = 10 + i * (w - 120) / 10;
        const y = 10 + i * (h - 140) / 10;
        const c = hsl(i * 36, 80, 50);
        if (i % 3 === 0) {
          out.push(<TgfxRect key={i} x={x} y={y} width={110} height={110} color={c} />);
        } else if (i % 3 === 1) {
          out.push(<TgfxCircle key={i} cx={x + 55} cy={y + 55} r={55} color={c} />);
        } else {
          out.push(
            <TgfxRoundedRect key={i} x={x} y={y} width={110} height={110} r={18} color={c} />
          );
        }
      }
      return <>{out}</>;
    }
    case 'slots':
      return (
        <>
          {SLOT_CX.map((cx, i) => (
            <TgfxCircle key={i} cx={cx} cy={SLOT_CY[i]} r={h * 0.11} color={hsl(i * 30, 75, 55)} />
          ))}
        </>
      );
    case 'shader':
      return (
        <TgfxRect x={0} y={0} width={w} height={h}>
          <TgfxShader source={SHADER_SRC} uniforms={{ size: [w, h], phase: 1.5 }} />
        </TgfxRect>
      );
    default:
      return null;
  }
}

function SkiaScene({ name, w, h }: { name: SceneName; w: number; h: number }) {
  switch (name) {
    case 'circles': {
      const out = [];
      for (let i = 0; i < 24; i++) {
        const col = i % 6;
        const row = Math.floor(i / 6);
        out.push(
          <SkiaCircle
            key={i}
            cx={(col + 0.5) * (w / 6)}
            cy={(row + 0.5) * (h / 4)}
            r={Math.min(w / 6, h / 4) * 0.36}
            color={hsl((i * 37) % 360, 70, 55)}
          />
        );
      }
      return <>{out}</>;
    }
    case 'rects':
      return (
        <>
          <SkiaRect x={0} y={0} width={w} height={h} color="#101820" />
          <SkiaRect x={8} y={8} width={w / 2 - 12} height={h / 2 - 12} color="#e5484d" />
          <SkiaRect x={w / 2 + 4} y={8} width={w / 2 - 12} height={h / 2 - 12} color="#30a46c" />
          <SkiaRect x={8} y={h / 2 + 4} width={w - 16} height={h / 2 - 12} color="#0091ff" />
        </>
      );
    case 'strokes':
      return (
        <>
          {[1, 2, 4, 8, 16].map((sw, i) => (
            <SkiaRect
              key={i}
              x={10 + i * (w / 5.5)}
              y={10 + i * 6}
              width={w / 6}
              height={h - 40 - i * 12}
              color="#ffb224"
              style="stroke"
              strokeWidth={sw}
            />
          ))}
        </>
      );
    case 'rrects':
      return (
        <>
          {[0, 4, 12, 28].map((r, i) => (
            <SkiaRoundedRect
              key={i}
              x={8 + (i % 2) * (w / 2)}
              y={8 + Math.floor(i / 2) * (h / 2)}
              width={w / 2 - 16}
              height={h / 2 - 16}
              r={r}
              color={hsl(i * 80, 65, 55)}
            />
          ))}
        </>
      );
    case 'ovals':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <SkiaOval
              key={i}
              x={8}
              y={8 + i * (h / 3)}
              width={w - 16 - i * 40}
              height={h / 3 - 16}
              color={hsl(i * 110 + 20, 70, 55)}
            />
          ))}
        </>
      );
    case 'lines':
      return (
        <>
          {(['butt', 'round', 'square'] as const).map((cap, i) => (
            <SkiaLine
              key={i}
              p1={vec(20, 20 + i * (h / 3))}
              p2={vec(w - 20, 20 + i * (h / 3) + 30)}
              color="#f5f5f5"
              style="stroke"
              strokeWidth={12}
              strokeCap={cap}
            />
          ))}
        </>
      );
    case 'path':
      return (
        <SkiaGroup transform={[{ scale: Math.min(w / 240, h / 160) }]}>
          <SkiaPath path={PATH_D} color="#8e4ec6" />
        </SkiaGroup>
      );
    case 'lingrad':
      return (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaLinearGradient
            start={vec(0, 0)}
            end={vec(w, h)}
            colors={['#ff0000', '#00ff00', '#0000ff']}
          />
        </SkiaRect>
      );
    case 'radgrad':
      return (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaRadialGradient
            c={vec(w / 2, h / 2)}
            r={Math.min(w, h) / 2}
            colors={['#ffffff', '#0091ff', '#00000000']}
          />
        </SkiaRect>
      );
    case 'opacity':
      return (
        <>
          <SkiaRect x={0} y={0} width={w} height={h} color="#202020" />
          <SkiaCircle cx={w * 0.38} cy={h * 0.5} r={Math.min(w, h) * 0.3} color="#e5484d" opacity={0.5} />
          <SkiaCircle cx={w * 0.62} cy={h * 0.5} r={Math.min(w, h) * 0.3} color="#0091ff" opacity={0.5} />
        </>
      );
    case 'transform':
      return (
        <SkiaGroup
          origin={vec(w / 2, h / 2)}
          transform={[{ rotate: Math.PI / 6 }, { scale: 0.8 }]}
        >
          <SkiaRect x={w * 0.2} y={h * 0.2} width={w * 0.6} height={h * 0.6} color="#30a46c" />
          <SkiaCircle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.2} color="#ffb224" />
        </SkiaGroup>
      );
    case 'sweep':
      return (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaSweepGradient
            c={vec(w / 2, h / 2)}
            colors={['#00ffff', '#ff00ff', '#ffff00', '#00ffff']}
          />
        </SkiaRect>
      );
    case 'noise':
      return (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaFractalNoise freqX={0.05} freqY={0.05} octaves={4} seed={0} />
        </SkiaRect>
      );
    case 'turb':
      return (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaTurbulence freqX={0.05} freqY={0.05} octaves={4} seed={0} />
        </SkiaRect>
      );
    case 'zorder': {
      const out = [];
      for (let i = 0; i < 10; i++) {
        const x = 10 + i * (w - 120) / 10;
        const y = 10 + i * (h - 140) / 10;
        const c = hsl(i * 36, 80, 50);
        if (i % 3 === 0) {
          out.push(<SkiaRect key={i} x={x} y={y} width={110} height={110} color={c} />);
        } else if (i % 3 === 1) {
          out.push(<SkiaCircle key={i} cx={x + 55} cy={y + 55} r={55} color={c} />);
        } else {
          out.push(
            <SkiaRoundedRect key={i} x={x} y={y} width={110} height={110} r={18} color={c} />
          );
        }
      }
      return <>{out}</>;
    }
    case 'slots':
      return (
        <>
          {SLOT_CX.map((cx, i) => (
            <SkiaCircle key={i} cx={cx} cy={SLOT_CY[i]} r={h * 0.11} color={hsl(i * 30, 75, 55)} />
          ))}
        </>
      );
    case 'shader':
      return SKIA_EFFECT == null ? null : (
        <SkiaRect x={0} y={0} width={w} height={h}>
          <SkiaShader source={SKIA_EFFECT} uniforms={{ size: [w, h], phase: 1.5 }} />
        </SkiaRect>
      );
    default:
      return null;
  }
}

export function Parity() {
  const { width, height } = useWindowDimensions();
  const ratio = PixelRatio.get();
  const top = 40;
  const gap = 8;
  const w = Math.floor(width - 16);
  const h = Math.floor(Math.min(w * 0.66, (height - top - gap - 40) / 2));
  const x = 8;
  const yTgfx = top;
  const ySkia = top + h + gap;

  const [idx, setIdx] = useState(0);
  const done = idx >= SCENES.length;
  const name = SCENES[Math.min(idx, SCENES.length - 1)];

  useEffect(() => {
    SLOT_CX.forEach((sv, i) => {
      sv.value = ((i % 4) + 0.5) * (w / 4);
      SLOT_CY[i].value = (Math.floor(i / 4) + 0.5) * (h / 3);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);

  useEffect(() => {
    console.log(
      `PARITY_LAYOUT ratio=${ratio} x=${Math.round(x * ratio)} w=${Math.round(w * ratio)} ` +
        `h=${Math.round(h * ratio)} yTgfx=${Math.round(yTgfx * ratio)} ySkia=${Math.round(ySkia * ratio)}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (done) {
      console.log('PARITY_DONE');
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + 1), HOLD_MS);
    console.log(`PARITY_SCENE name=${name} index=${idx + 1}/${SCENES.length}`);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done]);

  return (
    <View style={st.root}>
      {!done && (
        <>
          <View style={[st.canvas, { left: x, top: yTgfx, width: w, height: h }]}>
            <TgfxCanvas style={{ width: w, height: h }}>
              <TgfxScene name={name} w={w} h={h} />
            </TgfxCanvas>
          </View>
          <View style={[st.canvas, { left: x, top: ySkia, width: w, height: h }]}>
            <SkiaCanvas style={{ width: w, height: h }}>
              <SkiaScene name={name} w={w} h={h} />
            </SkiaCanvas>
          </View>
        </>
      )}
      <Text style={[st.label, { top: ySkia + h + 4 }]}>
        {done ? 'PARITY_DONE' : `${name} ${idx + 1}/${SCENES.length}`}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  canvas: { position: 'absolute', backgroundColor: '#000' },
  label: { position: 'absolute', left: 8, color: '#666', fontSize: 11 },
});
