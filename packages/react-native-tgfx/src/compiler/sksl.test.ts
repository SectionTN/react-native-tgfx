import { expect, test } from 'bun:test'
import { transpileShader } from './sksl'

const PLAIN = `
uniform float2 uSize;
half4 main(float2 pos) {
  return half4(pos.x / uSize.x, 0.0, 0.0, 1.0);
}
`

test('a source with no child is unchanged and reports none', () => {
  const t = transpileShader(PLAIN)
  expect(t.childNames).toEqual([])
  expect(t.uniformNames).toEqual(['uSize'])
  expect(t.body).not.toContain('TGFX_CHILD')
})

test('the parse is cached, so a hot commit path does not re-parse', () => {
  const a = transpileShader(PLAIN)
  const b = transpileShader(PLAIN)
  expect(a).toBe(b)
})

test('a child shader is collected and its eval rewritten', () => {
  const t = transpileShader(`
uniform shader tex;
uniform float4 params;
half4 main(float2 xy) {
  half4 c = tex.eval(xy);
  return c;
}
`)
  expect(t.childNames).toEqual(['tex'])
  // A child is not a float uniform and must not consume a uniform slot.
  expect(t.uniformNames).toEqual(['params'])
  expect(t.body).toContain('TGFX_CHILD_0(xy)')
  expect(t.body).not.toContain('tex.eval')
})

test('several children are indexed in declaration order', () => {
  const t = transpileShader(`
uniform shader a;
uniform shader b;
half4 main(float2 p) {
  return a.eval(p) + b.eval(p);
}
`)
  expect(t.childNames).toEqual(['a', 'b'])
  expect(t.body).toContain('TGFX_CHILD_0(p)')
  expect(t.body).toContain('TGFX_CHILD_1(p)')
})

test('whitespace around eval is tolerated', () => {
  const t = transpileShader(`
uniform shader tex;
half4 main(float2 p) { return tex . eval ( p ); }
`)
  expect(t.body).toContain('TGFX_CHILD_0( p )')
})

// `sample(child, coord)` is the spelling most SkSL found elsewhere uses, and
// Skia treats it as exactly `child.eval(coord)`.
test('sample(child, coord) is the same thing as child.eval(coord)', () => {
  const alias = transpileShader(`
uniform shader tex;
half4 main(float2 p) { return sample(tex, p); }
`)
  const method = transpileShader(`
uniform shader tex;
half4 main(float2 p) { return tex.eval(p); }
`)
  expect(alias.body).toBe(method.body)
  expect(alias.body).toContain('TGFX_CHILD_0(p)')
})

test('sample() tolerates whitespace and reaches the preamble too', () => {
  const t = transpileShader(`
uniform shader a;
uniform shader b;
half4 tint(float2 p) { return sample( a , p ) * 0.5; }
half4 main(float2 p) { return tint(p) + sample(b, p); }
`)
  expect(t.preamble).toContain('TGFX_CHILD_0(p )')
  expect(t.body).toContain('TGFX_CHILD_1(p)')
})

test('a child used other than through eval is rejected, not silently emitted', () => {
  expect(() =>
    transpileShader(`
uniform shader tex;
half4 main(float2 p) { return half4(tex); }
`)
  ).toThrow(/may only be used as/)
})

test('a child named in a comment does not trip the eval-only guard', () => {
  const t = transpileShader(`
uniform shader tex;
half4 main(float2 p) {
  // tex is the backdrop we sample below
  return tex.eval(p); /* tex done */
}
`)
  expect(t.body).toContain('TGFX_CHILD_0(p)')
})

test('a commented-out uniform is not given a slot', () => {
  const t = transpileShader(`
// uniform float dead;
/* uniform float alsoDead; */
uniform float2 uSize;
half4 main(float2 p) { return half4(p / uSize, 0.0, 1.0); }
`)
  expect(t.uniformNames).toEqual(['uSize'])
})

test('an unsupported uniform type still throws', () => {
  expect(() =>
    transpileShader(`
uniform mat9 weird;
half4 main(float2 p) { return half4(0.0); }
`)
  ).toThrow(/unsupported uniform type/)
})

