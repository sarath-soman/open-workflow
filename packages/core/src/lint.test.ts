import { describe, expect, test } from 'bun:test'
import { DSL_CONTRACT } from './dsl.js'
import { lintWorkflow } from './lint.js'

const META = "export const meta = { name: 'w', description: 'd', phases: [{ title: 'plan' }] }"

function rules(source: string): string[] {
  return lintWorkflow(source).map((f) => f.rule)
}

describe('lint: meta integrity', () => {
  test('clean minimal workflow has no findings', () => {
    const src = `${META}\nphase('plan')\nconst a = await agent('go', { label: 'a' })\nreturn { a }`
    expect(lintWorkflow(src)).toEqual([])
  })

  test('missing meta is an error', () => {
    const findings = lintWorkflow("phase('plan')")
    expect(findings.some((f) => f.rule === 'meta' && f.severity === 'error')).toBe(true)
  })

  test('meta with a missing name is an error', () => {
    const src = "export const meta = { description: 'd', phases: [] }"
    expect(lintWorkflow(src).some((f) => f.rule === 'meta')).toBe(true)
  })
})

describe('lint: forbidden identifiers', () => {
  for (const f of DSL_CONTRACT.forbidden) {
    test(`flags ${f.name} as an error`, () => {
      const usage = f.name === 'Math.random' ? 'Math.random()' : `${f.name}`
      const src = `${META}\nphase('plan')\nconst x = ${usage}\nreturn {}`
      const found = lintWorkflow(src).filter((r) => r.rule === `no-${f.name}`)
      expect(found.length).toBeGreaterThan(0)
      expect(found[0]?.severity).toBe('error')
    })
  }

  test('does NOT flag a forbidden word inside a prompt string (masking)', () => {
    const src = `${META}\nphase('plan')\nconst a = await agent('summarize the import news for this date and the Math.random talk')\nreturn { a }`
    expect(rules(src)).not.toContain('no-Date')
    expect(rules(src)).not.toContain('no-import')
    expect(rules(src)).not.toContain('no-Math.random')
  })

  test('does NOT flag a forbidden word inside a comment', () => {
    const src = `${META}\nphase('plan')\n// remember: no Date or setTimeout here\nconst a = await agent('go')\nreturn { a }`
    expect(rules(src)).not.toContain('no-Date')
    expect(rules(src)).not.toContain('no-setTimeout')
  })

  test('does NOT flag substrings of allowed identifiers', () => {
    const src = `${META}\nphase('plan')\nconst updateDate = 1\nconst important = 2\nreturn { updateDate, important }`
    expect(rules(src)).not.toContain('no-Date')
    expect(rules(src)).not.toContain('no-import')
  })

  test('reports the correct line number', () => {
    const src = `${META}\nphase('plan')\nconst t = Date.now()\nreturn {}`
    const finding = lintWorkflow(src).find((f) => f.rule === 'no-Date')
    expect(finding?.line).toBe(3)
  })
})

describe('lint: phase consistency', () => {
  test('warns when a phase is entered but not declared', () => {
    const src = `${META}\nphase('undeclared')\nreturn {}`
    expect(rules(src)).toContain('phase-not-declared')
  })

  test('warns when a declared phase is never entered', () => {
    const src = `${META}\nreturn {}`
    expect(rules(src)).toContain('phase-not-entered')
  })

  test('no phase warnings when declared and entered match', () => {
    const src = `${META}\nphase('plan')\nreturn {}`
    expect(rules(src)).not.toContain('phase-not-declared')
    expect(rules(src)).not.toContain('phase-not-entered')
  })
})

describe('lint: agent() options', () => {
  test('flags an unknown option key', () => {
    const src = `${META}\nphase('plan')\nconst a = await agent('go', { label: 'a', bogus: 1 })\nreturn { a }`
    const f = lintWorkflow(src).find((x) => x.rule === 'unknown-agent-option')
    expect(f?.message).toContain('bogus')
  })

  test('accepts all contract option keys', () => {
    const src = `${META}\nphase('plan')\nconst a = await agent('go', { label: 'a', phase: 'plan', agentType: 't', model: 'm', schema: {}, cwd: '.', skills: [], metadata: {} })\nreturn { a }`
    expect(rules(src)).not.toContain('unknown-agent-option')
  })

  test('bails (no false positive) on a spread options object', () => {
    const src = `${META}\nphase('plan')\nconst opts = { label: 'a' }\nconst a = await agent('go', { ...opts })\nreturn { a }`
    expect(rules(src)).not.toContain('unknown-agent-option')
  })
})
