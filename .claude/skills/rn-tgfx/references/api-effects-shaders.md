# Effects and shaders

Paint effects and shaders are **children** of a drawing or of `<Paint>`. A
`<Paint>` child on a `<Group>` supplies inherited defaults. Masks and backdrops
are drawing nodes; dash and corner effects are children of `<Path>`.

## Blend modes

`blendMode` on any drawing or `<Paint>`:

```tsx
<Circle cx={80} cy={70} r={45} color="#f2c088" />
<Circle cx={120} cy={70} r={45} color="#6aa9ff" blendMode="multiply" />
```

`BlendMode` covers the Skia set — `clear`, `src`, `dst`, `srcOver` (default),
`dstOver`, `srcIn`, `dstIn`, `srcOut`, `dstOut`, `srcATop`, `dstATop`, `xor`,
`plusLighter`, `modulate`, `screen`, `overlay`, `darken`, `lighten`,
`colorDodge`, `colorBurn`, `hardLight`, `softLight`, `difference`, `exclusion`,
`multiply`, `hue`, `saturation`, `color`, `luminosity`, `plusDarker` — 30 in
all. A name outside the union silently falls back to `srcOver`.

## Color filters

```tsx
<Image image={photo} x={0} y={0} width={200} height={200} fit="cover">
  <ColorMatrix matrix={GREYSCALE} />
</Image>
```

- `<ColorMatrix matrix={Animated<number>[]} ref?>` — 4×5 row-major, applied as
  `R' = a*R + b*G + c*B + d*A + e` per channel, then clamped. Anything but
  exactly 20 numbers is treated as the identity. Each entry is animatable and a
  `ref` patches the whole matrix in place.
- `<BlendColor color mode? ref?>` — blends `color` (src) with the drawing (dst);
  `mode` defaults to `'srcOver'`.
- `<Luma />` — replaces every color with its luminance, carried into alpha.

```tsx
<Path path="M20 80 L80 20 L140 80 L80 140 Z" color="#ffffff">
  <BlendColor color="#e0533d" mode="src" />
</Path>
```

## Blur and shadow

```tsx
<Circle cx={100} cy={100} r={40} color="#6aa9ff">
  <Blur blur={12} />
</Circle>

<RoundedRect x={30} y={25} width={160} height={100} r={16} color="#f5f7fa">
  <DropShadow dx={0} dy={6} blur={8} color="rgba(0,0,0,0.45)" />
</RoundedRect>
```

`BlurProps`: `blur` (sigma, both axes), `blurX`/`blurY` (override per axis),
`tileMode` (defaults `'decal'`), `ref`. All animatable.

`DropShadowProps`: `dx`, `dy`, `blur`, `blurX`, `blurY`, `color`, `shadowOnly`
(drop the content that cast it), `inner` (cast inside the shape), `ref`.

```tsx
glow.set({ blur: 4 + press.value * 12, dy: 2 + press.value * 6 })
```

## Gradients and noise

All gradients share `GradientStops`: `colors: Color[]`, `positions?:
Animated<number>[]` (0..1), `ref?`.

| Component | Extra props |
| --- | --- |
| `<LinearGradient>` | `start`, `end` — each `{ x: Animated<number>, y: Animated<number> }` |
| `<RadialGradient>` | `center`, `r` |
| `<SweepGradient>` | `c` (alias `center`), `start`, `end` — angular degrees, default a full 0–360 turn |
| `<DiamondGradient>` | as radial |
| `<ColorShader color>` | a solid color as a shader, for `<Blend>` inputs |
| `<FractalNoise>` / `<Turbulence>` | `freqX`, `freqY`, `octaves`, `seed` |

```tsx
<Rect x={0} y={0} width={300} height={140}>
  <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 300, y: 0 }} colors={['#d98a4a', '#6aa9ff']} />
</Rect>

fade.set({ end: { x: drag.x, y: 0 }, positions: [0, t] })
```

A handle keeps at most **16 gradient stops** live; a longer imperative stop list
is truncated.

### `<Blend>`

Folds its shader children left to right: the first is the destination, each next
blends over it. A shader *source*, not a paint filter.

```tsx
<Rect x={0} y={0} width={256} height={256}>
  <Blend mode="multiply">
    <RadialGradient center={{ x: 128, y: 128 }} r={128} colors={['blue', 'yellow']} />
    <Turbulence freqX={0.05} freqY={0.05} octaves={4} />
  </Blend>
</Rect>
```

