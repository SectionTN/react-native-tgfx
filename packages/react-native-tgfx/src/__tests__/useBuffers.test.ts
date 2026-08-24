import { expect, mock, test } from 'bun:test'
import { nativeMocks } from '../testing/nativeMocks'

mock.module('react-native-reanimated', () => ({}))

// No native buffer factory: the creators fall back to plain Float32Arrays,
// which is exactly the degradation the hooks document.
nativeMocks.hybridObject = () => {
  throw new Error('no natives in this test')
}

const { createSpriteBuffer, createVertexBuffer, SPRITE_FLOATS } =
  await import('../hooks/useBuffers')

test('createSpriteBuffer works with no React and no natives', () => {
  const sprites = createSpriteBuffer(4)
  expect(sprites.capacity).toBe(4)
  expect(sprites.data.length).toBe(4 * SPRITE_FLOATS)
  sprites.set(1, 8, 16, 32, 32, 2, 100, 50)
  const at = 1 * SPRITE_FLOATS
  expect(Array.from(sprites.data.subarray(at, at + SPRITE_FLOATS))).toEqual([
    8, 16, 32, 32, 2, 100, 50,
  ])
})

test('createVertexBuffer sections one allocation by its options', () => {
  const mesh = createVertexBuffer({
    maxVertices: 4,
    maxIndices: 6,
    colors: true,
  })
  expect(mesh.maxVertices).toBe(4)
  expect(mesh.maxIndices).toBe(6)
  expect(mesh.positions.length).toBe(8)
  expect(mesh.colors.length).toBe(16)
  expect(mesh.textures.length).toBe(0)
  expect(mesh.indices.length).toBe(6)
  mesh.positions.set([0, 0, 10, 0, 0, 10, 10, 10])
  expect(mesh.positions[6]).toBe(10)
})
