/**
 * Runtime shader examples: `<Shader source uniforms>` takes SkSL and runs it as
 * the paint's shader, so the whole shape is filled by the fragment program.
 *
 * Three things about this API are worth knowing before writing your own, and
 * all three are load-bearing for the shaders below:
 *
 * 1. `main` receives the *device pixel* position, not a 0..1 uv and not a dp
 *    coordinate. Normalise it yourself against uniforms you pass in, scaled by
 *    `PixelRatio.get()`, or the effect drifts on every device with a different
 *    density.
 * 2. Helper functions are not supported. The transpiler splices everything
 *    before `main` into `main`'s body, and GLSL ES has no nested functions, so
 *    a `float noise(vec2 p) {...}` above `main` fails to compile. Everything
 *    here is inlined, and loops carry constant bounds for the same reason.
 * 3. There is no `sample()` and no child shaders, so a shader cannot read the
 *    pixels behind it. A true backdrop blur is therefore not expressible — see
 *    `blurSource` below for what is.
 */
import { PixelRatio } from 'react-native';
import { Rect, RoundedRect, Shader } from 'react-native-tgfx';

const scale = PixelRatio.get();

/** dp -> device px, which is the space `main`'s argument is in. */
const px = (dp: number) => dp * scale;

/**
 * A real separable-kernel blur — of a procedurally generated pattern, not of
 * the backdrop.
 *
 * The kernel is genuine: 81 taps on a Gaussian weight, and raising `uRadius`
 * visibly softens the checker edges. What it blurs is a checkerboard evaluated
 * inline per tap, because the shader has no way to read what is underneath it.
 * If you need to blur real content, do it in the image pipeline instead.
 */
export const blurSource = `
uniform float2 uOrigin;
uniform float2 uSize;
uniform float uRadius;

float4 main(float2 pos) {
  float2 uv = (pos - uOrigin) / uSize;

  float acc = 0.0;
  float wsum = 0.0;
  // Constant bounds: GLSL ES will not unroll a loop it cannot size.
  for (int i = -4; i <= 4; i++) {
    for (int j = -4; j <= 4; j++) {
      float2 tap = uv + float2(float(i), float(j)) * uRadius / uSize;
      // The signal being blurred: an 8x8 checkerboard.
      float cx = floor(tap.x * 8.0);
      float cy = floor(tap.y * 8.0);
      float checker = mod(cx + cy, 2.0);
      float w = exp(-(float(i * i + j * j)) / 8.0);
      acc += checker * w;
      wsum += w;
    }
  }

  float v = acc / wsum;
  // Tint it so the blur is legible as a gradient rather than flat grey.
  float3 cool = float3(0.20, 0.45, 0.95);
  float3 warm = float3(0.98, 0.42, 0.62);
  return float4(mix(cool, warm, v), 1.0);
}
`;

/**
 * Cyberpunk display: neon grid in perspective, scanlines, chromatic split at
 * the edges, and a vignette. All analytic — no texture reads.
 *
 * `uTime` is a uniform, and uniforms are snapshotted at commit time rather than
 * bound to an animation slot, so advancing it re-encodes the scene. That is
 * fine for a demo tick, but it is not the cheap path a `SharedValue` takes on
 * an animated `opacity` or `strokeWidth`.
 */
export const cyberpunkSource = `
uniform float2 uOrigin;
uniform float2 uSize;
uniform float uTime;

float4 main(float2 pos) {
  float2 uv = (pos - uOrigin) / uSize;

  // Horizon at 0.42; everything below it is the receding floor grid.
  float horizon = 0.42;
  float3 col = float3(0.04, 0.02, 0.10);

  // Sky: magenta-to-indigo wash with a sun disc.
  float sky = smoothstep(horizon, 0.0, uv.y);
  col = mix(col, float3(0.36, 0.05, 0.42), sky * 0.9);
  float2 sun = float2(0.5, horizon - 0.16);
  float sd = length((uv - sun) * float2(1.0, 1.6));
  float disc = smoothstep(0.15, 0.11, sd);
  // Slice the sun with horizontal gaps, the genre's whole visual signature.
  float slice = step(0.35, fract(uv.y * 42.0));
  col = mix(col, float3(1.00, 0.45, 0.25), disc * slice);
  col += float3(0.9, 0.25, 0.5) * smoothstep(0.34, 0.12, sd) * 0.35;

  // Floor grid: project so lines converge toward the horizon.
  if (uv.y > horizon) {
    float depth = 1.0 / max(uv.y - horizon, 0.001);
    float gx = fract((uv.x - 0.5) * depth * 0.35);
    float gz = fract(depth * 0.55 - uTime * 0.55);
    float lx = smoothstep(0.04, 0.0, min(gx, 1.0 - gx));
    float lz = smoothstep(0.06, 0.0, min(gz, 1.0 - gz));
    float fade = smoothstep(1.6, 0.05, depth * 0.1);
    col += float3(0.15, 0.95, 0.95) * lx * fade * 0.9;
    col += float3(0.95, 0.20, 0.75) * lz * fade * 0.9;
  }

  // Chromatic aberration: shift the channel weights toward the edges.
  float edge = length(uv - float2(0.5, 0.5)) * 1.4;
  col.r *= 1.0 + edge * 0.35;
  col.b *= 1.0 + edge * 0.20;

  // CRT scanlines plus a slow horizontal roll.
  float scan = 0.90 + 0.10 * sin(uv.y * 380.0);
  float roll = 0.96 + 0.04 * sin((uv.y + uTime * 0.08) * 6.2831);
  col *= scan * roll;

  // Vignette.
  col *= smoothstep(1.25, 0.35, edge);

  return float4(col, 1.0);
}
`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Blur demo. `radius` is kernel spacing in dp, like every other prop here. */
export function BlurPanel({
  x,
  y,
  width,
  height,
  radius = 2.5,
}: Box & { radius?: number }) {
  return (
    <RoundedRect x={x} y={y} width={width} height={height} r={14}>
      <Shader
        source={blurSource}
        uniforms={{
          uOrigin: [px(x), px(y)],
          uSize: [px(width), px(height)],
          uRadius: px(radius),
        }}
      />
    </RoundedRect>
  );
}

/** Cyberpunk demo. `time` advances the grid and the CRT roll. */
export function CyberpunkPanel({
  x,
  y,
  width,
  height,
  time = 0,
}: Box & { time?: number }) {
  return (
    <RoundedRect x={x} y={y} width={width} height={height} r={14}>
      <Shader
        source={cyberpunkSource}
        uniforms={{
          uOrigin: [px(x), px(y)],
          uSize: [px(width), px(height)],
          uTime: time,
        }}
      />
    </RoundedRect>
  );
}

/**
 * Sharp reference next to the blur, so the kernel's effect is visible.
 *
 * Reusing `blurSource` at `uRadius: 0` is deliberate — the program key hashes
 * the shader body, so both panels share one compiled program. The 81 taps then
 * all land on the same uv; fine for one small panel, not for a hot path.
 */
export function CheckerReference({ x, y, width, height }: Box) {
  return (
    <Rect x={x} y={y} width={width} height={height}>
      <Shader
        source={blurSource}
        uniforms={{
          uOrigin: [px(x), px(y)],
          uSize: [px(width), px(height)],
          uRadius: 0,
        }}
      />
    </Rect>
  );
}
