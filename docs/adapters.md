# Adapters

Adapters execute `agent()` effects. The workflow runtime owns control flow;
adapters own model/tool execution.

The runtime applies concurrency gates before calling an adapter. Adapters do not
need to implement their own fanout queue unless the upstream provider has
additional adapter-specific limits.

## Interface

```ts
interface AgentAdapter {
  name: string
  run(input: AgentRunInput, ctx: AdapterContext): Promise<AgentRunResult>
}

type AgentRunInput = {
  prompt: string
  label?: string
  phase?: string
  agentType?: string
  model?: string
  schema?: JSONSchema
  cwd?: string
  skills?: string[]
  metadata?: Record<string, unknown>
}

type AdapterContext = {
  runId: string
  runDir: string
  effectId: string
}

type AgentRunResult = {
  output: unknown
  transcriptRef?: string
  usage?: unknown
}
```

## Mock Adapter

The mock adapter is deterministic and quota-free. It is the required adapter for
runtime tests.

```bash
bun run ow run hello --adapter mock
```

By default it synthesizes a response from `schema` when available, otherwise it
returns a short text string. Tests can pass explicit mock responses through the
CLI for now:

```bash
bun run ow run hello \
  --mock-responses '{"planner":"fixed plan"}'
```

## Codex Adapter Plan

Codex should be integrated as an adapter, not as hidden orchestration state.
Every `agent()` call should materialize a task packet:

```text
.open-workflow/runs/<run-id>/agents/<effect-id>/
  prompt.md
  input.json
  output-schema.json
  result.json
  transcript.jsonl
```

The adapter can then either:

- invoke a Codex CLI/API with `prompt.md` and explicit context paths; or
- hand the packet to a long-running Codex worker process over JSON stdio.

The adapter returns only `result.json` plus transcript references to the runtime.

## Claude CLI Adapter Plan

Claude Code can be an adapter when available:

```bash
claude -p --agent <agentType> --json-schema <schema> < prompt.md
```

It should be optional. Rate limits or local auth failures must fail the effect
cleanly without changing the workflow DSL.

## Direct OpenAI Adapter Plan

A direct API adapter can map:

- `model` -> OpenAI model name;
- `schema` -> structured output format;
- `skills` -> prompt/context bundle;
- transcript -> response/request JSONL.

This adapter should not inherit the caller's session context unless explicitly
passed in `metadata` or files.