## Backdrops — `<BackdropBlur>` and `<Glass>`

They read the pixels **already drawn beneath them**, so the node must come after
the content it frosts, and the region is its own rect.

```tsx
<Image image={photo} x={0} y={0} width={300} height={200} />
<BackdropBlur x={20} y={40} width={260} height={120} r={24} blur={16} />
<Glass x={20} y={40} width={260} height={120} r={24} refraction={40} depth={20} frost={30} dispersion={0} />
```

The panel is sampled, not painted: of the inherited paint only `opacity`,
`visible`, `ref` and the **alpha** of `color` apply — its RGB, the stroke props
and any paint or shader child are ignored. A backdrop has no hit bounds, so it
is never pressable. `r` is static (no slot); every material number is a slot.

`GlassProps` drops `blur` (it frosts with `frost`) and adds `refraction` (edge
refraction strength, default 40), `depth` (how far refraction reaches in from
the edge, default 20), `frost` (background frost, default 20), `dispersion`
(chromatic aberration at the edge, default 0), plus the three that light it:
`splay` (0 follows the edge curvature, 100 aims at the panel centre, default 0),
`lightAngle` (degrees, 0 straight above, positive clockwise, −179 to 180,
default 45) and `lightIntensity` (0–100, default 50; 0 removes the highlight and
leaves refraction and frost). Together they are all of tgfx's `GlassStyle`.

---

# Runtime shaders — `<Shader>`

`<Shader>` accepts the SkSL subset tgfx supports, transpiles it while the scene
is compiled, and creates the runtime shader natively.

```ts
interface ShaderProps {
  ref?: NodeHandle
  source: string
  uniforms?: Record<string, UniformValue>   // Animated<number> | Array<Animated<number>>
  children?: ReactNode                       // one per `uniform shader`, in order
}
```

```tsx
const source = `
uniform float2 uSize;
half4 main(float2 pos) {
  float2 uv = pos / uSize;
  return half4(uv.x, uv.y, 0.6, 1.0);
}
`

<Canvas style={{ width: 300, height: 140 }}>
  <Fill>
    <Shader source={source} uniforms={{ uSize: [300, 140] }} />
  </Fill>
</Canvas>
```

`main` receives the position in **local space** and returns a premultiplied
`half4`.

## The supported subset — hard rules

These are enforced by the transpiler, and each one has a specific error message.

1. **Entry point** must match `half4 | float4 | vec4  main(float2 | half2 | vec2 pos)`.
2. **Every declaration goes above `main()`.** Only what precedes `main` is
   lifted; a helper below it is dropped and compilation fails with
   `declarations must come before main(), found after it`.
3. **One name per statement** above `main`. `float a = 1.0, b = 2.0;` is
   rejected — the second name would silently collide.
4. **Uniform types**: `half`, `half2..4`, `float`, `float2..4`, `vec2..4`,
   `int`, `float2x2`, `float3x3`, `float4x4`, and `shader`. **No arrays** —
   `uniform float k[4];` fails with
   `only scalar, vector and square-matrix uniforms are supported, not arrays`.
5. **A `uniform shader` child may only appear as `name.eval(coord)` or
   `sample(name, coord)`.** Any other mention of the name is an error. Helper
   functions above `main` *may* sample children — the rewrite covers them.
6. **Shader children are matched by declaration order**, one child per `uniform
   shader`. A count mismatch throws at commit:
   `the source declares 1 'uniform shader' (img) but 0 shader children were given`.
7. It compiles to **GLSL ES**, so: loop bounds must be compile-time constants,
   `smoothstep(edge0, edge1, x)` needs `edge0 < edge1` (a falling edge is
   undefined), use `mod()` not `%`, and integer/float types do not mix.
8. `half` becomes `float` and `halfN`/`floatN` become `vecN` in the output —
   write either spelling.
9. The `pos` parameter is bound at `highp`; GL ES `mediump` would quantize pixel
   coordinates past 1024.

Transpiled sources are cached (64 entries), so keep shader strings **module-level
constants**, never built inline per render.

## Uniforms and animation

A `SharedValue` uniform becomes an animation slot the native engine patches on
the UI thread — no JS per frame. `useClock()` is a `SharedValue<number>` of
seconds since its first frame callback.

