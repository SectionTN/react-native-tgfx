import { expect, test } from 'bun:test'
import { isModuleNotFound } from './moduleNotFound'

const NAME = 'react-native-reanimated'
const withCode = (message: string) =>
  Object.assign(new Error(message), { code: 'MODULE_NOT_FOUND' })

test('the package itself being absent, in every runtime shape', () => {
  // Node, Bun, Metro dev, Metro release — the last one drops the module name.
  expect(isModuleNotFound(withCode(`Cannot find module '${NAME}'`), NAME)).toBe(
    true
  )
  expect(
    isModuleNotFound(withCode(`Cannot find package '${NAME}' from '/app'`), NAME)
  ).toBe(true)
  expect(isModuleNotFound(new Error(`Cannot find module '${NAME}'`), NAME)).toBe(
    true
  )
  expect(isModuleNotFound(new Error('Cannot find module'), NAME)).toBe(true)
  // Node's ESM loader: a different code, and "package" rather than "module".
  expect(
    isModuleNotFound(
      Object.assign(
        new Error(`Cannot find package '${NAME}' imported from /app/index.mjs`),
        { code: 'ERR_MODULE_NOT_FOUND' }
      ),
      NAME
    )
  ).toBe(true)
  expect(
    isModuleNotFound(new Error(`Cannot find package '${NAME}' from '/app'`), NAME)
  ).toBe(true)
})

test('the package being installed but broken', () => {
  // A transitive peer missing from inside Reanimated's own init.
  expect(
    isModuleNotFound(
      withCode(`Cannot find package 'react-native-worklets' from '/app'`),
      NAME
    )
  ).toBe(false)
  expect(
    isModuleNotFound(new Error('[Reanimated] Mismatch between JS and native'), NAME)
  ).toBe(false)
  expect(isModuleNotFound(null, NAME)).toBe(false)
})
