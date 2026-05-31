/**
 * The normative DSL contract — the single source of truth for what a workflow
 * script may use. `owf dsl` prints it; the linter (lint.ts) derives its rules
 * from the same object. Keep this in sync with the runtime globals and the
 * blocked-globals list in runtime.ts.
 */

export type DslContract = {
  globals: Array<{ name: string; signature: string; summary: string }>
  agentOptions: Array<{ name: string; summary: string }>
  invariants: string[]
  /** Identifiers that must not appear in workflow code (token-checked by the linter). */
  forbidden: Array<{ name: string; reason: string }>
}

export const DSL_CONTRACT: DslContract = {
  globals: [
    {
      name: 'args',
      signature: 'args: Record<string, unknown>',
      summary: 'The JSON passed via --args.',
    },
    {
      name: 'agent',
      signature: 'agent(prompt: string, opts?): Promise<unknown>',
      summary: 'The only nondeterministic effect. With a schema, resolves to the parsed object.',
    },
    {
      name: 'workflow',
      signature: 'workflow(nameOrPath: string, args?): Promise<unknown>',
      summary: 'Run a child workflow; shares the parent run’s scheduler.',
    },
    {
      name: 'parallel',
      signature: 'parallel(tasks: Array<() => Promise<T>>): Promise<T[]>',
      summary: 'Run effect thunks concurrently and join. Barrier.',
    },
    {
      name: 'pipeline',
      signature: 'pipeline(items: T[], ...stages): Promise<unknown[]>',
      summary: 'Run each item through all stages independently; no barrier between stages.',
    },
    {
      name: 'phase',
      signature: 'phase(title: string): void',
      summary: 'Enter a phase; groups effects in the trace.',
    },
    {
      name: 'log',
      signature: 'log(message: string): void',
      summary: 'Emit a progress line to the event log.',
    },
  ],
  agentOptions: [
    { name: 'label', summary: 'Display label; drives concurrency-group rules.' },
    { name: 'phase', summary: 'Override the current phase for this effect.' },
    { name: 'agentType', summary: 'Adapter-interpreted agent kind.' },
    { name: 'model', summary: 'Model override (adapter-interpreted).' },
    { name: 'schema', summary: 'JSON Schema; forces structured output, returned parsed.' },
    { name: 'cwd', summary: 'Working directory for the effect.' },
    { name: 'skills', summary: 'Adapter-interpreted skill bundle.' },
    { name: 'metadata', summary: 'Free-form adapter metadata.' },
  ],
  invariants: [
    'The script is deterministic JavaScript. The runtime may replay it; same inputs must take the same path.',
    'agent() is the only nondeterministic boundary. Everything else is plain control flow.',
    'Pace fan-out with concurrency labels (gated by config), never by sleeping or watching a clock.',
    '`export const meta = { name, description, phases }` must be a plain object literal (no variables/calls).',
    "Every phase('X') call should appear in meta.phases, and vice versa.",
    'Open Workflow extensions are additive — never add required syntax beyond these globals.',
  ],
  forbidden: [
    { name: 'Date', reason: 'no clocks — gate concurrency instead of pacing by time' },
    { name: 'setTimeout', reason: 'no timers — gate concurrency instead of sleeping' },
    { name: 'setInterval', reason: 'no timers — gate concurrency instead of sleeping' },
    { name: 'clearTimeout', reason: 'no timers in workflow code' },
    { name: 'clearInterval', reason: 'no timers in workflow code' },
    { name: 'Math.random', reason: 'non-deterministic — breaks replay' },
    {
      name: 'fetch',
      reason: 'non-deterministic I/O — do work inside an agent() effect, not the orchestrator',
    },
    {
      name: 'require',
      reason: 'workflow scripts run in a sandboxed function scope; imports are unavailable',
    },
    {
      name: 'import',
      reason: 'workflow scripts run in a sandboxed function scope; imports are unavailable',
    },
  ],
}

export function renderDslContract(c: DslContract = DSL_CONTRACT): string {
  const lines: string[] = []
  lines.push('# open-workflow DSL contract', '')
  lines.push('A `*.workflow.js` is deterministic JS orchestration around `agent()` effects.', '')
  lines.push('## Globals')
  for (const g of c.globals) lines.push(`- \`${g.signature}\` — ${g.summary}`)
  lines.push('', '## agent() options')
  for (const o of c.agentOptions) lines.push(`- \`${o.name}\` — ${o.summary}`)
  lines.push('', '## Invariants')
  for (const inv of c.invariants) lines.push(`- ${inv}`)
  lines.push('', '## Not allowed in workflow code')
  for (const f of c.forbidden) lines.push(`- \`${f.name}\` — ${f.reason}`)
  lines.push('', '## Shape')
  lines.push('```js')
  lines.push(
    "export const meta = { name: 'example', description: '...', phases: [{ title: 'plan' }] }",
  )
  lines.push('')
  lines.push("phase('plan')")
  lines.push("const plan = await agent('Make a plan.', { label: 'planner' })")
  lines.push("const checks = await parallel([() => agent('Check A.'), () => agent('Check B.')])")
  lines.push("return { outcome: 'complete', plan, checks }")
  lines.push('```')
  return `${lines.join('\n')}\n`
}
