# Invocation

The CLI is the stable user-facing entry point.

## Direct Script

```bash
open-workflow run ./workflows/swe.workflow.js \
  --adapter mock \
  --args '{"issue":123}'
```

During local development:

```bash
bun run ow run ./examples/hello.workflow.js \
  --adapter mock \
  --args '{"topic":"agent fanout"}'
```

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
