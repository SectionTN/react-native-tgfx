/**
 * Translates a practical subset of SkSL — the shading language Skia's
 * `RuntimeEffect` uses — into the GLSL ES that tgfx's fragment builder emits.
 * On Metal that GLSL is cross-compiled to MSL by tgfx, so one source works on
 * both platforms.
 *
 * Supported: `uniform` declarations, SkSL's `half*`/`float*` type spellings, and
 * a `main` taking the fragment position. Not supported: child shaders
 * (`uniform shader`), `sample()`, matrices beyond 2x2/3x3/4x4, and arrays.
 */

export interface TranspiledShader {
  /** GLSL statements forming the body of `vec4 main(vec2 <param>)`. */
  body: string
  /** Uniform names in declaration order. */
  uniformNames: string[]
  /** Component count per uniform, keyed by name (1, 2, 3 or 4). */
  uniformSizes: Record<string, number>
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

export function transpileShader(source: string): TranspiledShader {
  const uniformNames: string[] = []
  const uniformSizes: Record<string, number> = {}
  const withoutUniforms = source.replace(
    /\buniform\s+(\w+)\s+(\w+)\s*;/g,
    (_all, type: string, name: string) => {
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

  return {
    body: toGlslTypes(`${before}\n${bind}${body}`).trim(),
    uniformNames,
    uniformSizes,
  }
}
