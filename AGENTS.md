# Agent Instructions

Use `open-workflow` when the task names an existing workflow or asks for
orchestrated agent execution.

## Operating Rules

- Do not manually inline workflow phases when a workflow script exists.
- Read the workflow script and config before running it.
- Prefer `validate` before `run`.
- Use the `mock` adapter for runtime checks and deterministic examples.
- Use `resume` for interrupted runs instead of restarting from scratch.
- Treat `.open-workflow/runs/*` as runtime-owned state. Do not edit run files by
  hand unless the user explicitly asks for recovery surgery.
- Keep agent inputs explicit. Do not rely on hidden chat/session context.
- Report the run id, final outcome, and failed effect labels. Do not dump full
  transcripts unless asked.

## Codex Usage Pattern

When asked to run a workflow from Codex:

1. Inspect `open-workflow.config.json` and the target `.workflow.js`.
2. Run `bun run ow validate <target>`.
3. Run `bun run ow run <target> --adapter <adapter> --args <json>`.
4. If a run fails, inspect `events.jsonl` and `state.json`.
5. Resume with `bun run ow resume <run-id>` after correcting the
   workflow or adapter issue.

## Adapter Discipline

Adapters must receive explicit task packets. A workflow agent call should not get
the parent assistant's full session by default. If a future adapter needs extra
context, pass it deliberately through `prompt`, `metadata`, `skills`, or a
workflow artifact path.
