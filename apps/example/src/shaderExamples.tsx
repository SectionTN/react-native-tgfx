/**
 * Runtime shader examples: `<Shader source uniforms>` takes SkSL and runs it as
 * the paint's shader, so the whole shape is filled by the fragment program.
 *
 * Three things about this API are worth knowing before writing your own, and
 * all three are load-bearing for the shaders below:
 *
 * 1. `main` receives the position in *layout points*, the same units the shape
 *    is laid out in, not a 0..1 uv. The native side scales the canvas by the
 *    display density before drawing, so pass sizes straight through: scaling
 *    them by `PixelRatio.get()` makes every uniform too large by that factor
 *    and the effect only covers a fraction of the shape.
 * 2. Helper functions declared above `main` are supported: they are emitted at
 *    file scope, not spliced into `main`, and their names are mangled natively
 *    so two shaders may declare the same helper. Loops still need constant
 *    bounds. See `sdCircleSource` and `helperCollisionSources` below.
 * 3. There is no `sample()` and no child shaders, so a shader cannot read the
 *    pixels behind it. A true backdrop blur is therefore not expressible — see
 *    `blurSource` below for what is.
 */
import { Rect, RoundedRect, Shader } from 'react-native-tgfx';

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
          uOrigin: [x, y],
          uSize: [width, height],
          uRadius: radius,
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
          uOrigin: [x, y],
          uSize: [width, height],
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
          uOrigin: [x, y],
          uSize: [width, height],
          uRadius: 0,
        }}
      />
    </Rect>
  );
}

/**
 * The plainest helper-function shader there is: a signed distance function
 * declared above `main` and called from it.
 *
 * Before helper support this compiled to a `float sdCircle(...)` nested inside
 * the generated `tgfxRuntimeMain`, which GLSL ES rejects — the shape simply did
 * not paint, with no JavaScript error. `RADIUS` is here on purpose: a top-level
 * `const` has to be lifted alongside the helper, or the helper cannot see it.
 */
export const sdCircleSource = `
uniform float2 uOrigin;
uniform float2 uSize;

const float RADIUS = 0.35;

float sdCircle(float2 p, float r) {
  return length(p) - r * RADIUS;
}

half4 main(float2 pos) {
  float2 local = pos - uOrigin - uSize * 0.5;
  float d = sdCircle(local, min(uSize.x, uSize.y));
  float edge = 1.0 - smoothstep(-1.5, 1.5, d);
  return half4(half3(0.15, 0.55, 0.95) * edge, edge);
}
`;

/**
 * Two shaders that each declare a helper called `tint`, meaning opposite
 * things. Drawn side by side they must stay their own colour: the compiled
 * program is keyed on the preamble as well as the body, and the helper name is
 * mangled per processor.
 */
export const helperCollisionSources = [
  `
uniform float2 uOrigin;
uniform float2 uSize;
float tint(float v) { return v; }
half4 main(float2 pos) {
  float v = tint((pos.x - uOrigin.x) / uSize.x);
  return half4(v, 0.25, 0.35, 1.0);
}
`,
  `
uniform float2 uOrigin;
uniform float2 uSize;
float tint(float v) { return 1.0 - v; }
half4 main(float2 pos) {
  float v = tint((pos.x - uOrigin.x) / uSize.x);
  return half4(0.25, 0.35, v, 1.0);
}
`,
] as const;

/** A circle drawn by a signed distance function in a helper. */
export function SdCirclePanel({ x, y, width, height }: Box) {
  return (
    <Rect x={x} y={y} width={width} height={height}>
      <Shader
        source={sdCircleSource}
        uniforms={{ uOrigin: [x, y], uSize: [width, height] }}
      />
    </Rect>
  );
}

/** The two same-named-helper shaders, side by side in one scene. */
export function HelperCollisionPanels({ x, y, width, height }: Box) {
  const half = width / 2 - 4;
  return (
    <>
      {helperCollisionSources.map((source, index) => {
        const left = x + index * (half + 8);
        return (
          <RoundedRect
            key={source}
            x={left}
            y={y}
            width={half}
            height={height}
            r={10}
          >
            <Shader
              source={source}
              uniforms={{ uOrigin: [left, y], uSize: [half, height] }}
            />
          </RoundedRect>
        );
      })}
    </>
  );
}
