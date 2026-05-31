# open-workflow

Claude Code-compatible workflow runtime, with portable agent adapters and
runtime-owned controls for fanout, resume, telemetry, and UI.

The base DSL is intentionally source-compatible with Claude Code Dynamic
Workflows. A workflow that uses the compatible surface should be able to keep the
same shape across Claude Code and Open Workflow:

```js
export const meta = {
  name: 'example',
  description: 'Run a deterministic control flow around agent effects',
  phases: [{ title: 'plan' }, { title: 'review' }],
}

phase('plan')
const plan = await agent('Create a plan.', { label: 'planner' })

phase('review')
const checks = await parallel([
  () => agent('Check feasibility.', { label: 'feasibility' }),
  () => agent('Check documentation.', { label: 'docs' }),
])

return { outcome: 'complete', plan, checks }
```

Open Workflow may add extra runtime features where the Claude-compatible surface
is not enough, but those features should live in runtime policy, config, adapters,
or clearly-marked optional extensions. They should not force ordinary workflow
scripts to stop looking like Claude Code workflows.

The control-flow contract is simple:

- workflow JavaScript owns deterministic orchestration;
- `agent()` is the nondeterministic effect boundary;
- the runtime records effects to an event log so completed calls can be replayed;
- scheduler-owned concurrency gates control model fanout without sleeps or clocks;
- adapters decide how an agent is actually run: Codex, Claude CLI, OpenAI API,
  mock fixtures, or another local tool.

## Why This Exists

Claude Code workflows are the right programming model: JavaScript orchestration,
isolated `agent()` effects, `parallel()`, `pipeline()`, `phase()`, `log()`, and
return values instead of chat-context sprawl.

The missing piece is portability and operational control. We need the same
workflow shape to run through Codex, Claude, mocks, direct API adapters, or a
future local worker pool, while keeping rate limits, budget limits, resume, and
rendering outside the prompt.

## Compatibility Rule

The default DSL is the Claude Code workflow DSL:

```text
args
agent(prompt, opts?)
workflow(nameOrPath, args?)
parallel(tasks)
pipeline(items, ...stages)
phase(title)
log(message)
export const meta = { name, description, phases }
```

Open Workflow-specific behavior should be additive:

- Config can assign scheduler policy to existing `agent()` fields such as
  `label`, `phase`, `agentType`, and `model`.
- Adapters can interpret `agentType`, `schema`, `skills`, and `metadata`.
- UI renderers can consume `events.jsonl` and `state.json`.
- Optional extensions may be added later, but compatible workflow files should
  remain the common case.

## Rate vs Total

There are two independent failure modes. A workflow runtime has to model both.

| Axis | Rate, per minute | Total, per run |
| --- | --- | --- |
| Failure it prevents | throttle / 429 -> silent truncation -> ghost 0/19 | runaway spend -> a multi-million-token prove-nothing blast |
| Lever | `HEAVY`: concurrent heavy agents | `budget.remaining()` / run budget |
| Question it answers | "will this get throttled?" | "can I afford to finish?" |

`HEAVY` caps the flow. Budget caps the integral.

You can be safe on one axis and still blow the other. `HEAVY=1` avoids TPM burst
pressure, but `N=20 x 50 cases` can still spend a fortune slowly. Budget catches
that. `HEAVY` cannot.

## HEAVY: The Throttle Gate

Workflow scripts should not pace by sleeping. Claude-style workflow scripts do
not have useful wall-clock primitives, and Open Workflow blocks `Date` and timers
inside workflow code for the same reason: clocks are the wrong abstraction here.

The only reliable rate lever is how many heavy model effects are active at once.
Open Workflow therefore gates `agent()` effects directly.

Config maps existing Claude-compatible `agent()` options to concurrency groups:

```json
{
  "concurrency": {
    "default": 4,
    "groups": {
      "heavy": 1,
      "judge": 3
    },
    "rules": [
      { "group": "heavy", "labelPrefix": "run:" },
      { "group": "judge", "labelPrefix": "judge:" }
    ]
  }
}
```

