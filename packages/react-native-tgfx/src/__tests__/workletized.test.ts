// The compile graph must stay worklet-callable. The babel plugin's worklet
// factories evaluate in file order and snapshot their closures, which outlaws
// four things JS normally allows — and bun never runs the plugin, so only
// static checks (or a device) can catch a violation:
//   1. forward references between top-level declarations (hoisting is gone),
//   2. getters/setters in top-level objects (the plugin's rewrite throws),
//   3. worklet-body assignments to captured module `let`s (parse error on the
//      UI runtime: the closure prelude makes them `const`),
//   4. an object member naming its own binding (captured before initialized),
//   5. a top-level WeakMap/WeakSet initializer (a worklet capture clones the
//      binding to `undefined`; Maps and Sets clone, the weak ones do not).
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

// Interop differs per runtime: bun hands the function, node the namespace.
const traverse =
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default

const WORKLETIZED = [
  'compiler/colors.ts',
  'compiler/compile.ts',
  'compiler/filters.ts',
  'compiler/image.ts',
  'compiler/paint.ts',
  'compiler/sksl.ts',
  'compiler/text.ts',
  'compiler/transform.ts',
  'compiler/values.ts',
  'compiler/writer.ts',
  'elements.ts',
  'imperative.ts',
  'reconciler/types.ts',
  'reconciler/Container.ts',
  'reanimated/slotFlags.ts',
  'scene.ts',
]

interface Ast {
  program: { body: Statement[] }
}
interface Statement {
  type: string
  start: number
  end: number
  declaration?: Statement
  declarations?: { id: { type: string; name?: string }; init?: unknown }[]
  id?: { name?: string }
  kind?: string
}

function topLevel(ast: Ast): {
  order: Map<string, number>
  lets: Set<string>
  spans: { start: number; end: number; name: string; idx: number }[]
} {
  const order = new Map<string, number>()
  const lets = new Set<string>()
  const spans: {
    start: number
    end: number
    name: string
    idx: number
    objectInit: boolean
  }[] = []
  let i = 0
  for (const st of ast.program.body) {
    const d =
      st.type.startsWith('Export') && st.declaration ? st.declaration : st
    let name: string | null = null
    if (
      (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') &&
      d.id?.name != null
    ) {
      name = d.id.name
      order.set(name, i++)
    } else if (d.type === 'VariableDeclaration') {
      for (const dec of d.declarations ?? []) {
        if (dec.id.type === 'Identifier' && dec.id.name != null) {
          name = dec.id.name
          order.set(name, i++)
          if (d.kind === 'let' || d.kind === 'var') {
            lets.add(name)
          }
        }
      }
    }
    if (name != null) {
      const objectInit =
        d.type === 'VariableDeclaration' &&
        (d.declarations ?? []).some(
          (dec) =>
            (dec.init as { type?: string } | undefined)?.type ===
            'ObjectExpression'
        )
      spans.push({
        start: st.start,
        end: st.end,
        name,
        idx: order.get(name)!,
        objectInit,
      })
    }
  }
  return { order, lets, spans }
}

describe('workletized compile graph', () => {
  for (const file of WORKLETIZED) {
    const source = readFileSync(join(import.meta.dir, '..', file), 'utf8')

    it(`${file} keeps the file-level 'worklet' directive`, () => {
      expect(source.startsWith("'worklet'")).toBe(true)
    })

    it(`${file} breaks none of the worklet-factory rules`, () => {
      const ast = parse(source, {
        sourceType: 'module',
        plugins: ['typescript'],
      }) as unknown as Ast
      const { order, lets, spans } = topLevel(ast)
      const owner = (pos: number) =>
        spans.find((s) => pos >= s.start && pos <= s.end)
      const problems: string[] = []

      traverse(
        ast as never,
        {
          Identifier(p: {
            node: { name: string; start: number }
            isReferencedIdentifier: () => boolean
            scope: {
              path: { isProgram: () => boolean }
              hasOwnBinding: (n: string) => boolean
              parent: unknown
            }
          }) {
            if (!p.isReferencedIdentifier()) return
            const n = p.node.name
            if (!order.has(n)) return
            let s: (typeof p)['scope'] | null = p.scope
            while (s != null && !s.path.isProgram()) {
              if (s.hasOwnBinding(n)) return
              s = s.parent as (typeof p)['scope'] | null
            }
            const o = owner(p.node.start)
            if (o != null && o.name !== n && order.get(n)! > o.idx) {
              problems.push(`forward reference: ${o.name} -> ${n}`)
            }
            if (o != null && o.name === n && o.objectInit) {
              // An object member naming its own binding: the worklet factory
              // captures it before the binding initializes. Recursive functions
              // are fine — the plugin threads the self reference for them.
              problems.push(`self reference inside object initializer: ${n}`)
            }
          },
          AssignmentExpression(p: {
            node: { left: { type: string; name?: string; start: number } }
          }) {
            const left = p.node.left
            if (left.type === 'Identifier' && left.name != null) {
              const o = owner(left.start)
              if (lets.has(left.name) && o != null && o.name !== left.name) {
                problems.push(
                  `assignment to module let from a function body: ${left.name}`
                )
              }
            }
          },
          UpdateExpression(p: {
            node: { argument: { type: string; name?: string; start: number } }
          }) {
            const a = p.node.argument
            if (a.type === 'Identifier' && a.name != null && lets.has(a.name)) {
              const o = owner(a.start)
              if (o != null && o.name !== a.name) {
                problems.push(
                  `update of module let from a function body: ${a.name}`
                )
              }
            }
          },
          NewExpression(p: {
            node: { callee: { type: string; name?: string }; start: number }
            getFunctionParent: () => unknown
          }) {
            const callee = p.node.callee
            if (
              callee.type === 'Identifier' &&
              (callee.name === 'WeakMap' || callee.name === 'WeakSet') &&
              p.getFunctionParent() == null
            ) {
              problems.push(`top-level ${callee.name!} initializer`)
            }
          },
          ObjectMethod(p: {
            node: { kind: string; start: number }
            scope: { path: { isProgram: () => boolean } }
            getFunctionParent: () => unknown
          }) {
            if (
              (p.node.kind === 'get' || p.node.kind === 'set') &&
              p.getFunctionParent() == null
            ) {
              problems.push(`top-level object ${p.node.kind}ter`)
            }
          },
        } as never
      )

      expect(problems).toEqual([])
    })
  }
})
