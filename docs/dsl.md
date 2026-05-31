# DSL

`open-workflow` targets source compatibility with Claude Code Dynamic Workflow
scripts.

Workflow scripts are not the place to pace model calls with wall-clock sleeps.
The runtime blocks `Date` and timer globals in workflow code. Use runtime
concurrency policy instead.

## Required Header

Every script starts with a literal `meta` export:

```js
export const meta = {
  name: 'swe',
  description: 'Run validate -> impl -> review -> publish -> learn',
  phases: [{ title: 'validate' }, { title: 'impl' }],
}
```

The current loader expects a local, trusted script and evaluates the literal.
Computed metadata is intentionally out of scope for the MVP.

## Globals

### `args`

The JSON input passed by the caller.

```js
const issue = args.issue
```

### `agent(prompt, opts?)`

Runs a nondeterministic agent effect through the configured adapter.

```js
const result = await agent('Review the diff.', {
  label: 'review',
  phase: 'review',
  agentType: 'swe-code-reviewer',
  model: 'default',
  schema: {
    type: 'object',
    properties: { verdict: { enum: ['APPROVE', 'BLOCK'] } },
    required: ['verdict'],
  },
})
```

`schema` is passed to the adapter. Adapters that support structured output should
validate or repair output before returning.

Concurrency is not configured in the workflow script. `open-workflow` assigns
agent effects to scheduler gates through config rules that match existing
Claude-compatible fields such as `label`, `phase`, `agentType`, and `model`.

### `workflow(nameOrPath, args?)`

Runs a child workflow and returns its result.

```js
const sub = await workflow('swe', { issue: '123' })
```

Named child workflows currently resolve beside the parent as
`<name>.workflow.js`; config-based named child resolution is planned.

### `parallel(tasks)`

Runs task thunks concurrently and preserves output order.

```js
const out = await parallel([
  () => agent('A', { label: 'a' }),
  () => agent('B', { label: 'b' }),
])
```

### `pipeline(items, ...stages)`

Maps each item through a sequence of async stages. Items run concurrently; stages
within one item run sequentially.

```js
const judged = await pipeline(cases, runCase, judgeCase)
```

### `phase(title)`

Marks the current UI/event-log phase.

### `log(message)`

Writes a workflow log event.

## Compatibility Rule

Avoid adding new globals. Runtime-specific extensions should eventually live
under an explicit namespace such as `ow.*` so Claude-compatible scripts remain
portable.

Concurrency policy intentionally lives outside the workflow DSL. This preserves
the useful invariant: workflow code describes fanout; the runtime owns pressure
control.
