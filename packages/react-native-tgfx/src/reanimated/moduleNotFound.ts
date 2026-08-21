/** True when the resolver could not find `name` itself; a miss on one of its own deps reads false. */
export function isModuleNotFound(e: unknown, name: string): boolean {
  'worklet'
  // Inline, not a module const: a worklet capture would have to clone a RegExp.
  // Metro drops the module name in release bundles, so the name is optional.
  const miss = /Cannot find (?:module|package)(?: '(.+?)')?/.exec(String(e))
  const code = (e as { code?: string } | null)?.code
  if (
    miss == null &&
    code !== 'MODULE_NOT_FOUND' &&
    code !== 'ERR_MODULE_NOT_FOUND'
  ) {
    return false
  }
  return miss?.[1] == null || miss[1] === name
}
