import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockAdapter } from '@open-workflow/adapter-mock'
import { runWorkflowFile } from '@open-workflow/core'
import { countingAdapter, trackingAdapter } from '../helpers.js'

async function freshDir(tag: string) {
  return mkdtempSync(path.join(tmpdir(), `owf-${tag}-`))
}

// workflow-runtime V-4 — a run is immutable once started.
describe('frozen gap: run immutability (workflow-runtime V-4)', () => {
  test('resume replays the persisted script, ignoring later source edits', async () => {
    const dir = await freshDir('immut')
    const script = path.join(dir, 'wf.workflow.js')
    const runsDir = path.join(dir, 'runs')
    await fs.writeFile(
      script,
      "export const meta = { name: 'm', description: 'd', phases: [] }\nreturn { v: 1 }",
    )
    const first = await runWorkflowFile(script, {
      args: {},
      adapter: createMockAdapter(),
      cwd: dir,
      runsDir,
    })
    expect(first.workflowResult).toEqual({ v: 1 })

    // edit the source after the run, then resume
    await fs.writeFile(
      script,
      "export const meta = { name: 'm', description: 'd', phases: [] }\nreturn { v: 999 }",
    )
    const resumed = await runWorkflowFile(first.scriptPath, {
      args: {},
      adapter: createMockAdapter(),
      cwd: dir,
      runsDir,
      runId: first.runId,
    })
    expect(resumed.workflowResult).toEqual({ v: 1 }) // persisted, not the edited 999
  })
})

// concurrency-scheduler V-3 / workflow-runtime F-3 — child shares the parent gate.
describe('frozen gap: child shares parent scheduler (concurrency-scheduler V-3)', () => {
  test("a child workflow's effects are gated by the parent run's limits", async () => {
    const dir = await freshDir('child-gate')
    await fs.writeFile(
      path.join(dir, 'child.workflow.js'),
      "export const meta = { name: 'c', description: 'd', phases: [] }\nconst r = await parallel([() => agent('a', { label: 'heavy:c1' }), () => agent('b', { label: 'heavy:c2' })])\nreturn { r }",
    )
    const parent = path.join(dir, 'parent.workflow.js')
    await fs.writeFile(
      parent,
      "export const meta = { name: 'p', description: 'd', phases: [] }\nconst c = await workflow('./child.workflow.js', {})\nreturn { c }",
    )
    const { adapter, maxActive } = trackingAdapter()
    await runWorkflowFile(parent, {
      args: {},
      adapter,
      concurrency: { groups: { heavy: 1 }, rules: [{ group: 'heavy', labelPrefix: 'heavy:' }] },
      cwd: dir,
      runsDir: path.join(dir, 'runs'),
    })
    // shared scheduler → the child's two heavy effects serialize to peak 1
    // (an unshared child would spin its own unbounded gate → peak 2)
    expect(maxActive()).toBe(1)
  })
})

// durable-run-state V-4 — at-least-once: a running (incomplete) effect re-runs.
describe('frozen gap: at-least-once delivery (durable-run-state V-4)', () => {
  test('a running effect re-runs on resume; a completed one does not', async () => {
    const dir = await freshDir('alo')
    const script = path.join(dir, 'wf.workflow.js')
    const runsDir = path.join(dir, 'runs')
    await fs.writeFile(
      script,
      "export const meta = { name: 'm', description: 'd', phases: [] }\nconst a = await agent('x', { label: 'a' })\nconst b = await agent('y', { label: 'b' })\nreturn { a, b }",
    )
    const first = await runWorkflowFile(script, {
      args: {},
      adapter: countingAdapter().adapter,
      cwd: dir,
      runsDir,
    })

    // simulate a crash mid-flight: mark the first effect 'running', drop its output
    const state = JSON.parse(await fs.readFile(first.statePath, 'utf8'))
    const effects = state.effects as Record<
      string,
      { callIndex: number; status: string; output?: unknown }
    >
    const firstEffect = Object.values(effects).find((e) => e.callIndex === 0)
    if (!firstEffect) throw new Error('no effect at callIndex 0')
    firstEffect.status = 'running'
    firstEffect.output = undefined
    await fs.writeFile(first.statePath, JSON.stringify(state, null, 2))

    const { adapter, calls } = countingAdapter()
    await runWorkflowFile(first.scriptPath, {
      args: {},
      adapter,
      cwd: dir,
      runsDir,
      runId: first.runId,
    })
    expect(calls()).toBe(1) // 'a' (was running) re-runs; 'b' (completed) is replayed
  })
})
