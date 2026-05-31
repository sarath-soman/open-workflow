import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
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

const TEMPLATES = ['basic', 'pipeline', 'gated-fanout', 'judge-panel']

describe('owf new: templates are correct-by-construction', () => {
  for (const template of TEMPLATES) {
    test(`${template} scaffolds a strict-clean, runnable workflow`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'owf-new-'))
      const created = await runCli(['new', 'demo', '--template', template, '--dir', dir])
      expect(created.code).toBe(0)
      const wf = path.join(dir, 'demo.workflow.js')

      const validated = await runCli(['validate', wf, '--strict'])
      expect(validated.code).toBe(0)

      const ran = await runCli([
        'run',
        wf,
        '--adapter',
        'mock',
        '--runs-dir',
        path.join(dir, 'runs'),
        '--output',
        'json',
      ])
      expect(ran.code).toBe(0)
      expect(JSON.parse(ran.stdout).status).toBe('completed')
    })
  }

  test('refuses to overwrite without --force, succeeds with it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-new-'))
    expect((await runCli(['new', 'dup', '--dir', dir])).code).toBe(0)
    const second = await runCli(['new', 'dup', '--dir', dir])
    expect(second.code).toBe(1)
    expect(second.stderr).toContain('already exists')
    expect((await runCli(['new', 'dup', '--dir', dir, '--force'])).code).toBe(0)
  })

  test('rejects an invalid workflow name', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-new-'))
    const res = await runCli(['new', 'bad name!', '--dir', dir])
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/name must match/)
  })

  test('rejects an unknown template', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-new-'))
    const res = await runCli(['new', 'x', '--template', 'nope', '--dir', dir])
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('unknown template')
  })
})

describe('owf trace', () => {
  test('summarizes phases, effects, and concurrency groups', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-trace-'))
    await runCli(['new', 'jp', '--template', 'judge-panel', '--dir', dir])
    const runs = path.join(dir, 'runs')
    const ran = await runCli([
      'run',
      path.join(dir, 'jp.workflow.js'),
      '--adapter',
      'mock',
      '--runs-dir',
      runs,
      '--output',
      'json',
    ])
    const runId = JSON.parse(ran.stdout).runId

    const pretty = await runCli(['trace', runId, '--runs-dir', runs])
    expect(pretty.code).toBe(0)
    expect(pretty.stdout).toContain('phase draft')
    expect(pretty.stdout).toContain('phase judge')

    const json = await runCli(['trace', runId, '--runs-dir', runs, '--output', 'json'])
    const trace = JSON.parse(json.stdout)
    expect(trace.phases.map((p: { title: string }) => p.title)).toEqual(['draft', 'judge'])
    const judge = trace.phases.find((p: { title: string }) => p.title === 'judge')
    expect(judge.effects).toHaveLength(2)
    expect(trace.groups.default).toBe(3)
  })
})
