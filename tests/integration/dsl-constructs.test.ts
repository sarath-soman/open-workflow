import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockAdapter } from '@open-workflow/adapter-mock'
import { runWorkflowFile } from '@open-workflow/core'
import { runWorkflow } from '../helpers.js'

const META = (phases: string) =>
  `export const meta = { name: 'w', description: 'd', phases: [${phases}] }`

describe('DSL construct: args', () => {
  test('args are passed through to the script', async () => {
    const src = `${META("{ title: 'p' }")}\nphase('p')\nreturn { topic: args.topic }`
    const { result } = await runWorkflow(src, { args: { topic: 'hello' } })
    expect(result.workflowResult).toEqual({ topic: 'hello' })
  })
})

describe('DSL construct: agent (sequential)', () => {
  test('sequential agents thread values', async () => {
    const adapter = createMockAdapter({ responses: { a: 'A', b: 'B' } })
    const src = `${META("{ title: 'p' }")}
phase('p')
const a = await agent('x', { label: 'a' })
const b = await agent('y', { label: 'b' })
return { a, b }`
    const { result } = await runWorkflow(src, { adapter })
    expect(result.workflowResult).toEqual({ a: 'A', b: 'B' })
  })

  test('schema agent returns a synthesized object', async () => {
    const src = `${META("{ title: 'p' }")}
phase('p')
const v = await agent('check', { label: 'c', schema: { type: 'object', properties: { verdict: { enum: ['ok'] } }, required: ['verdict'] } })
return { v }`
    const { result } = await runWorkflow(src)
    expect(result.workflowResult).toEqual({ v: { verdict: 'ok' } })
  })
})

describe('DSL construct: parallel', () => {
  test('parallel runs and joins all thunks', async () => {
    const adapter = createMockAdapter({ responses: { x: '1', y: '2' } })
    const src = `${META("{ title: 'p' }")}
phase('p')
const r = await parallel([() => agent('a', { label: 'x' }), () => agent('b', { label: 'y' })])
return { r }`
    const { result, events } = await runWorkflow(src, { adapter })
    expect(result.workflowResult).toEqual({ r: ['1', '2'] })
    const types = (await events()).map((e) => e.type)
    expect(types).toContain('parallel.started')
    expect(types).toContain('parallel.completed')
  })
})

describe('DSL construct: pipeline', () => {
  test('each item flows through all stages', async () => {
    const src = `${META("{ title: 'p' }")}
phase('p')
const r = await pipeline(['a', 'b'], (x) => x + '1', (x) => x + '2')
return { r }`
    const { result } = await runWorkflow(src)
    expect(result.workflowResult).toEqual({ r: ['a12', 'b12'] })
  })
})

describe('DSL construct: phase + log', () => {
  test('phases and logs are recorded in state and events', async () => {
    const src = `${META("{ title: 'one' }, { title: 'two' }")}
phase('one')
log('hello')
phase('two')
return {}`
    const { state, events } = await runWorkflow(src)
    const st = await state()
    expect((st.phases as Array<{ title: string }>).map((p) => p.title)).toEqual(['one', 'two'])
    expect((st.logs as Array<{ message: string }>)[0]?.message).toBe('hello')
    expect((await events()).filter((e) => e.type === 'phase.entered').length).toBe(2)
  })
})

describe('DSL construct: child workflow', () => {
  test('workflow() runs a child and returns its result', async () => {
    // The parent invokes a sibling child file by relative path; both share a dir.
    const child =
      "export const meta = { name: 'child', description: 'd', phases: [] }\nreturn { from: 'child', n: args.n }"
    const parent = `export const meta = { name: 'parent', description: 'd', phases: [] }
const c = await workflow('./child.workflow.js', { n: 7 })
return { c }`
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'owf-child-'))
    await fs.writeFile(path.join(dir, 'child.workflow.js'), child)
    const parentPath = path.join(dir, 'parent.workflow.js')
    await fs.writeFile(parentPath, parent)
    const res = await runWorkflowFile(parentPath, {
      args: {},
      adapter: createMockAdapter(),
      cwd: dir,
      runsDir: path.join(dir, 'runs'),
    })
    expect(res.workflowResult).toEqual({ c: { from: 'child', n: 7 } })
  })
})

describe('DSL combination: parallel of schema agents inside a phase', () => {
  test('fan-out of typed checks joins correctly', async () => {
    const src = `${META("{ title: 'review' }")}
phase('review')
const schema = { type: 'object', properties: { verdict: { enum: ['ok'] }, note: { type: 'string' } }, required: ['verdict', 'note'] }
const checks = await parallel([
  () => agent('risk', { label: 'risk', schema }),
  () => agent('docs', { label: 'docs', schema }),
])
return { checks }`
    const { result } = await runWorkflow(src)
    expect(result.workflowResult).toEqual({
      checks: [
        { verdict: 'ok', note: '' },
        { verdict: 'ok', note: '' },
      ],
    })
  })
})
