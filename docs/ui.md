# UI and Rendering

The runtime should own workflow rendering. Agent hosts such as Codex or Claude may
display summaries, but they should not be required to render workflow state.

## Event Source

All UIs read `events.jsonl` and `state.json`.

```json
{"type":"phase.entered","phase":"impl"}
{"type":"agent.started","effectId":"abc","label":"implement"}
{"type":"agent.completed","effectId":"abc","label":"implement"}
```

Execution and rendering stay separate:

- runner appends events;
- console renderer prints compact status;
- TUI tails events;
- web UI can read the same files later.

## Output Modes

Current:

- `pretty`: concise terminal summary at completion.
- `json`: complete run result at completion.

Planned:

- `stream-json`: one event per line during execution.
- `tui`: terminal dashboard.
- `html`: static run report.

## TUI Shape

```text
open-workflow: swe #run_123

validate  ✓  42s
impl      ●  running  agent:swe-implementer
review    ·  pending
publish   ·  pending
learn     ·  pending

events
12:04 phase impl entered
12:05 agent implement started
```

The TUI should not drive execution directly. It should subscribe to the run
directory and render state.

## Agent Host Interfaces

Codex and other hosts need only:

1. run the CLI;
2. show the run id and outcome;
3. inspect events/state on failure.

Rich rendering belongs in `open-workflow render`, not in each agent host.

