export const meta = {
  name: 'schema-variety',
  description: 'exercise codex strict-schema normalization across distinct shapes',
  phases: [{ title: 'check' }],
}

phase('check')

const flat = await agent('Reply with verdict "ok" and a one-word note.', {
  label: 'heavy:flat',
  schema: {
    type: 'object',
    properties: { verdict: { enum: ['ok', 'revise'] }, note: { type: 'string' } },
    required: ['verdict'],
  },
})

const nested = await agent(
  'Reply with status "done" and a detail object whose count is the number 1.',
  {
    label: 'heavy:nested',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        detail: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
      },
      required: ['status', 'detail'],
    },
  },
)

const list = await agent('Reply with items: an array of two objects, each with a name string.', {
  label: 'heavy:list',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    },
    required: ['items'],
  },
})

const scalarEnum = await agent('Reply with choice "a".', {
  label: 'heavy:enum',
  schema: { type: 'object', properties: { choice: { enum: ['a', 'b', 'c'] } }, required: ['choice'] },
})

return { flat, nested, list, scalarEnum }
