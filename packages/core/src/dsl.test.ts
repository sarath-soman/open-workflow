import { describe, expect, test } from 'bun:test'
import { DSL_CONTRACT, renderDslContract } from './dsl.js'
import { lintWorkflow } from './lint.js'

describe('DSL contract', () => {
  test('declares the seven workflow globals', () => {
    const names = DSL_CONTRACT.globals.map((g) => g.name).sort()
    expect(names).toEqual(['agent', 'args', 'log', 'parallel', 'phase', 'pipeline', 'workflow'])
  })

  test('agent options match the documented surface', () => {
    const opts = DSL_CONTRACT.agentOptions.map((o) => o.name).sort()
    expect(opts).toEqual(
      ['agentType', 'cwd', 'label', 'metadata', 'model', 'phase', 'schema', 'skills'].sort(),
    )
  })

  test('forbidden list covers clocks, timers, and non-determinism', () => {
    const names = DSL_CONTRACT.forbidden.map((f) => f.name)
    for (const expected of [
      'Date',
      'setTimeout',
      'setInterval',
      'Math.random',
      'fetch',
      'import',
    ]) {
      expect(names).toContain(expected)
    }
  })

  test('renderDslContract includes every section and global', () => {
    const md = renderDslContract()
    expect(md).toContain('# open-workflow DSL contract')
    expect(md).toContain('## Globals')
    expect(md).toContain('## Invariants')
    expect(md).toContain('## Not allowed in workflow code')
    for (const g of DSL_CONTRACT.globals) expect(md).toContain(g.name)
  })

  test('consistency: every forbidden identifier is actually caught by the linter', () => {
    // Guards against the contract and linter drifting apart.
    const meta = "export const meta = { name: 'w', description: 'd', phases: [{ title: 'plan' }] }"
    for (const f of DSL_CONTRACT.forbidden) {
      const usage = f.name === 'Math.random' ? 'Math.random()' : f.name
      const src = `${meta}\nphase('plan')\nconst x = ${usage}\nreturn {}`
      const caught = lintWorkflow(src).some((finding) => finding.rule === `no-${f.name}`)
      expect(caught).toBe(true)
    }
  })
})