```tsx
const t = useClock()

<Fill>
  <Shader source={source} uniforms={{ uTime: t, uSize: [width, height] }} />
</Fill>
```

A **plain number** uniform is snapshotted at commit time, so advancing it
re-encodes the scene. That is fine for a demo tick, not for 60 fps.

A `ref` on `<Shader>` makes its uniforms live from the first compile (a shader
ref has no other job), so imperative patching is a pure slot write:

```tsx
fx.set({ uniforms: { uFace: [face.x, face.y], uRadius: face.width / 2 } })
```

The uniform pool holds **32 floats**; uniforms outside it fall back to
re-encoding.

## Shader inputs

```tsx
const source = `
uniform shader img;
uniform float uShift;

half4 main(float2 pos) {
  half4 base = img.eval(pos);
  half4 red = img.eval(pos + float2(uShift, 0.0));
  half4 blue = sample(img, pos - float2(uShift, 0.0));
  return half4(red.r, base.g, blue.b, base.a);
}
`

<Shader source={source} uniforms={{ uShift: 4 }}>
  <ImageShader image={image} fit="cover" rect={{ x: 0, y: 0, width: 300, height: 200 }} />
</Shader>
```

Any shader works as an input, not just images:

```tsx
<Shader source={banded}>
  <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 300, y: 0 }} colors={['#2b6cff', '#ff3b6b']} />
</Shader>
```

---

## Complex shader: multi-child camera grade

A production-shaped shader — two shader children, helper functions that sample
one of them, a matrix uniform, animated uniforms, and every GLSL ES constraint
respected. This is the shape to reach for when a single `eval` is not enough.

```tsx
import {
  CameraFrame, Canvas, Fill, ImageShader, LinearGradient, Shader,
  useCameraFrame, useClock, useNode,
} from 'react-native-tgfx'

// Module-level constant: the transpile result is cached by source string.
const GRADE = `
uniform shader cam;        // child 0 — the camera frame
uniform shader ramp;       // child 1 — a gradient used as a colour ramp
uniform float2 uSize;
uniform float uTime;
uniform float uEdge;
uniform float uAberration;
uniform float uGrain;
uniform float3x3 uMatrix;  // saturation / channel mix

float luma(half4 c) {
  return dot(c.rgb, half3(0.2126, 0.7152, 0.0722));
}

// Helpers may sample a child: the rewrite covers the preamble too.
float sobel(float2 pos, float step) {
  float gx = luma(cam.eval(pos + float2(step, 0.0))) -
             luma(cam.eval(pos - float2(step, 0.0)));
  float gy = luma(cam.eval(pos + float2(0.0, step))) -
             luma(cam.eval(pos - float2(0.0, step)));
  return sqrt(gx * gx + gy * gy);
}

