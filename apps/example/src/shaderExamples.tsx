import {
  ImageShader,
  LinearGradient,
  Rect,
  RoundedRect,
  Shader,
  useImage,
} from 'react-native-tgfx';

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
      float cx = floor(tap.x * 8.0);
      float cy = floor(tap.y * 8.0);
      float checker = mod(cx + cy, 2.0);
      float w = exp(-(float(i * i + j * j)) / 8.0);
      acc += checker * w;
      wsum += w;
    }
  }

  float v = acc / wsum;
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

  float horizon = 0.42;
  float3 col = float3(0.04, 0.02, 0.10);

  float sky = smoothstep(horizon, 0.0, uv.y);
  col = mix(col, float3(0.36, 0.05, 0.42), sky * 0.9);
  float2 sun = float2(0.5, horizon - 0.16);
  float sd = length((uv - sun) * float2(1.0, 1.6));
  float disc = smoothstep(0.15, 0.11, sd);
  float slice = step(0.35, fract(uv.y * 42.0));
  col = mix(col, float3(1.00, 0.45, 0.25), disc * slice);
  col += float3(0.9, 0.25, 0.5) * smoothstep(0.34, 0.12, sd) * 0.35;

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

  float edge = length(uv - float2(0.5, 0.5)) * 1.4;
  col.r *= 1.0 + edge * 0.35;
  col.b *= 1.0 + edge * 0.20;

  float scan = 0.90 + 0.10 * sin(uv.y * 380.0);
  float roll = 0.96 + 0.04 * sin((uv.y + uTime * 0.08) * 6.2831);
  col *= scan * roll;

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

/**
 * Child shaders. A `uniform shader` is a slot another shader fills, sampled
 * with `name.eval(coord)` or the equivalent `sample(name, coord)`. Children are
 * matched to declarations by order, and a child is a shader in its own right —
 * an image, a gradient, or another `<Shader>`.
 */
export const chromaticSource = `
uniform shader img;
uniform float uShift;

half4 main(float2 pos) {
  half4 base = img.eval(pos);
  half4 red = img.eval(pos + float2(uShift, 0.0));
  half4 blue = sample(img, pos - float2(uShift, 0.0));
  return half4(red.r, base.g, blue.b, base.a);
}
`;

/** No shift at all, so the child is drawn exactly where it would draw itself. */
export const passthroughSource = `
uniform shader src;
half4 main(float2 pos) { return src.eval(pos); }
`;

/** A gradient child, banded: children are not image-only. */
export const bandedSource = `
uniform shader ramp;
uniform float2 uOrigin;

half4 main(float2 pos) {
  half4 c = sample(ramp, pos);
  float band = step(0.5, fract((pos.y - uOrigin.y) / 12.0));
  return half4(c.rgb * half(0.45 + 0.55 * band), c.a);
}
`;

/**
 * Two children on one shader, mixed by a diagonal wipe. Each wrapper is emitted
 * at file scope, so the two have to be named apart or the second redefines the
 * first, the driver rejects the program and the shape paints nothing.
 */
export const twoChildSource = `
uniform shader img;
uniform shader ramp;
uniform float2 uOrigin;
uniform float2 uSize;

half4 main(float2 pos) {
  float2 uv = (pos - uOrigin) / uSize;
  return uv.x + uv.y < 1.0 ? img.eval(pos) : sample(ramp, pos);
}
`;

const childSample = require('./assets/sample.png');

/**
 * Four panels in one scene, which is the point: two runtime shaders with
 * children must not reach each other's child, and `eval` and `sample` must
 * agree. Left to right — the image drawn straight through a child, the same
 * child with the channels pulled apart, a gradient child banded, and one shader
 * holding two children at once.
 */
export function ChildShaderPanels({ x, y, width, height }: Box) {
  const img = useImage(childSample);
  const cell = (width - 24) / 4;
  const left = [x, x + cell + 8, x + 2 * (cell + 8), x + 3 * (cell + 8)];
  if (img == null) {
    return null;
  }
  const rect = (at: number) => ({ x: at, y, width: cell, height });
  return (
    <>
      <Rect x={left[0]} y={y} width={cell} height={height}>
        <Shader source={passthroughSource}>
          <ImageShader image={img} fit="cover" rect={rect(left[0]!)} />
        </Shader>
      </Rect>
      <Rect x={left[1]} y={y} width={cell} height={height}>
        <Shader source={chromaticSource} uniforms={{ uShift: 5 }}>
          <ImageShader image={img} fit="cover" rect={rect(left[1]!)} />
        </Shader>
      </Rect>
      <Rect x={left[2]} y={y} width={cell} height={height}>
        <Shader source={bandedSource} uniforms={{ uOrigin: [0, y] }}>
          <LinearGradient
            start={{ x: left[2]!, y: 0 }}
            end={{ x: left[2]! + cell, y: 0 }}
            colors={['#2b6cff', '#ff3b6b']}
          />
        </Shader>
      </Rect>
      <Rect x={left[3]} y={y} width={cell} height={height}>
        <Shader
          source={twoChildSource}
          uniforms={{ uOrigin: [left[3]!, y], uSize: [cell, height] }}
        >
          <ImageShader image={img} fit="cover" rect={rect(left[3]!)} />
          <LinearGradient
            start={{ x: left[3]!, y: 0 }}
            end={{ x: left[3]! + cell, y: 0 }}
            colors={['#2b6cff', '#ff3b6b']}
          />
        </Shader>
      </Rect>
    </>
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
