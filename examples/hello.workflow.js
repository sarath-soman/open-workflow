export const meta = {
  name: 'hello',
  description: 'Demonstrate the Claude-compatible workflow surface',
  phases: [{ title: 'plan' }, { title: 'fanout' }, { title: 'finish' }],
}

phase('plan')
log(`topic: ${args.topic ?? 'open workflow'}`)

const plan = await agent(`Create a short plan for ${args.topic ?? 'open workflow'}.`, {
  label: 'planner',
})

phase('fanout')
const checks = await parallel([
  () =>
    agent('Check the plan for runtime risks.', {
      label: 'risk-check',
      schema: {
        type: 'object',
        properties: { verdict: { enum: ['ok', 'revise'] }, note: { type: 'string' } },
        required: ['verdict', 'note'],
      },
    }),
  () =>
    agent('Check the plan for user-facing documentation gaps.', {
      label: 'docs-check',
      schema: {
        type: 'object',
        properties: { verdict: { enum: ['ok', 'revise'] }, note: { type: 'string' } },
        required: ['verdict', 'note'],
      },
    }),
])

phase('finish')
return { outcome: 'complete', plan, checks }
