/**
 * The authoring skill installed into Codex by `owf codex install`. Codex
 * discovers skills under `$CODEX_HOME/skills/<name>/SKILL.md` (default
 * `~/.codex/skills/`) — no marketplace required. The body deliberately defers
 * the DSL surface to `owf dsl` so the skill never drifts from the binary.
 */
export const AUTHOR_WORKFLOW_SKILL_NAME = 'author-workflow'

export const AUTHOR_WORKFLOW_SKILL = `---
name: author-workflow
description: Author and validate open-workflow \`.workflow.js\` files — deterministic agent-orchestration scripts run by the \`owf\` CLI. Use when the user wants to create, write, scaffold, or fix an open-workflow / owf workflow, orchestrate multiple agent() steps with parallel/pipeline/phase, or turn a multi-step task into a runnable workflow. Trigger on "author a workflow", "create an owf workflow", "write a workflow.js", "orchestrate agents with open-workflow".
---

# Author open-workflow workflows

Produce a correct, runnable \`.workflow.js\` for the \`owf\` runtime, then prove it on the
quota-free \`mock\` adapter before spending real model calls.

## Contract first

Run \`owf dsl\` and treat its output as law — it prints the exact globals, the allowed \`agent()\`
options, the JSON-schema shape, and the hard invariants. Do not invent APIs.

Key invariants (full list in \`owf dsl\`):

- The file is deterministic JS. No \`Date\`, timers, \`Math.random\`, \`fetch\`, \`import\`/\`require\`.
- \`agent(prompt, opts?)\` is the only nondeterministic effect; \`parallel\`/\`pipeline\` join effects.
- Pace fan-out with concurrency labels, never by sleeping or watching a clock.
- \`export const meta = { name, description, phases }\` must be a plain object literal, and every
  \`phase('X')\` call must appear in \`meta.phases\`.

## Loop

1. Write the workflow. For heavy fan-out, label effects (e.g. \`label: 'heavy:<id>'\`) so the runtime
   can gate concurrency.
2. \`owf validate <file> --strict\` — fix every finding, repeat until clean.
3. \`owf run <file> --adapter mock --output json\` — deterministic dry run, zero spend. Check the
   returned shape; \`owf status <run-id>\` shows the phase / effect / concurrency-group structure.
4. Only when the shape is right: \`owf run <file> --adapter codex\` for the real run.
5. Report the run id, outcome, and any failed effect labels — not full transcripts.

## Patterns

- Sequential: \`const a = await agent(...); const b = await agent(...)\`
- Fan-out + join: \`await parallel([() => agent(...), () => agent(...)])\`
- Per-item stages: \`await pipeline(items, (x) => agent(...), (prev) => agent(...))\`
- Typed output: pass \`schema\` (JSON Schema) to \`agent()\`; the result is the parsed object.

When an example in the open-workflow repo (\`examples/*.workflow.js\`) matches the shape, start from it.
`
