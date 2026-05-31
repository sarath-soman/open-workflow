# Agent Instructions

The canonical agent + contributor guide for this repo is **[CLAUDE.md](./CLAUDE.md)**. Read it —
it covers the stack, commands, layout, the do-not-break invariants, and conventions. This file is a
thin pointer for tools that look for `AGENTS.md`.

## Operating the runtime (quick reference)

Full detail in CLAUDE.md → "Operating the runtime" and "Invariants".

- Use an existing workflow rather than hand-inlining its phases. Read the workflow script and
  `open-workflow.config.json` before running.
- `owf validate <target>` before `owf run <target> --adapter <adapter> --args <json>`.
- Use the `mock` adapter for deterministic checks; `codex` runs each `agent()` through `codex exec`.
- Prefer `owf resume <run-id>` over restarting; inspect `events.jsonl` / `state.json` on failure.
- `.open-workflow/runs/*` is runtime-owned state — do not hand-edit unless doing recovery surgery.
- Adapters receive explicit task packets. Do not rely on hidden chat/session context; pass anything
  an agent needs through `prompt`, `metadata`, `skills`, or a workflow artifact path.
- Report run id, final outcome, and failed effect labels — not full transcripts unless asked.
