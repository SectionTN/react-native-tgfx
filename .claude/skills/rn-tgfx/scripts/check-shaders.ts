import { readFileSync } from 'fs'
import { transpileShader } from '../../../../packages/react-native-tgfx/src/compiler/sksl'

const md = readFileSync(new URL('../references/api-effects-shaders.md', import.meta.url), 'utf8')
// Every SkSL block in the doc is a backtick-quoted template literal ending with a lone backtick line.
const sources = [...md.matchAll(/const \w+ = `\n([\s\S]*?)\n`/g)].map((m) => m[1]!)
if (sources.length === 0) throw new Error('no shader sources found in the doc')

for (const src of sources) {
  const r = transpileShader(src)
  console.log('ok:', {
    uniforms: r.uniformNames,
    sizes: r.uniformSizes,
    children: r.childNames,
    helpers: r.functionNames,
  })
  for (const child of r.childNames) {
    if (new RegExp(`\\b${child}\\b`).test(r.body + r.preamble)) {
      throw new Error(`child ${child} leaked into output`)
    }
  }
}
console.log(`\n${sources.length} shader source(s) accepted by the transpiler`)
