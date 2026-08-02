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
