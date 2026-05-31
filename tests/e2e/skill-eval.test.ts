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

async function skillText(): Promise<string> {
  return (await runCli(['codex', 'install', '--print'])).stdout
}

describe('skill-eval: drift guard', () => {
  test('every `owf <cmd>` the skill prescribes is a real, routed command', async () => {
    const skill = await skillText()
    const cmds = new Set<string>()
    // Commands in the skill are always backtick-delimited, e.g. `owf validate ...`.
    for (const m of skill.matchAll(/`owf ([a-z]+)/g)) if (m[1]) cmds.add(m[1])
    expect(cmds.size).toBeGreaterThan(0)
    for (const cmd of cmds) {
      // A routed command never produces "unknown command"; it either runs or asks for args.
      const { stderr } = await runCli([cmd])
      expect(stderr).not.toContain(`unknown command: ${cmd}`)
    }
  })

  test('the skill defers the DSL surface to `owf dsl` rather than embedding it', async () => {
    const skill = await skillText()
    expect(skill).toContain('owf dsl')
  })
})

describe('skill-eval: prescribed authoring loop works end-to-end', () => {
  // The skill loop is: owf dsl -> owf validate --strict -> owf run --adapter mock.
  // Run it against representative workflows with zero model spend (mock).
  const GOLDEN = `export const meta = { name: 'authored', description: 'a workflow an author would produce', phases: [{ title: 'plan' }, { title: 'review' }] }
phase('plan')
const plan = await agent('Draft a plan.', { label: 'planner' })
phase('review')
const schema = { type: 'object', properties: { verdict: { enum: ['ok', 'revise'] } }, required: ['verdict'] }
const checks = await parallel([
  () => agent('risk', { label: 'heavy:risk', schema }),
  () => agent('docs', { label: 'heavy:docs', schema }),
])
return { outcome: 'complete', plan, checks }`

  test('step 1: owf dsl is available as the contract source', async () => {
    expect((await runCli(['dsl'])).code).toBe(0)
  })

  test('steps 2-3: validate --strict then run --adapter mock on an authored workflow', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-skilleval-'))
    const wf = path.join(dir, 'authored.workflow.js')
    await fs.writeFile(wf, GOLDEN)

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
    const result = JSON.parse(ran.stdout)
    expect(result.status).toBe('completed')
    expect(result.workflowResult.outcome).toBe('complete')
    expect(result.workflowResult.checks).toHaveLength(2)
  })

  test('the shipped example workflows pass the loop', async () => {
    const examples = (await fs.readdir(path.join(REPO, 'examples'))).filter((f) =>
      f.endsWith('.workflow.js'),
    )
    expect(examples.length).toBeGreaterThan(0)
    for (const ex of examples) {
      const wf = path.join(REPO, 'examples', ex)
      const validated = await runCli(['validate', wf])
      expect(validated.code).toBe(0)
      const ran = await runCli([
        'run',
        wf,
        '--adapter',
        'mock',
        '--runs-dir',
        mkdtempSync(path.join(tmpdir(), 'owf-ex-')),
        '--output',
        'json',
      ])
      expect(ran.code).toBe(0)
      expect(JSON.parse(ran.stdout).status).toBe('completed')
    }
  })
})

// Live skill-eval against real Codex. Quota-spending, so opt-in only:
//   OWF_LIVE_CODEX_EVAL=1 bun test tests/e2e/skill-eval.test.ts
// The all-constructs fixture exercises every DSL semantic at least once through
// the real adapter: args, phase, log, plain agent, schema agent, parallel,
// pipeline, child workflow — gated at heavy=1 to also drive the scheduler.
const live = process.env.OWF_LIVE_CODEX_EVAL === '1'
describe('skill-eval: live Codex run (opt-in)', () => {
  test.if(live)(
    'runs every DSL construct through the real codex adapter',
    async () => {
      const ran = await runCli([
        'run',
        path.join(REPO, 'tests/e2e/fixtures/all-constructs.workflow.js'),
        '--adapter',
        'codex',
        '--concurrency',
        'heavy=1',
        '--runs-dir',
        mkdtempSync(path.join(tmpdir(), 'owf-live-')),
        '--args',
        '{"topic":"open workflow"}',
        '--output',
        'json',
      ])
      expect(ran.code).toBe(0)
      const result = JSON.parse(ran.stdout)
      expect(result.status).toBe('completed')
      expect(typeof result.workflowResult.plan).toBe('string')
      expect(result.workflowResult.checks).toHaveLength(2)
      expect(result.workflowResult.checks[0]).toHaveProperty('verdict')
      expect(result.workflowResult.refined).toHaveLength(1)
      expect(result.workflowResult.sub).toEqual({ child: 1 })
    },
    180_000,
  )

  test.if(!live)('skipped unless OWF_LIVE_CODEX_EVAL=1', () => {
    expect(true).toBe(true)
  })
})
