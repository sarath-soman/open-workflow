import { describe, expect, test } from 'bun:test'
import type { AdapterContext, AgentRunInput } from '@open-workflow/core'
import { createMockAdapter } from './index.js'

const ctx: AdapterContext = { runId: 'r', runDir: '/tmp/r', effectId: 'eff' }

function input(over: Partial<AgentRunInput> = {}): AgentRunInput {
  return { prompt: 'p', ...over }
}

describe('mock adapter: response routing', () => {
  test('returns a fixed response keyed by label', async () => {
    const a = createMockAdapter({ responses: { planner: 'fixed' } })
    expect((await a.run(input({ label: 'planner' }), ctx)).output).toBe('fixed')
  })

  test('falls back to agentType, then effectId', async () => {
    const byType = createMockAdapter({ responses: { judge: 'J' } })
    expect((await byType.run(input({ agentType: 'judge' }), ctx)).output).toBe('J')
    const byEffect = createMockAdapter({ responses: { eff: 'E' } })
    expect((await byEffect.run(input(), ctx)).output).toBe('E')
  })

  test('wildcard * matches any effect', async () => {
    const a = createMockAdapter({ responses: { '*': 'any' } })
    expect((await a.run(input({ label: 'x' }), ctx)).output).toBe('any')
  })
})

describe('mock adapter: schema synthesis', () => {
  test('synthesizes an object honoring required keys', async () => {
    const a = createMockAdapter()
    const schema = {
      type: 'object',
      properties: { verdict: { enum: ['ok', 'revise'] }, note: { type: 'string' } },
      required: ['verdict', 'note'],
    }
    const out = (await a.run(input({ schema }), ctx)).output as Record<string, unknown>
    expect(out.verdict).toBe('ok') // first enum value
    expect(out.note).toBe('')
  })

  test('synthesizes scalars and arrays', async () => {
    const a = createMockAdapter()
    expect((await a.run(input({ schema: { type: 'number' } }), ctx)).output).toBe(0)
    expect((await a.run(input({ schema: { type: 'boolean' } }), ctx)).output).toBe(false)
    expect((await a.run(input({ schema: { type: 'array' } }), ctx)).output).toEqual([])
  })

  test('without a schema returns deterministic text', async () => {
    const a = createMockAdapter()
    const out = (await a.run(input({ label: 'planner' }), ctx)).output
    expect(typeof out).toBe('string')
    expect(out).toContain('planner')
  })
})
