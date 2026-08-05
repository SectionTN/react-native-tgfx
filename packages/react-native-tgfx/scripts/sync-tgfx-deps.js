#!/usr/bin/env node
// tgfx keeps its vendored dependencies in a gitignored `third_party/`, which
// `npm pack` therefore cannot ship: an install straight from the registry gets
// tgfx's own sources and none of the libraries its CMakeLists includes. The
// Android configure step then fails on
//
//   include could not find requested file: ./third_party/vendor_tools/vendor.cmake
//
// and the iOS build script fails on the same directory's ios.toolchain.cmake.
// Fetch them the way tgfx itself does, once, at install time.
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const tgfx = join(__dirname, '..', 'cpp', 'third_party', 'tgfx')

// A git checkout of this repo has them as a submodule; only a packed install is missing them.
if (existsSync(join(tgfx, 'third_party', 'vendor_tools', 'vendor.cmake'))) {
  process.exit(0)
}

if (!existsSync(join(tgfx, 'DEPS'))) {
  process.exit(0)
}

console.log('[tgfx] fetching vendored dependencies (first install only)…')
try {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'depsync'], {
    cwd: tgfx,
    stdio: 'inherit',
  })
} catch {
  // Loud, because the failure this replaces surfaced as an unrelated CMake error.
  console.error(
    '\n[tgfx] could not fetch the vendored dependencies. The native build will fail until they are present.\n' +
      '       Run it by hand with git and network access:\n\n' +
      `         cd ${tgfx} && npx depsync\n`
  )
  process.exit(1)
}
