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

## Codex Adapter

Implemented in `packages/adapter-codex`. Codex is integrated as an adapter, not
as hidden orchestration state. Every `agent()` call materializes a task packet:

```text
.open-workflow/runs/<run-id>/agents/<effect-id>/
  prompt.md          the agent prompt
  input.json         label/phase/agentType/model/cwd/skills/metadata + hasSchema
  output-schema.json present only when the agent() call passed a schema
  last-message.txt   Codex's final message (from --output-last-message)
  transcript.jsonl   the full --json event stream
  result.json        what the adapter returned to the runtime
```

It invokes the Codex CLI non-interactively:

```bash
codex exec --json --color never -o <last-message.txt> --skip-git-repo-check \
  -C <cwd> [-m <model>] [-s <sandbox>] [--output-schema <schema>] -
```

Mapping from `AgentRunInput`:

| field | flag |
| --- | --- |
| `prompt` | stdin (`-` forces a stdin read regardless of content) |
| `schema` | `--output-schema <file>`; the final message is parsed as JSON |
| `model` | `-m` (falls back to adapter `model` config) |
| `cwd` | `-C` |

The final message is read from the `--output-last-message` file — the reliable,
JSONL-shape-independent source — while `--json` stdout is retained verbatim as
`transcript.jsonl`. `usage` is best-effort parsed from the JSONL stream. A
non-zero exit fails the effect with the last stderr line; rate limits or auth
failures therefore surface cleanly without changing the workflow DSL.

```bash
bun run ow run hello --adapter codex
bun run ow run hello --adapter codex --codex-model gpt-5-codex --codex-sandbox workspace-write
```

Config knobs (`createCodexAdapter`): `bin` (or `$OPEN_WORKFLOW_CODEX_BIN`),
`model`, `sandbox`, `skipGitRepoCheck`, `configOverrides` (`-c key=value`), and
`extraArgs`. A future long-running Codex worker process over JSON stdio can reuse
the same packet without changing the contract.

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