The workflow remains compatible:

```js
const runs = await parallel(
  cases.map((caseDir) => () =>
    agent(`Run case ${caseDir}`, {
      label: `run:${caseDir}`,
      agentType: 'weave-runner',
    }),
  ),
)
```

The runtime emits `agent.queued`, `agent.started`, `agent.completed`, and
`agent.released`. UI and telemetry can show queue pressure without the workflow
knowing about sleeps or TPM windows.

## Budget: The Runaway Backstop

Budget is a separate control. It is not a substitute for `HEAVY`.

For input-dominated workloads, budget can be a loose proxy. A common eval pattern
has each run-agent re-read a large skill or corpus across many tool turns. The
thing that trips TPM is the input burst, which is governed by `HEAVY` and may be
mostly invisible to an output-token budget meter.

So budget should be read as:

```text
have I crossed a runaway threshold?
```

not:

```text
what did this run truly cost?
```

The true cost model should be calibrated from a slice:

```text
agents = 2 * cases * N
steps = ceil((cases * N) / HEAVY)
true_token_cost ~= agents * calibrated_per_agent_input
full_cost ~= slice_cost * (full_jobs / slice_jobs)
```

During execution, the harness should use two independent gates:

- `HEAVY`, static: set so `HEAVY * burst_tokens` stays below account TPM.
- Budget, dynamic: check remaining headroom at the top of each heavy step.

When budget stops a run, un-run work must be reported as `not_run`, not `failed`.
That distinction is load-bearing for eval harnesses where missing runs otherwise
count as failures. A budget stop is an affordability stop, not evidence that the
skill or agent is weak.

Compatible workflow shape:

```js
const floor = args?.floor ?? 60_000

for (let i = 0; i < jobs.length; i += HEAVY) {
  if (budget.total && budget.remaining() < floor) {
    log(`budget floor hit; ${jobs.length - i} jobs left not_run`)
    break
  }

  const slice = jobs.slice(i, i + HEAVY)
  // run the heavy slice
}
```

Budget support is an Open Workflow runtime feature to finish after the
concurrency gate. It should remain a circuit-breaker, not the primary rate
control.

## Status

Early runtime scaffold. The MVP runs `.workflow.js` files through the `mock`
adapter, writes a durable run directory, and exposes the same core globals Claude
Code workflows use: `args`, `agent`, `workflow`, `parallel`, `pipeline`, `phase`,
and `log`. Runtime-owned concurrency gates are implemented. Budget backstop
support is the next control to add.

## Quick Start

```bash
bun install
bun run ow validate examples/hello.workflow.js
bun run ow run examples/hello.workflow.js \
  --adapter mock \
  --args '{"topic":"workflow runtime"}'
```

Named workflows are resolved from `open-workflow.config.json`:

```bash
bun run ow run hello --args '{"topic":"codex adapter"}'
bun run ow run gated-fanout --concurrency heavy=1
```

Runs are stored under `.open-workflow/runs/<run-id>/`:

```text
script.workflow.js
args.json
events.jsonl
state.json
```

## Commands

```bash
open-workflow run <workflow.js|name> [--args JSON_OR_FILE] [--adapter mock]
open-workflow validate <workflow.js|name>
open-workflow status <run-id>
open-workflow resume <run-id>
```

For local development, call the workspace CLI through Bun:

```bash
bun run ow run hello
```

## Packages

```text
packages/core          workflow loader, runtime, event log, DSL globals
packages/cli           Bun CLI
packages/adapter-mock  deterministic quota-free adapter
```

The CLI imports package exports directly from the workspace. Build output is not
required for development; Bun runs the TypeScript sources.

## Design Documents

- [DSL](docs/dsl.md)
- [Invocation](docs/invocation.md)
- [Adapters](docs/adapters.md)
- [UI and Rendering](docs/ui.md)
- [Resume and Event Log](docs/resume.md)
- [Security](docs/security.md)
