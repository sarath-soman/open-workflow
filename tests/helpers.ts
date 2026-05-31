import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMockAdapter } from '@open-workflow/adapter-mock'
import type { AgentAdapter, ConcurrencyConfig } from '@open-workflow/core'
import { runWorkflowFile } from '@open-workflow/core'

export type RunOpts = {
  args?: Record<string, unknown>
  adapter?: AgentAdapter
  concurrency?: ConcurrencyConfig
}

/** Write a workflow source to a fresh tmp dir and run it (mock adapter by default). */
export async function runWorkflow(source: string, opts: RunOpts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'owf-it-'))
  const scriptPath = path.join(dir, 'wf.workflow.js')
  await fs.writeFile(scriptPath, source)
  const runsDir = path.join(dir, 'runs')
  const result = await runWorkflowFile(scriptPath, {
    args: opts.args ?? {},
    adapter: opts.adapter ?? createMockAdapter(),
    concurrency: opts.concurrency,
    cwd: dir,
    runsDir,
  })
  return {
    result,
    dir,
    runsDir,
    scriptPath,
    events: () => readEvents(result.eventsPath),
    state: async () => JSON.parse(await fs.readFile(result.statePath, 'utf8')),
  }
}

export async function readEvents(eventsPath: string): Promise<Array<Record<string, unknown>>> {
  const text = await fs.readFile(eventsPath, 'utf8')
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

/** Adapter that counts run() calls — used to prove replay does not re-invoke. */
export function countingAdapter(): { adapter: AgentAdapter; calls: () => number } {
  let calls = 0
  return {
    calls: () => calls,
    adapter: {
      name: 'counting',
      async run(input) {
        calls++
        return { output: `out:${input.label ?? input.prompt}` }
      },
    },
  }
}

/** Adapter that tracks peak concurrency — used to prove the gate throttles. */
export function trackingAdapter(): { adapter: AgentAdapter; maxActive: () => number } {
  let active = 0
  let maxActive = 0
  return {
    maxActive: () => maxActive,
    adapter: {
      name: 'tracking',
      async run(input) {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return { output: `out:${input.label ?? ''}` }
      },
    },
  }
}
