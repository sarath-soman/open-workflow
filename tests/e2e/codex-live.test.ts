import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Focused live-Codex adapter proof. Quota-spending, opt-in only:
//   OWF_LIVE_CODEX_EVAL=1 bun test tests/e2e/codex-live.test.ts
// Assertions are SHAPE/contract-based, never exact content (the model varies).
const REPO = path.resolve(import.meta.dir, '../..')
const CLI = path.join(REPO, 'packages/cli/src/index.ts')
const FIX = path.join(REPO, 'tests/e2e/fixtures')
const live = process.env.OWF_LIVE_CODEX_EVAL === '1'

async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd: REPO, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { stdout, stderr, code }
}

function runsDir() {
  return mkdtempSync(path.join(tmpdir(), 'owf-live-'))
}

describe('codex-live: focused adapter proof (opt-in)', () => {
  test.if(live)(
    'schema-variety: strict-schema normalization holds across shapes',
    async () => {
      const r = await runCli([
        'run',
        path.join(FIX, 'schema-variety.workflow.js'),
        '--adapter',
        'codex',
        '--concurrency',
        'heavy=1',
        '--runs-dir',
        runsDir(),
        '--output',
        'json',
      ])
      expect(r.code).toBe(0)
      const out = JSON.parse(r.stdout).workflowResult
      expect(['ok', 'revise']).toContain(out.flat.verdict)
      expect(typeof out.nested.status).toBe('string')
      expect(typeof out.nested.detail.count).toBe('number')
      expect(Array.isArray(out.list.items)).toBe(true)
      expect(typeof out.list.items[0].name).toBe('string')
      expect(['a', 'b', 'c']).toContain(out.scalarEnum.choice)
    },
    240_000,
  )

  test.if(live)(
    'large gated fan-out completes under heavy=2',
    async () => {
      const r = await runCli([
        'run',
        path.join(FIX, 'gated-fanout-live.workflow.js'),
        '--adapter',
        'codex',
        '--concurrency',
        'heavy=2',
        '--runs-dir',
        runsDir(),
        '--output',
        'json',
      ])
      expect(r.code).toBe(0)
      const out = JSON.parse(r.stdout).workflowResult
      expect(out.count).toBe(6)
      expect(out.results.every((x: unknown) => typeof x === 'string')).toBe(true)
    },
    300_000,
  )

  test.if(live)(
    'clean failure on an invalid model (agent-adapters Vi-1)',
    async () => {
      const r = await runCli([
        'run',
        path.join(FIX, 'error-path.workflow.js'),
        '--adapter',
        'codex',
        '--codex-model',
        'definitely-not-a-real-model-xyz',
        '--runs-dir',
        runsDir(),
        '--output',
        'json',
      ])
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/codex exec exited|error/i)
    },
    120_000,
  )

  test.if(!live)('skipped unless OWF_LIVE_CODEX_EVAL=1', () => {
    expect(true).toBe(true)
  })
})
