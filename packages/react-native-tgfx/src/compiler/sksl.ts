/** Cached and shared between callers, so every field is read-only. */
export interface TranspiledShader {
  readonly body: string
  readonly preamble: string
  readonly functionNames: readonly string[]
  readonly uniformNames: readonly string[]
  readonly uniformSizes: Readonly<Record<string, number>>
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

function toGlslTypes(src: string): string {
  return src
    .replace(/\bhalf([234])\b/g, 'vec$1')
    .replace(/\bhalf\b/g, 'float')
    .replace(/\bfloat([234])x\1\b/g, (_, n) => `mat${n}`)
    .replace(/\bfloat([234])\b/g, 'vec$1')
}

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
  throw new Error('[tgfx] shader: unbalanced braces')
}

function hasBareComma(src: string): boolean {
  let depth = 0
  for (const c of src) {
    if (c === '(') {
      depth++
    } else if (c === ')') {
      depth--
    } else if (c === ',' && depth === 0) {
      return true
    }
  }
  return false
}

function topLevelChunks(src: string): string[] {
  const chunks: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{') {
      depth++
      continue
    }
    if (c === '}') {
      depth--
    } else if (c !== ';') {
      continue
    }
    // A `}` the `struct` grammar follows with `;` is closed by that `;`.
    if (depth > 0 || (c === '}' && /^\s*;/.test(src.slice(i + 1)))) {
      continue
    }
    chunks.push(src.slice(start, i + 1))
    start = i + 1
  }
  if (src.slice(start).trim() !== '') {
    throw new Error(
      `[tgfx] shader: unterminated declaration above main(): '${src
        .slice(start)
        .trim()}'`
    )
  }
  return chunks
}

function declaredName(chunk: string): string {
  const struct = /\bstruct\s+(\w+)/.exec(chunk)
  if (struct != null) {
    return struct[1] as string
  }
  const paren = chunk.indexOf('(')
  const assign = chunk.indexOf('=')
  const declarator =
    /^\s*(?:const\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*(?:\(|=|;)/.exec(chunk)
  if (declarator == null) {
    throw new Error(
      `[tgfx] shader: unsupported declaration above main(): '${chunk.trim()}'`
    )
  }
  // `float a = 1.0, b = 2.0;` would leave `b` unmangled and silently colliding.
  if ((paren < 0 || assign < paren) && hasBareComma(chunk)) {
    throw new Error(
      `[tgfx] shader: declare one name per statement above main(): '${chunk.trim()}'`
    )
  }
  return declarator[1] as string
}

const CACHE = new Map<string, TranspiledShader>()

export function transpileShader(source: string): TranspiledShader {
  const hit = CACHE.get(source)
  if (hit !== undefined) {
    return hit
  }
  const result = transpile(source)
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
  // Stripped first, so a commented-out `uniform` is not collected and prose cannot trip the guard.
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
  const after = withoutUniforms.slice(open + body.length + 2)
  // Only what precedes `main` is lifted, so a helper below it would be dropped.
  if (after.trim() !== '') {
    throw new Error(
      `[tgfx] shader: declarations must come before main(), found after it: '${after.trim()}'`
    )
  }

  const param = /\b(?:half2|float2|vec2)\s+(\w+)/.exec(signature[1] ?? '')
  // highp: mediump (GL ES default) quantizes pixel coords past 1024.
  const bind = param != null ? `highp vec2 ${param[1]} = fragCoord;\n` : ''

  // A declaration the uniform pass could not consume would be emitted verbatim and fail in the driver.
  if (/\buniform\b/.test(before)) {
    throw new Error(
      '[tgfx] shader: unsupported uniform declaration — only scalar, vector and square-matrix uniforms are supported, not arrays'
    )
  }
  const chunks = topLevelChunks(before)
  const names = chunks.map(declaredName)

  let glsl = toGlslTypes(`${bind}${body}`).trim()
  let functions = toGlslTypes(chunks.join('')).trim()
  // Both spellings become `TGFX_CHILD_0(coord)`, after the type rewrite so a child cannot be mangled.
  childNames.forEach((name, index) => {
    const calls = [
      new RegExp(`\\b${name}\\s*\\.\\s*eval\\s*\\(`, 'g'),
      new RegExp(`\\bsample\\s*\\(\\s*${name}\\s*,\\s*`, 'g'),
    ]
    for (const call of calls) {
      glsl = glsl.replace(call, `TGFX_CHILD_${index}(`)
      functions = functions.replace(call, `TGFX_CHILD_${index}(`)
    }
  })
  for (const name of childNames) {
    if (new RegExp(`\\b${name}\\b`).test(glsl + functions)) {
      throw new Error(
        `[tgfx] shader: child '${name}' may only be used as '${name}.eval(coord)' or 'sample(${name}, coord)'`
      )
    }
  }
  return {
    body: glsl,
    preamble: functions,
    functionNames: names,
    uniformNames,
    uniformSizes,
    childNames,
  }
}
