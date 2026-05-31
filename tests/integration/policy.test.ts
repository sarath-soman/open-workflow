import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockAdapter } from '@open-workflow/adapter-mock'
import { runWorkflowFile } from '@open-workflow/core'
import { countingAdapter, runWorkflow, trackingAdapter } from '../helpers.js'

const FANOUT = `export const meta = { name: 'fan', description: 'd', phases: [{ title: 'p' }] }
phase('p')
const r = await parallel([
  () => agent('1', { label: 'heavy:1' }),
  () => agent('2', { label: 'heavy:2' }),
  () => agent('3', { label: 'heavy:3' }),
  () => agent('4', { label: 'heavy:4' }),
])
return { r }`

describe('policy: concurrency gate', () => {
  test('heavy=1 serializes a labeled fan-out', async () => {
    const { adapter, maxActive } = trackingAdapter()
    await runWorkflow(FANOUT, {
      adapter,
      concurrency: {
        default: 8,
        groups: { heavy: 1 },
        rules: [{ group: 'heavy', labelPrefix: 'heavy:' }],
      },
    })
    expect(maxActive()).toBe(1)
  })

  test('ungated fan-out overlaps up to the parallel width', async () => {
    const { adapter, maxActive } = trackingAdapter()
    await runWorkflow(FANOUT, { adapter, concurrency: { default: 8 } })
    expect(maxActive()).toBe(4)
  })

  test('heavy=2 caps overlap at 2', async () => {
    const { adapter, maxActive } = trackingAdapter()
    await runWorkflow(FANOUT, {
      adapter,
      concurrency: {
        default: 8,
        groups: { heavy: 2 },
        rules: [{ group: 'heavy', labelPrefix: 'heavy:' }],
      },
    })
    expect(maxActive()).toBe(2)
  })

  test('queued/started/released events carry the resolved group', async () => {
    const { events } = await runWorkflow(FANOUT, {
      concurrency: { groups: { heavy: 1 }, rules: [{ group: 'heavy', labelPrefix: 'heavy:' }] },
    })
    const started = (await events()).filter((e) => e.type === 'agent.started')
    expect(started.length).toBe(4)
    expect(started.every((e) => e.concurrencyGroup === 'heavy')).toBe(true)
  })
})

describe('policy: event log + state structure', () => {
  test('emits the expected lifecycle events', async () => {
    const src = `export const meta = { name: 'w', description: 'd', phases: [{ title: 'p' }] }
phase('p')
const a = await agent('go', { label: 'a' })
return { a }`
    const { events, state } = await runWorkflow(src)
    const types = new Set((await events()).map((e) => e.type))
    for (const t of [
      'workflow.started',
      'phase.entered',
      'agent.queued',
      'agent.started',
      'agent.completed',
      'agent.released',
      'workflow.completed',
    ]) {
      expect(types.has(t)).toBe(true)
    }
    const st = await state()
    expect(st.status).toBe('completed')
    expect(Object.keys(st.effects as object).length).toBe(1)
  })
})

describe('policy: replay / resume', () => {
  test('re-running a completed run replays effects without re-invoking the adapter', async () => {
    const src = `export const meta = { name: 'w', description: 'd', phases: [{ title: 'p' }] }
phase('p')
const a = await agent('x', { label: 'a' })
const b = await agent('y', { label: 'b' })
return { a, b }`
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'owf-resume-'))
    const scriptPath = path.join(dir, 'wf.workflow.js')
    await fs.writeFile(scriptPath, src)
    const runsDir = path.join(dir, 'runs')
    const { adapter, calls } = countingAdapter()

    const first = await runWorkflowFile(scriptPath, { args: {}, adapter, cwd: dir, runsDir })
    expect(calls()).toBe(2)

    const second = await runWorkflowFile(scriptPath, {
      args: {},
      adapter,
      cwd: dir,
      runsDir,
      runId: first.runId,
    })
    expect(calls()).toBe(2) // no new invocations — both effects replayed
    expect(second.workflowResult).toEqual(first.workflowResult as object)

    const events = (await fs.readFile(second.eventsPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
    expect(events.some((e) => e.type === 'agent.replayed')).toBe(true)
  })
})

describe('policy: determinism enforcement (blocked globals)', () => {
  test('Date use throws at runtime', async () => {
    const src = `export const meta = { name: 'w', description: 'd', phases: [] }\nconst t = Date.now()\nreturn { t }`
    expect(runWorkflow(src)).rejects.toThrow(/cannot use Date/)
  })

  test('setTimeout use throws at runtime', async () => {
    const src = `export const meta = { name: 'w', description: 'd', phases: [] }\nsetTimeout(() => {}, 1)\nreturn {}`
    expect(runWorkflow(src)).rejects.toThrow(/timers/)
  })

  test('a failed workflow persists status=failed', async () => {
    const src = `export const meta = { name: 'w', description: 'd', phases: [] }\nthrow new Error('boom')`
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'owf-fail-'))
    const scriptPath = path.join(dir, 'wf.workflow.js')
    await fs.writeFile(scriptPath, src)
    const runsDir = path.join(dir, 'runs')
    let runId = ''
    try {
      await runWorkflowFile(scriptPath, {
        args: {},
        adapter: createMockAdapter(),
        cwd: dir,
        runsDir,
      })
    } catch {
      // expected
    }
    const runs = await fs.readdir(runsDir)
    runId = runs[0] ?? ''
    const st = JSON.parse(await fs.readFile(path.join(runsDir, runId, 'state.json'), 'utf8'))
    expect(st.status).toBe('failed')
    expect(st.error?.message).toBe('boom')
  })
})
