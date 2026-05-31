# Resume and Event Log

Resume is implemented by replaying workflow code and caching completed effects.

## Run Directory

```text
.open-workflow/runs/<run-id>/
  script.workflow.js
  args.json
  events.jsonl
  state.json
```

## Event Log

`events.jsonl` is append-only. It is optimized for humans, TUI rendering, and
post-run analysis.

## State

`state.json` is the runtime checkpoint. It records:

- workflow metadata;
- args;
- phases;
- logs;
- effect inputs and outputs;
- final result or failure.

## Effect Identity

The MVP effect id hashes:

- workflow name;
- adapter name;
- call index;
- prompt;
- options.

This is enough for deterministic scripts. Long-term, loop path and source
locations should be included so editing one part of a workflow invalidates fewer
effects.

Workflow-source effect identity remains based on normal `agent()` inputs.
Changing runtime concurrency policy does not change prompts or adapter outputs;
it changes only scheduling.

## Resume Flow

```bash
bun run ow resume <run-id>
```

The script re-executes. When it reaches a previously completed `agent()` call
with the same effect id, the runtime returns the cached output and emits
`agent.replayed`.

## Durable vs Same-Session

Unlike Claude Code's same-session workflow resume, this runtime persists state to
disk. Adapter-specific sessions may still be ephemeral; the workflow-level result
cache is durable.
