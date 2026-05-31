# open-workflow

Source-compatible runtime for Claude Code-style workflow scripts with pluggable
agent adapters.

The control-flow contract is simple:

- workflow JavaScript owns deterministic orchestration;
- `agent()` is the nondeterministic effect boundary;
- the runtime records effects to an event log so completed calls can be replayed;
- adapters decide how an agent is actually run: Codex, Claude CLI, OpenAI API,
  mock fixtures, or another local tool.

## Status

Early runtime scaffold. The MVP runs `.workflow.js` files through the `mock`
adapter, writes a durable run directory, and exposes the same core globals Claude
Code workflows use: `args`, `agent`, `workflow`, `parallel`, `pipeline`, `phase`,
and `log`.

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
```

Runs are stored under `.open-workflow/runs/<run-id>/`:

```text
script.workflow.js
args.json
events.jsonl
state.json
```

## Workflow Shape

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
