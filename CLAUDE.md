# CLAUDE.md

Canonical agent + contributor guide for `open-workflow`. `AGENTS.md` references this file.

## What
Claude Code-compatible workflow runtime. A `*.workflow.js` is deterministic JS orchestration
around nondeterministic `agent()` effects. The runtime records effects to an event log
(replay/resume), gates fanout via a central `Scheduler`, and runs agents through pluggable
adapters (`mock`, `codex`). Design rationale in `README.md`; per-surface notes in `docs/`.

## Stack
- Bun is runtime + package manager (`bun@1.3.10`, Bun ≥1.3 / Node ≥22). TS runs directly — **no build step for dev**.
- Bun workspaces monorepo; packages under `packages/*`.

## Commands
| cmd | what |
|---|---|
| `bun install` | deps + workspace links |
| `bun run check` | tsc + biome — **run before committing** |
| `bun test` | unit + integration + e2e (skill-eval); `bun:test`, no deps |
| `bun run format` | biome autofix |
| `bun run smoke` | quick e2e `hello` via mock |
| `bun run ow <cmd>` / `owf <cmd>` | CLI: `run` · `validate` · `status` · `resume` |
| `bun run build` | compile host `owf` → `dist/owf` |
| `bun run build:all` | cross-compile every release target |

## Layout
```
packages/core           loader, runtime, event log, DSL globals, Scheduler
packages/cli            Bun CLI (owf) — imports workspace exports directly
packages/adapter-mock   deterministic, quota-free
packages/adapter-codex  each agent() → `codex exec`
scripts/install.sh      curl|bash installer (GH releases)
scripts/build.sh        cross-compile matrix
examples/*.workflow.js  sample workflows (biome-excluded)
docs/                   dsl · invocation · adapters · ui · resume · security
open-workflow.config.json  named workflows · concurrency policy · defaultAdapter
.open-workflow/runs/    runtime-owned state — gitignored, never hand-edit
```

## Invariants — do not break
- **DSL is a compatibility contract.** Globals `args agent workflow parallel pipeline phase log` +
  `export const meta` stay source-compatible with Claude Code Dynamic Workflows. OWF-specific behavior
  is **additive only** — layer policy onto existing `agent()` fields (`label phase agentType model schema
  skills metadata`), never new required syntax in workflow files. Holds hardest in `packages/core`.
- **No clocks in workflow code.** `Date`/timers are blocked inside scripts (`runtime.ts`). Pace via
  concurrency, not sleeps.
- **Scheduler is central; gate, not queue.** One `Scheduler` per run (shared into child workflows) owns
  the run-global control axes. It decides *whether* an effect starts; the workflow's own `await` owns
  *order*. Order must stay deterministic — replay depends on it. Don't actor-ize it; don't make it pull work.
- **Two axes, kept separate:** concurrency groups cap *rate* (TPM/throttle); budget caps *total* (spend).
  Neither substitutes for the other. Budget stops mark un-run work `not_run`, not `failed`.
  (Budget is the next control to land — on the Scheduler.)
- **Adapters get explicit task packets.** No ambient session context — pass via `prompt`/`metadata`/`skills`/files.

## Conventions
- Biome-enforced: single quotes, no semicolons, 2-space indent, 100 cols. Don't hand-fight it — `bun run format`.
- **Imports use `.js` extensions on `.ts` sources** — required by `moduleResolution: NodeNext` + emitted
  declarations (`composite`/`declaration: true`). Do **not** rewrite to `.ts` (needs
  `allowImportingTsExtensions`, which conflicts with declaration emit). Bun resolves `.js`→`.ts` at runtime.
  Biome auto-sorts imports and exports.
- Conventional-commit titles for commits/PRs (`feat fix chore docs refactor test ci build perf`).

## Tests
`bun test` (built-in runner, no deps). Layers:
- **Unit** — co-located `packages/**/*.test.ts`: scheduler (rules + gate), lint (every rule + string-masking), dsl (contract↔lint consistency), extractMeta, both adapters (codex via a stub bin).
- **Integration** — `tests/integration/`: every DSL construct through the mock adapter + combinations; policy (concurrency gating, replay/resume, event+state shape, blocked-globals throw).
- **E2E / skill-eval** — `tests/e2e/`: spawns the real CLI; skill-eval asserts the SKILL.md references only routed commands and that its prescribed loop (`dsl`→`validate --strict`→`run --adapter mock`) succeeds on shipped examples. A live-Codex eval is gated behind `OWF_LIVE_CODEX_EVAL=1` (off by default — quota-spending).

When adding a DSL global or policy, add its unit + integration coverage and keep the dsl↔lint consistency test green.

## Operating the runtime (as an agent)
Use a workflow when one exists — don't inline its phases by hand. Read the script +
`open-workflow.config.json` first. `validate` before `run`. `mock` for deterministic checks.
`resume <run-id>` over restart. Report run id + outcome + failed effect labels, not full transcripts.

## Release
`owf` ships as a standalone Bun executable. A `v*` tag triggers `.github/workflows/release.yml`, which
cross-compiles and uploads assets named `owf-<os>-<arch>`; `scripts/install.sh` is the `curl | bash`
target. Install root `~/.owf/bin`.

## Status
Early scaffold. Runs `.workflow.js` via mock + codex, durable run dir, core DSL globals, central
`Scheduler` with concurrency gates. Next: budget backstop (on the Scheduler).
