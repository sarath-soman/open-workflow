import type { ConcurrencyConfig } from './types.js'

/**
 * The central scheduler. Single authority for run-global control invariants.
 *
 * Today it owns concurrency admission: it resolves an `agent()` effect to a
 * concurrency group and gates how many effects in that group run at once. Both
 * the HEAVY rate axis and (next) the budget total axis are run-global
 * aggregates, so they belong here rather than being distributed across effects.
 *
 * Shared across a workflow and its child workflows — a child reuses the parent
 * Scheduler so concurrency limits apply across the whole run, not per-script.
 *
 * It is a gate, not a queue: it decides *whether* an effect may start, and the
 * workflow's own control flow owns ordering. That keeps execution order
 * deterministic, which the event-log replay depends on.
 */
export class Scheduler {
  #config: NormalizedConcurrencyConfig
  #gates: Map<string, Semaphore> = new Map()

  constructor(config?: ConcurrencyConfig) {
    this.#config = normalizeConcurrency(config)
  }

  /** Resolve an effect to its concurrency group using config rules (first match wins). */
  resolveGroup(opts: GroupSelector, currentPhase: string | null): string {
    for (const rule of this.#config.rules) {
      if (rule.label !== undefined && rule.label !== opts.label) continue
      if (rule.labelPrefix !== undefined && !opts.label?.startsWith(rule.labelPrefix)) continue
      if (rule.phase !== undefined && rule.phase !== (opts.phase || currentPhase)) continue
      if (rule.agentType !== undefined && rule.agentType !== opts.agentType) continue
      if (rule.model !== undefined && rule.model !== opts.model) continue
      return rule.group
    }
    return 'default'
  }

  /** Acquire a slot in `group`, waiting if the group is at its limit. Resolves to a release fn. */
  async acquire(group: string): Promise<() => void> {
    return this.#gate(group).acquire()
  }

  #gate(group: string): Semaphore {
    const existing = this.#gates.get(group)
    if (existing) return existing
    const limit = this.#config.groups[group] ?? this.#config.default
    const gate = new Semaphore(limit === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : limit)
    this.#gates.set(group, gate)
    return gate
  }
}

export function createScheduler(config?: ConcurrencyConfig): Scheduler {
  return new Scheduler(config)
}

/** Structural subset of agent options the scheduler routes on. */
export type GroupSelector = {
  label?: string | undefined
  phase?: string | undefined
  agentType?: string | undefined
  model?: string | undefined
}

type NormalizedConcurrencyConfig = {
  default: number
  groups: Record<string, number>
  rules: Array<{
    group: string
    label?: string | undefined
    labelPrefix?: string | undefined
    phase?: string | undefined
    agentType?: string | undefined
    model?: string | undefined
  }>
}

class Semaphore {
  readonly limit: number
  #active = 0
  #queue: Array<() => void> = []

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`concurrency limit must be a positive integer; got ${limit}`)
    }
    this.limit = limit
  }

  async acquire(): Promise<() => void> {
    if (this.#active >= this.limit) {
      await new Promise<void>((resolve) => this.#queue.push(resolve))
    }
    this.#active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active--
      const next = this.#queue.shift()
      if (next) next()
    }
  }
}

function normalizeConcurrency(config?: ConcurrencyConfig): NormalizedConcurrencyConfig {
  return {
    default: config?.default ?? Number.POSITIVE_INFINITY,
    groups: config?.groups ?? {},
    rules: config?.rules ?? [],
  }
}
