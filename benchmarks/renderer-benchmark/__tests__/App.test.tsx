import React from 'react'
import ReactTestRenderer from 'react-test-renderer'
import App from '../App'

jest.mock('../src/renderers/SkiaRenderer', () => ({
  getSkiaBackendProof: () => ({ graphiteEnabled: true }),
  SkiaRenderer: () => null,
}))
jest.mock('../src/renderers/TgfxRenderer', () => ({
  TgfxRenderer: () => null,
}))
jest.mock('../src/renderers/ThorRenderer', () => ({
  ThorRenderer: () => null,
}))
jest.mock('../src/nativeMetrics', () => ({
  benchmarkMetrics: {
    publish: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
}))

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />)
  })
})