// GLSL ES has no nested functions, so a helper spliced into the body is a
// driver compile error at draw time and a shape that never paints.
test('a helper function is routed to the preamble, not into the body', () => {
  const t = transpileShader(`
float sdCircle(float2 p, float r) { return length(p) - r; }

half4 main(float2 pos) {
  return sdCircle(pos, 40.0) < 0.0 ? half4(1.0) : half4(0.0);
}
`)
  expect(t.functionNames).toEqual(['sdCircle'])
  expect(t.preamble).toContain('float sdCircle(vec2 p, float r)')
  expect(t.body).not.toContain('float sdCircle(')
  expect(t.body).toContain('sdCircle(pos, 40.0)')
})

test('several helpers keep declaration order, including one calling another', () => {
  const t = transpileShader(`
float box(float2 p) { return max(p.x, p.y); }
float ring(float2 p) { return abs(box(p)) - 2.0; }
half4 main(float2 p) { return half4(ring(p)); }
`)
  expect(t.functionNames).toEqual(['box', 'ring'])
  expect(t.preamble).toContain('float box(vec2 p)')
  expect(t.preamble).toContain('abs(box(p))')
  expect(t.body).toContain('ring(p)')
})

// The helper is emitted at file scope; a `const` left in the body would be
// invisible to it and the program would fail to link with nothing painted.
test('a helper can read a top-level const, because both go to file scope', () => {
  const t = transpileShader(`
const float PI = 3.14159;
float twice(float x) { return x * PI; }
half4 main(float2 p) { return half4(twice(p.x)); }
`)
  expect(t.functionNames).toEqual(['PI', 'twice'])
  expect(t.preamble).toContain('const float PI = 3.14159;')
  expect(t.preamble).toContain('float twice(float x)')
  expect(t.body).not.toContain('PI = 3.14159')
})

test('a top-level struct is lifted and named, not left in the body', () => {
  const t = transpileShader(`
struct Ray { float2 o; float2 d; };
float2 at(Ray r, float t) { return r.o + r.d * t; }
half4 main(float2 p) { return half4(at(Ray(p, p), 1.0), 0.0, 1.0); }
`)
  expect(t.functionNames).toEqual(['Ray', 'at'])
  expect(t.preamble).toContain('struct Ray')
  expect(t.body).not.toContain('struct Ray')
})

test('two names in one statement are rejected, not half-mangled', () => {
  expect(() =>
    transpileShader(`
const float A = 1.0, B = 2.0;
half4 main(float2 p) { return half4(A, B, 0.0, 1.0); }
`)
  ).toThrow(/one name per statement/)
})

// Everything after main's closing brace was silently discarded, so the body
// called a helper nothing declared and the driver rejected the program.
test('a helper declared below main is rejected, not dropped', () => {
  expect(() =>
    transpileShader(`
half4 main(float2 p) { return half4(k(p.x)); }
float k(float x) { return x * 2.0; }
`)
  ).toThrow(/must come before main/)
})

test('a source with no helper reports an empty preamble', () => {
  const t = transpileShader(PLAIN)
  expect(t.preamble).toBe('')
  expect(t.functionNames).toEqual([])
})

test('a helper may sample a child, and the eval is rewritten there too', () => {
  const t = transpileShader(`
uniform shader tex;
half4 tint(float2 p) { return tex.eval(p) * 0.5; }
half4 main(float2 p) { return tint(p); }
`)
  expect(t.functionNames).toEqual(['tint'])
  expect(t.preamble).toContain('TGFX_CHILD_0(p)')
  expect(t.preamble).not.toContain('tex.eval')
})

// The uniform regex cannot match `weights[5];`, so before this the declaration
// slipped into the body and failed in the driver with nothing pointing back.
test('an array uniform is rejected in JavaScript, not in the driver', () => {
  expect(() =>
    transpileShader(`
uniform float weights[5];
half4 main(float2 p) { return half4(weights[0]); }
`)
  ).toThrow(/not arrays/)
})
