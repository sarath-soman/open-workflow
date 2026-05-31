# Invocation

The CLI is the stable user-facing entry point.

## Direct Script

```bash
open-workflow run ./workflows/swe.workflow.js \
  --adapter mock \
  --args '{"issue":123}' \
  --agent-concurrency 3
```

During local development:

```bash
bun run ow run ./examples/hello.workflow.js \
  --adapter mock \
  --args '{"topic":"agent fanout"}'
```

## Concurrency Gates

The runtime gates `agent()` effects directly. This is how workflows control
tokens-per-minute pressure when the host workflow language has no sleep or clock
APIs.

Set a global default:

```bash
bun run ow run hello --agent-concurrency 3
```

Set named groups:

```bash
bun run ow run gated-fanout --concurrency heavy=1,judge=3
```

Workflow code remains Claude-compatible and uses ordinary labels:

```js
await agent('Run expensive analysis.', {
  label: 'heavy:analysis',
})
```

Config maps those labels to groups:

```json
{
  "concurrency": {
    "groups": { "heavy": 1 },
    "rules": [{ "group": "heavy", "labelPrefix": "heavy:" }]
  }
}
```

`parallel()` may still create many tasks. The scheduler queues agent effects at
the group boundary and emits `agent.queued`, `agent.started`, `agent.completed`,
and `agent.released` events.

## Named Workflow

`open-workflow.config.json` maps names to script paths:

```json
{
  "workflows": {
    "hello": "examples/hello.workflow.js"
  }
}
```

Invoke:

```bash
bun run ow run hello
```

## JSON Args

Pass JSON directly:

```bash
bun run ow run hello --args '{"topic":"resume"}'
```

Or pass a file path:

```bash
bun run ow run hello --args ./args.json
```

## Resume

```bash
bun run ow resume <run-id>
```

Resume replays the script and returns cached outputs for completed `agent()`
effects with the same call identity.

## Inspect

```bash
bun run ow status <run-id>
cat .open-workflow/runs/<run-id>/events.jsonl
cat .open-workflow/runs/<run-id>/state.json
```

## Planned Invocation Modes

- `--output stream-json` for live machine-readable events.
- `open-workflow render <run-id> --format tui` for a terminal UI.
- `open-workflow run --remote` for remote runner backends.
- `open-workflow agent run <effect-id>` for adapter debugging.
