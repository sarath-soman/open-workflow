export const meta = {
  name: 'all-constructs',
  description: 'exercise every DSL construct at least once (for the live Codex eval)',
  phases: [{ title: 'plan' }, { title: 'fanout' }, { title: 'pipe' }, { title: 'child' }],
}

const verdict = {
  type: 'object',
  properties: { verdict: { enum: ['ok', 'revise'] }, note: { type: 'string' } },
  required: ['verdict', 'note'],
}

phase('plan')
log('all-constructs: starting')
const plan = await agent(
  `In one short sentence, plan a task about ${args.topic ?? 'workflows'}.`,
  { label: 'planner' },
)

phase('fanout')
const checks = await parallel([
  () => agent('Reply with verdict "ok" and a one-word note.', { label: 'heavy:risk', schema: verdict }),
  () => agent('Reply with verdict "ok" and a one-word note.', { label: 'heavy:docs', schema: verdict }),
])

phase('pipe')
const refined = await pipeline(['alpha'], (item) =>
  agent(`Reply with exactly one word about ${item}.`, { label: 'pipe-1' }),
)

phase('child')
const sub = await workflow('./child-mini.workflow.js', { n: 1 })

return { plan, checks, refined, sub }
