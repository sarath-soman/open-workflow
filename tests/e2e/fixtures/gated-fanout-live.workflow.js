export const meta = {
  name: 'gated-fanout-live',
  description: 'gate a wide heavy fan-out against real codex latency',
  phases: [{ title: 'fanout' }],
}

phase('fanout')

const cases = ['one', 'two', 'three', 'four', 'five', 'six']
const results = await parallel(
  cases.map((item) => () => agent(`Reply with exactly one word about ${item}.`, { label: `heavy:${item}` })),
)

return { count: results.length, results }
