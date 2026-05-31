import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dir, '../..')
const CLI = path.join(REPO, 'packages/cli/src/index.ts')

// owf-distribution V-1: the standalone binary runs with no toolchain assumptions.
// Compiles the host binary into a temp dir and exercises it directly.
describe('owf-distribution: standalone binary', () => {
  test('compiles and runs --version + a mock workflow', async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'owf-dist-')), 'owf')

    const build = Bun.spawnSync(['bun', 'build', '--compile', CLI, '--outfile', out])
    expect(build.exitCode).toBe(0)

    const version = Bun.spawnSync([out, '--version'])
    expect(version.exitCode).toBe(0)
    expect(new TextDecoder().decode(version.stdout).trim()).toMatch(/^\d+\.\d+\.\d+$/)

    const run = Bun.spawnSync([
      out,
      'run',
      path.join(REPO, 'examples/hello.workflow.js'),
      '--adapter',
      'mock',
      '--runs-dir',
      mkdtempSync(path.join(tmpdir(), 'owf-dist-runs-')),
      '--output',
      'json',
    ])
    expect(run.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(run.stdout)).status).toBe('completed')
  }, 30_000)
})
