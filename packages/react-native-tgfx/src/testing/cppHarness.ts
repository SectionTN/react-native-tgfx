import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Separate budgets: a slow compile must not read as code under test that never returned.
const COMPILE_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 32 << 20

/**
 * Pass as bun's per-test timeout; its watchdog otherwise kills the compile mid-flight.
 * Derived so no edit to a budget above can invert the ordering. One call per `test()`.
 */
export const HARNESS_TIMEOUT_MS = COMPILE_TIMEOUT_MS + RUN_TIMEOUT_MS + 30_000

export type CppHarnessOptions = {
  headers?: Record<string, string>
  sources?: string[]
  args?: readonly string[]
}

function overflowed(result: SpawnSyncReturns<string>): boolean {
  return (result.error as { code?: string } | undefined)?.code === 'ENOBUFS'
}

function outcome(result: SpawnSyncReturns<string>, budgetMs: number): string {
  if (overflowed(result)) return `wrote more than ${MAX_OUTPUT_BYTES} bytes`
  if (result.error) return `${result.error.message}, budget ${budgetMs}ms`
  if (result.signal) return `killed by ${result.signal}`
  return `exit ${result.status}`
}

function why(result: SpawnSyncReturns<string>, otherwise: string): string {
  return overflowed(result)
    ? 'It ran to completion; the output buffer did not hold what it printed.'
    : otherwise
}

const SPAWN = {
  encoding: 'utf8',
  killSignal: 'SIGKILL',
  maxBuffer: MAX_OUTPUT_BYTES,
} as const

/** Compiles and runs `program`. Requires a C++20 `c++` on PATH, as CI has. */
export function runCppHarness(
  name: string,
  program: string,
  { headers = {}, sources = [], args = [] }: CppHarnessOptions = {}
): { stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`))
  try {
    for (const [path, contents] of Object.entries(headers)) {
      const file = join(dir, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, contents)
    }
    const source = join(dir, 'main.cpp')
    const binary = join(dir, 'main')
    writeFileSync(source, program)
    const cpp = resolve(import.meta.dir, '../../cpp')
    const build = spawnSync(
      'c++',
      [
        '-std=c++20',
        '-I',
        dir,
        '-I',
        cpp,
        source,
        ...sources.map((file) => join(cpp, file)),
        '-o',
        binary,
      ],
      { ...SPAWN, timeout: COMPILE_TIMEOUT_MS }
    )
    if (build.error || build.signal) {
      throw new Error(
        `${name}: c++ failed to build the harness (${outcome(
          build,
          COMPILE_TIMEOUT_MS
        )}). ` +
          `${why(build, 'This is the toolchain, not the code under test.')}\n${
            build.stderr ?? ''
          }`
      )
    }
    if (build.status !== 0) {
      throw new Error(
        `${name}: c++ rejected the harness (exit ${build.status}). ` +
          `This is the code under test failing to compile, not the toolchain.\n${
            build.stderr ?? ''
          }`
      )
    }
    const run = spawnSync(binary, [...args], {
      ...SPAWN,
      timeout: RUN_TIMEOUT_MS,
    })
    if (run.error || run.status !== 0) {
      throw new Error(
        `${name}: the harness did not run to completion (${outcome(
          run,
          RUN_TIMEOUT_MS
        )}). ` +
          `${why(run, 'The code under test failed or never returned.')}\n${
            run.stderr ?? ''
          }`
      )
    }
    return { stdout: run.stdout, stderr: run.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
