# Security

The MVP executes local workflow scripts as trusted code.

That matches the intended development loop but is not a sandbox. A workflow can
run arbitrary JavaScript inside the Node process.

## Current Boundary

- Trusted local scripts only.
- No automatic network access in the runtime itself.
- Model/tool effects go through adapters.
- Run state is written under `.open-workflow/runs/`.

## Context Isolation

The runtime does not pass chat/session context into `agent()` automatically.
Agents receive only:

- the prompt;
- options (`agentType`, `model`, `schema`, `skills`, metadata);
- adapter-provided files or context.

This is the key privacy boundary.

## Clock and Timer Boundary

Workflow scripts cannot use `Date`, `Date.now`, `setTimeout`, or `setInterval`.
This mirrors the useful restriction in Claude Code workflows: workflow logic
should not depend on wall-clock pacing. Token pressure is managed through
runtime-owned agent concurrency gates.

## Future Hardening

- VM sandbox for workflow code.
- Capability policy for filesystem/network access.
- Signed workflow manifests.
- Redaction pass for event logs.
- Per-adapter allowlists for tools and files.
