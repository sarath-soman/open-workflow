export const meta = {
  name: 'gated-fanout',
  description: 'Demonstrate scheduler-owned heavy-agent concurrency gating',
  phases: [{ title: 'fanout' }, { title: 'finish' }],
}

const items = args.items ?? ['a', 'b', 'c', 'd', 'e']

phase('fanout')
const outputs = await parallel(
  items.map((item) => () =>
    agent(`Run heavy analysis for ${item}.`, {
      label: `heavy:${item}`,
      schema: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          verdict: { enum: ['ok', 'revise'] },
        },
        required: ['item', 'verdict'],
      },
    }),
  ),
)

phase('finish')
return { outcome: 'complete', count: outputs.length, outputs }
