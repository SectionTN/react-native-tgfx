/**
 * Translates a practical subset of SkSL — the shading language Skia's
 * `RuntimeEffect` uses — into the GLSL ES that tgfx's fragment builder emits.
 * On Metal that GLSL is cross-compiled to MSL by tgfx, so one source works on
 * both platforms.
 *
 * Supported: `uniform` declarations, SkSL's `half*`/`float*` type spellings, and
 * a `main` taking the fragment position. Not supported: `sample()`, child
 * shaders, matrices beyond 4x4, and arrays.
 *
 * `uniform shader` is parsed here and its `name.eval(coord)` rewritten to
 * `TGFX_CHILD_<index>(coord)`, but nothing native consumes that: tgfx's
 * `RuntimeShaderSource` is a body plus scalar uniforms with no child slot at
 * all. So a source declaring a child is rejected at encode time in `paint.ts`,
 * and this half of the transpiler is groundwork for the PR that adds the native
 * child processor. Sources that declare no child transpile exactly as before.
 */

/** Cached and shared between callers, so every field is read-only. */
export interface TranspiledShader {
  /** GLSL statements forming the body of `vec4 main(vec2 <param>)`. */
  readonly body: string
  /** Uniform names in declaration order. */
  readonly uniformNames: readonly string[]
  /** Component count per uniform, keyed by name (1, 2, 3 or 4). */
  readonly uniformSizes: Readonly<Record<string, number>>
  /** `uniform shader` names in declaration order; empty for most sources. */
  readonly childNames: readonly string[]
}

const TYPES: Record<string, { glsl: string; size: number }> = {
  half: { glsl: 'float', size: 1 },
  half2: { glsl: 'vec2', size: 2 },
  half3: { glsl: 'vec3', size: 3 },
  half4: { glsl: 'vec4', size: 4 },
  float: { glsl: 'float', size: 1 },
  float2: { glsl: 'vec2', size: 2 },
  float3: { glsl: 'vec3', size: 3 },
  float4: { glsl: 'vec4', size: 4 },
  vec2: { glsl: 'vec2', size: 2 },
  vec3: { glsl: 'vec3', size: 3 },
  vec4: { glsl: 'vec4', size: 4 },
  int: { glsl: 'int', size: 1 },
  float2x2: { glsl: 'mat2', size: 4 },
  float3x3: { glsl: 'mat3', size: 9 },
  float4x4: { glsl: 'mat4', size: 16 },
}

/** Rewrite SkSL type spellings to their GLSL equivalents. */
function toGlslTypes(src: string): string {
  return src
    .replace(/\bhalf([234])\b/g, 'vec$1')
    .replace(/\bhalf\b/g, 'float')
    .replace(/\bfloat([234])x\1\b/g, (_, n) => `mat${n}`)
    .replace(/\bfloat([234])\b/g, 'vec$1')
}

/** Extract the balanced `{ ... }` block starting at `open`. */
function blockAt(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') {
      depth++
    } else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        return src.slice(open + 1, i)
      }
    }
  }
  throw new Error('[tgfx] shader: unbalanced braces in main()')
}

// The source is a stable string prop, so the parse is done once per distinct
// shader rather than once per node per commit.
const CACHE = new Map<string, TranspiledShader>()

export function transpileShader(source: string): TranspiledShader {
  const hit = CACHE.get(source)
  if (hit !== undefined) {
    return hit
  }
  const result = transpile(source)
  // Sources are usually module-level literals, but nothing stops one being
  // interpolated per render, so cap the map rather than grow it forever.
  if (CACHE.size >= 64) {
    CACHE.clear()
  }
  CACHE.set(source, result)
  return result
}

function transpile(source: string): TranspiledShader {
  const uniformNames: string[] = []
  const uniformSizes: Record<string, number> = {}
  const childNames: string[] = []
  // Comments are stripped first so a commented-out `uniform` is not collected
  // and a child's name in prose does not trip the guard below.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ')
  const withoutUniforms = withoutComments.replace(
    /\buniform\s+(\w+)\s+(\w+)\s*;/g,
    (_all, type: string, name: string) => {
      if (type === 'shader') {
        childNames.push(name)
        return ''
      }
      const info = TYPES[type]
      if (info == null) {
        throw new Error(`[tgfx] shader: unsupported uniform type '${type}'`)
      }
      uniformNames.push(name)
      uniformSizes[name] = info.size
      return ''
    }
  )

  const signature = /\b(?:half4|float4|vec4)\s+main\s*\(([^)]*)\)\s*\{/.exec(
    withoutUniforms
  )
  if (signature == null) {
    throw new Error(
      "[tgfx] shader: expected a 'vec4 main(vec2 pos)' entry point"
    )
  }
  const open = signature.index + signature[0].length - 1
  const body = blockAt(withoutUniforms, open)
  const before = withoutUniforms.slice(0, signature.index)

  const param = /\b(?:half2|float2|vec2)\s+(\w+)/.exec(signature[1] ?? '')
  const bind = param != null ? `vec2 ${param[1]} = fragCoord;\n` : ''

  let glsl = toGlslTypes(`${before}\n${bind}${body}`).trim()
  // `name.eval(coord)` -> `TGFX_CHILD_0(coord)`. Done after the type rewrite so
  // a child named like a type spelling cannot be mangled.
  childNames.forEach((name, index) => {
    const call = new RegExp(`\\b${name}\\s*\\.\\s*eval\\s*\\(`, 'g')
    glsl = glsl.replace(call, `TGFX_CHILD_${index}(`)
  })
  for (const name of childNames) {
    if (new RegExp(`\\b${name}\\b`).test(glsl)) {
      throw new Error(
        `[tgfx] shader: child '${name}' may only be used as '${name}.eval(coord)'`
      )
    }
  }
  return { body: glsl, uniformNames, uniformSizes, childNames }
}
