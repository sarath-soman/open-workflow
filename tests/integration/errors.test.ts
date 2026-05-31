import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentAdapter } from '@open-workflow/core'
import { runWorkflowFile } from '@open-workflow/core'
import { runWorkflow } from '../helpers.js'

// Adapter that throws for effects whose label starts with 'boom'.
function explodingAdapter(): AgentAdapter {
  return {
    name: 'exploding',
    async run(input) {
      if (input.label?.startsWith('boom')) throw new Error(`adapter blew up on ${input.label}`)
      return { output: `ok:${input.label ?? ''}` }
    },
  }
}

const META = (phases = '') =>
  `export const meta = { name: 'e', description: 'd', phases: [${phases}] }`

describe('error propagation', () => {
  test('a failing sequential agent rejects the workflow and records the effect failed', async () => {
    const src = `${META()}\nawait agent('x', { label: 'boom-1' })\nreturn {}`
    const dir = mkdtempSync(path.join(tmpdir(), 'owf-err-'))
    const script = path.join(dir, 'wf.workflow.js')
    await fs.writeFile(script, src)
    const runsDir = path.join(dir, 'runs')
    expect(
      runWorkflowFile(script, { args: {}, adapter: explodingAdapter(), cwd: dir, runsDir }),
    ).rejects.toThrow(/blew up/)
    // give the rejected run a tick, then assert state recorded the failure
    await new Promise((r) => setTimeout(r, 50))
    const runs = await fs.readdir(runsDir)
    const state = JSON.parse(
      await fs.readFile(path.join(runsDir, runs[0] ?? '', 'state.json'), 'utf8'),
    )
    expect(state.status).toBe('failed')
    expect(
      Object.values(state.effects).some((e: { status: string }) => e.status === 'failed'),
    ).toBe(true)
  })

  test('a failing task in parallel rejects the whole join', async () => {
    const src = `${META()}\nawait parallel([() => agent('a', { label: 'ok-1' }), () => agent('b', { label: 'boom-2' })])\nreturn {}`
    expect(runWorkflow(src, { adapter: explodingAdapter() })).rejects.toThrow(/blew up/)
  })

  test('a throwing pipeline stage rejects the workflow', async () => {
    const src = `${META()}\nawait pipeline(['a'], () => { throw new Error('stage boom') })\nreturn {}`
    expect(runWorkflow(src)).rejects.toThrow(/stage boom/)
  })

  test('a thrown error in workflow body marks status failed with the message', async () => {
    const src = `${META()}\nthrow new Error('explicit')`
    expect(runWorkflow(src)).rejects.toThrow(/explicit/)
  })
})

describe('empty collections', () => {
  test('parallel of no tasks returns []', async () => {
    const { result } = await runWorkflow(`${META()}\nconst r = await parallel([])\nreturn { r }`)
    expect(result.workflowResult).toEqual({ r: [] })
  })

  test('pipeline of no items returns []', async () => {
    const { result } = await runWorkflow(
      `${META()}\nconst r = await pipeline([], (x) => x)\nreturn { r }`,
    )
    expect(result.workflowResult).toEqual({ r: [] })
  })
})
