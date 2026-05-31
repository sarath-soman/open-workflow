import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dir, '../..')
const CLI = path.join(REPO, 'packages/cli/src/index.ts')

async function runCli(args: string[], cwd = REPO) {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { stdout, stderr, code }
}

const CLEAN = `export const meta = { name: 'clean', description: 'd', phases: [{ title: 'p' }] }
phase('p')
const a = await agent('go', { label: 'a' })
return { a }`

const WARN_ONLY = `export const meta = { name: 'warn', description: 'd', phases: [{ title: 'declared' }] }
return {}`

const BAD = `export const meta = { name: 'bad', description: 'd', phases: [{ title: 'p' }] }
phase('p')
const t = Date.now()
return { t }`

async function writeWf(name: string, src: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'owf-e2e-'))
  const p = path.join(dir, `${name}.workflow.js`)
  await fs.writeFile(p, src)
  return p
}

describe('owf dsl', () => {
  test('prints the contract', async () => {
    const { stdout, code } = await runCli(['dsl'])
    expect(code).toBe(0)
    expect(stdout).toContain('DSL contract')
    expect(stdout).toContain('agent(')
  })

  test('--json emits the structured contract', async () => {
    const { stdout, code } = await runCli(['dsl', '--json'])
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.globals.map((g: { name: string }) => g.name)).toContain('agent')
    expect(parsed.forbidden.map((f: { name: string }) => f.name)).toContain('Date')
  })
})

describe('owf validate', () => {
  test('clean workflow passes with exit 0', async () => {
    const p = await writeWf('clean', CLEAN)
    const { stdout, code } = await runCli(['validate', p])
    expect(code).toBe(0)
    expect(stdout).toContain('valid workflow: clean')
  })

  test('bad workflow fails with exit 1 and reports the rule', async () => {
    const p = await writeWf('bad', BAD)
    const { stdout, code } = await runCli(['validate', p])
    expect(code).toBe(1)
    expect(stdout).toContain('no-Date')
  })

  test('warning-only workflow: passes by default, fails under --strict', async () => {
    const p = await writeWf('warn', WARN_ONLY)
    const lenient = await runCli(['validate', p])
    expect(lenient.code).toBe(0)
    const strict = await runCli(['validate', p, '--strict'])
    expect(strict.code).toBe(1)
  })

  test('--output json returns findings and ok flag', async () => {
    const p = await writeWf('bad', BAD)
    const { stdout } = await runCli(['validate', p, '--output', 'json'])
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.findings.some((f: { rule: string }) => f.rule === 'no-Date')).toBe(true)
  })
})

describe('owf run + status', () => {
  test('runs a workflow on mock and status reflects completion', async () => {
    const p = await writeWf('clean', CLEAN)
    const runs = mkdtempSync(path.join(tmpdir(), 'owf-e2e-runs-'))
    const run = await runCli([
      'run',
      p,
      '--adapter',
      'mock',
      '--runs-dir',
      runs,
      '--output',
      'json',
    ])
    expect(run.code).toBe(0)
    const result = JSON.parse(run.stdout)
    expect(result.status).toBe('completed')
    const status = await runCli(['status', result.runId, '--runs-dir', runs, '--output', 'json'])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout).status).toBe('completed')
  })
})

describe('owf CLI usability', () => {
  test('--version prints the version', async () => {
    const { stdout, code } = await runCli(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('per-command help: `run --help` prints run usage and exits 0', async () => {
    const { stdout, code } = await runCli(['run', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('owf run')
  })

  test('unknown flag is rejected with a helpful message', async () => {
    const { stderr, code } = await runCli(['run', '--adaptor', 'codex', 'x.workflow.js'])
    expect(code).toBe(1)
    expect(stderr).toContain('unknown flag')
    expect(stderr).toContain('adaptor')
  })

  test('upgrade is a routed command (help works without network)', async () => {
    const { stdout, code } = await runCli(['upgrade', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('owf upgrade')
  })
})

describe('owf codex install', () => {
  test('writes SKILL.md to the target skills dir', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-e2e-skill-'))
    const { stdout, code } = await runCli(['codex', 'install', '--dir', dir])
    expect(code).toBe(0)
    expect(stdout).toContain('author-workflow')
    const md = await fs.readFile(path.join(dir, 'author-workflow', 'SKILL.md'), 'utf8')
    expect(md).toContain('name: author-workflow')
  })

  test('--print emits the skill without writing', async () => {
    const { stdout, code } = await runCli(['codex', 'install', '--print'])
    expect(code).toBe(0)
    expect(stdout).toContain('# Author open-workflow workflows')
  })
})
