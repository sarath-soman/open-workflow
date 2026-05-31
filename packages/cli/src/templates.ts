/**
 * Scaffolding templates for `owf new`. Each produces a strict-clean, runnable
 * `.workflow.js` — correct-by-construction beats blank-page generation. The
 * e2e suite asserts every template passes `validate --strict` and runs on mock.
 */
export type TemplateName = 'basic' | 'pipeline' | 'gated-fanout' | 'judge-panel'

export const TEMPLATE_NAMES: TemplateName[] = ['basic', 'pipeline', 'gated-fanout', 'judge-panel']

export function renderTemplate(name: TemplateName, workflowName: string): string {
  return TEMPLATES[name](workflowName)
}

const TEMPLATES: Record<TemplateName, (name: string) => string> = {
  basic: (name) => `export const meta = {
  name: '${name}',
  description: 'TODO: describe what this workflow does',
  phases: [{ title: 'main' }],
}

phase('main')
const result = await agent(\`Do the task for \${args.topic ?? 'the input'}.\`, { label: 'main' })

return { result }
`,

  pipeline: (name) => `export const meta = {
  name: '${name}',
  description: 'TODO: describe what this workflow does',
  phases: [{ title: 'process' }],
}

phase('process')
const items = args.items ?? ['a', 'b', 'c']
const results = await pipeline(
  items,
  (item) => agent(\`Step one for \${item}.\`, { label: 'step-one' }),
  (prev) => agent(\`Step two refining: \${prev}.\`, { label: 'step-two' }),
)

return { results }
`,

  'gated-fanout': (name) => `export const meta = {
  name: '${name}',
  description: 'TODO: describe what this workflow does',
  phases: [{ title: 'fanout' }],
}

phase('fanout')
const cases = args.cases ?? ['one', 'two', 'three']
// Label effects 'heavy:*' so a concurrency rule can gate the burst:
//   owf run ${name} --concurrency heavy=1
const results = await parallel(
  cases.map((item) => () => agent(\`Process case \${item}.\`, { label: \`heavy:\${item}\` })),
)

return { results }
`,

  'judge-panel': (name) => `export const meta = {
  name: '${name}',
  description: 'TODO: describe what this workflow does',
  phases: [{ title: 'draft' }, { title: 'judge' }],
}

const verdict = {
  type: 'object',
  properties: { verdict: { enum: ['accept', 'revise'] }, note: { type: 'string' } },
  required: ['verdict', 'note'],
}

phase('draft')
const draft = await agent(\`Draft a solution for \${args.task ?? 'the task'}.\`, { label: 'drafter' })

phase('judge')
const judgements = await parallel([
  () => agent(\`Judge correctness of: \${draft}\`, { label: 'judge:correctness', schema: verdict }),
  () => agent(\`Judge clarity of: \${draft}\`, { label: 'judge:clarity', schema: verdict }),
])

return { draft, judgements }
`,
}