// Chromatic split: three taps, offset along the radius from centre.
half3 aberrate(float2 pos, float2 centre, float amount) {
  float2 dir = normalize(pos - centre + float2(0.0001, 0.0001));
  half3 outc = half3(0.0, 0.0, 0.0);
  outc.r = cam.eval(pos + dir * amount).r;
  outc.g = cam.eval(pos).g;
  outc.b = cam.eval(pos - dir * amount).b;
  return outc;
}

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 pos) {
  float2 centre = uSize * 0.5;
  float2 uv = pos / uSize;

  half3 base = aberrate(pos, centre, uAberration);

  // Constant bounds: GLSL ES will not unroll a loop it cannot size.
  float edge = 0.0;
  for (int i = 1; i <= 3; i++) {
    edge += sobel(pos, float(i) * 1.3);
  }
  edge = clamp(edge / 3.0 * uEdge, 0.0, 1.0);

  // The ramp is a gradient shader; sample it by luminance across its width.
  float key = clamp(luma(half4(base, 1.0)), 0.0, 1.0);
  half3 tint = ramp.eval(float2(key * uSize.x, 0.0)).rgb;

  half3 graded = half3(uMatrix * float3(mix(base, tint, 0.55)));
  graded += half3(0.25, 1.0, 0.95) * edge * 0.9;

  // Rising edges only: smoothstep with edge0 > edge1 is undefined in GLSL ES.
  float vig = 1.0 - smoothstep(0.38, 1.10, length(uv - 0.5));
  graded *= 0.45 + 0.55 * vig;

  float grain = hash(uv * uSize + uTime * 60.0) - 0.5;
  graded += half3(grain * uGrain);

  return half4(clamp(graded, 0.0, 1.0), 1.0);
}
`

// Row-major 3x3 fed as 9 floats: a mild saturation lift.
const SATURATE = [1.25, -0.15, -0.10, -0.10, 1.25, -0.15, -0.10, -0.15, 1.25]

export function GradedCamera({ image, posture }) {
  const clock = useClock()
  const fx = useNode()          // uniforms live from the first compile

  return (
    <Canvas style={StyleSheet.absoluteFill} opaque={true}>
      <CameraFrame image={image} {...posture}>
        {posture.width > 0 && (
          <Fill>
            <Shader
              ref={fx}
              source={GRADE}
              uniforms={{
                uSize: [posture.width, posture.height],
                uTime: clock,              // SharedValue → UI-thread slot
                uEdge: 6.5,
                uAberration: 2.0,
                uGrain: 0.06,
                uMatrix: SATURATE,
              }}
            >
              {/* order matters: cam, then ramp */}
              <ImageShader image={image} />
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: posture.width, y: 0 }}
                colors={['#120027', '#5b1d8a', '#ff8a3d', '#fff3c4']}
              />
            </Shader>
          </Fill>
        )}
      </CameraFrame>
    </Canvas>
  )
}

// Later, from a gesture worklet — a pure slot write, no re-encode:
// fx.set({ uniforms: { uEdge: 2 + drag.value * 10 } })
```

Why each piece is written that way:

- **`uniforms` count.** `uSize`(2) + `uTime`(1) + `uEdge`(1) + `uAberration`(1)
  + `uGrain`(1) + `uMatrix`(9) = 15 floats, inside the 32-float handle pool, so
  every one of them stays slot-patchable.
- **Helpers above `main`, one name per statement.** `luma`, `sobel`,
  `aberrate`, `hash` all precede `main`; moving any below it fails to compile.
- **`for (int i = 1; i <= 3; i++)`** — constant bounds so the driver can unroll.
- **`smoothstep(0.38, 1.10, …)`** — rising edge.
- **No tile mode on `<ImageShader>`** feeding a YUV frame.
- **`posture.width > 0` guard** — the first frame has not landed yet, and a
  zero `uSize` divides by zero.

## Shorter camera shader (from `apps/example`)

```tsx
const NEON_EDGE = `
uniform shader cam;
uniform float2 uSize;
uniform float uTime;

float luma(half4 c) {
  return dot(c.rgb, half3(0.2126, 0.7152, 0.0722));
}

half4 main(float2 pos) {
  float t = 1.7;

  float lo = luma(cam.eval(pos - float2(t, t)));
  float hi = luma(cam.eval(pos + float2(t, t)));
  float dirEdge = hi - lo;

  float gx = luma(cam.eval(pos + float2(t, 0.0))) -
             luma(cam.eval(pos - float2(t, 0.0)));
  float gy = luma(cam.eval(pos + float2(0.0, t))) -
             luma(cam.eval(pos - float2(0.0, t)));
  float mag = sqrt(gx * gx + gy * gy);

  half3 cyan = half3(0.25, 1.00, 0.95);
  half3 magenta = half3(1.00, 0.15, 0.90);
  half3 tint = mix(cyan, magenta, clamp(dirEdge * 7.0 + 0.5, 0.0, 1.0));

  float edge = pow(clamp(mag * 6.5, 0.0, 1.0), 0.70);

  half4 base = cam.eval(pos);
  half3 col = base.rgb * half3(0.14, 0.09, 0.28) + tint * edge * 1.45;

  col *= 0.93 + 0.07 * sin(uTime * 1.6);

  float2 uv = pos / uSize;
  float vig = 1.0 - smoothstep(0.38, 1.10, length(uv - 0.5));
  col *= 0.40 + 0.60 * vig;

  return half4(clamp(col, 0.0, 1.0), base.a);
}
`
```

## A shader cannot read what is under it

`<Shader>` has no access to the backdrop. To blur or distort *real content*
already drawn, use `<BackdropBlur>` / `<Glass>`, or put the content in an
`<ImageShader>` child and sample it. A "blur" written as a kernel inside a
shader can only blur what the shader itself evaluates.
