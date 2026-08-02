import React from 'react'
import { expect, test } from 'bun:test'
import { compileScene } from '../compiler/compile'
import { SceneWriter } from '../compiler/writer'
import { Circle, Path, Rect } from '../components/drawings'
import { Group } from '../components/Group'
import { Paint } from '../components/Paint'
import { directNodes } from './directNodes'
import { TgfxRoot } from './Reconciler'
import type { Node } from './types'

const encode = (roots: Node[]) => {
  const { buffer, strings, values } = compileScene(roots, new SceneWriter())
  return {
    words: Array.from(new Float64Array(buffer)),
    strings,
    values,
  }
}

/** The tree the reconciler actually builds, so equivalence is measured, not assumed. */
async function viaReconciler(children: React.ReactNode): Promise<Node[]> {
  const root = new TgfxRoot(() => {})
  // The same wrapping `<Canvas>` uses on the fallback path.
  root.render(<>{children}</>)
  await new Promise((resolve) => setTimeout(resolve, 20))
  return root.container.root
}

function Star(): React.ReactElement {
  return <Path path="M0 0L1 1" />
}

const handled: [string, React.ReactNode][] = [
  [
    'a flat shape list',
    [
      <Rect key="a" x={1} y={2} width={3} height={4} color="#f00" />,
      <Circle key="b" cx={5} cy={6} r={7} color="#0f0" />,
    ],
  ],
  [
    'nested groups and paint children',
    <Group transform={[{ rotate: '90deg' }]}>
      <Rect x={0} y={0} width={8} height={8}>
        <Paint color="#00f" style="stroke" strokeWidth={2} />
      </Rect>
      <Path path="M0 0L10 10" color="#0ff" />
    </Group>,
  ],
  [
    'null, undefined and false children',
    [<Rect key="a" x={0} y={0} width={1} height={1} />, null, undefined, false],
  ],
  [
    'a keyed Fragment',
    [
      <React.Fragment key="a">
        <Rect x={0} y={0} width={1} height={1} color="#f00" />
        <Rect x={0} y={0} width={1} height={1} color="#00f" style="stroke" />
      </React.Fragment>,
    ],
  ],
  [
    'an unkeyed Fragment',
    <>
      <Rect x={0} y={0} width={2} height={2} color="#0f0" />
      <Circle cx={1} cy={1} r={1} color="#f0f" />
    </>,
  ],
  [
    'a .map() producing keyed Fragments',
    [0, 1, 2].map((i) => (
      <React.Fragment key={i}>
        <Rect x={i} y={i} width={1} height={1} color="#fff" />
      </React.Fragment>
    )),
  ],
  [
    'nested arrays',
    [
      [<Rect key="a" x={0} y={0} width={1} height={1} />],
      [
        <Circle key="b" cx={0} cy={0} r={1} />,
        [<Path key="c" path="M0 0L2 2" />],
      ],
    ],
  ],
  [
    'a group holding an empty group',
    <Group>
      <Group opacity={0.5} />
    </Group>,
  ],
]

test.each(handled)(
  'the direct path builds the same tree as the reconciler: %s',
  async (_name, children) => {
    const fast = directNodes(children)
    expect(fast).not.toBeNull()
    const slow = await viaReconciler(children)
    expect(fast).toEqual(slow)
    expect(encode(fast!)).toEqual(encode(slow))
  }
)

const fallbacks: [string, React.ReactNode][] = [
  ['a custom component', [<Star key="s" />]],
  [
    'a custom component nested in a group',
    <Group>
      <Star />
    </Group>,
  ],
  [
    'a host element beside a custom component',
    [<Rect key="a" x={0} y={0} width={1} height={1} />, <Star key="s" />],
  ],
  ['a non-tgfx host element', [React.createElement('view', { key: 'v' })]],
  [
    'a host element beside a non-tgfx one',
    [
      <Rect key="a" x={0} y={0} width={1} height={1} />,
      React.createElement('view', { key: 'v' }),
    ],
  ],
  [
    'a non-tgfx host element nested in a group',
    <Group>{React.createElement('view', { key: 'v' })}</Group>,
  ],
  ['a raw string child', ['hello']],
  [
    'a raw string beside a shape',
    [<Rect key="a" x={0} y={0} width={1} height={1} />, 'hello'],
  ],
  ['a zero child, which React renders as text', [0]],
  ['an empty string child', ['']],
  [
    'a Fragment containing a custom component',
    [
      <React.Fragment key="a">
        <Star />
      </React.Fragment>,
    ],
  ],
]

test.each(fallbacks)('falls back to the reconciler: %s', (_name, children) => {
  expect(directNodes(children)).toBeNull()
})
