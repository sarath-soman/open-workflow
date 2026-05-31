import crypto from 'node:crypto'
import { appendFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentAdapter,
  ConcurrencyConfig,
  JsonSchema,
  RuntimeOptions,
  WorkflowMeta,
  WorkflowRunResult,
} from './types.js'

type EffectState = {
  effectId: string
  status: 'running' | 'completed' | 'failed'
  kind: 'agent'
  prompt: string
  opts: AgentOptions
  callIndex: number
  phase?: string | undefined
  concurrencyGroup?: string | undefined
  startedAt: string
  completedAt?: string | undefined
  output?: unknown
  transcriptRef?: string | undefined
  usage?: unknown
  error?: { message: string; stack?: string | undefined }
}

type AgentOptions = {
  label?: string | undefined
  phase?: string | undefined
  agentType?: string | undefined
  model?: string | undefined
  schema?: JsonSchema | undefined
  cwd?: string | undefined
  skills?: string[] | undefined
  metadata?: Record<string, unknown> | undefined
}

type WorkflowState = {
  runId: string
  status: 'running' | 'completed' | 'failed'
  workflow: WorkflowMeta
  scriptPath: string
  originalScriptPath: string
  args: Record<string, unknown>
  effects: Record<string, EffectState>
  phases: Array<{ title: string; enteredAt: string }>
  logs: Array<{ ts: string; phase: string | null; message: string }>
  result?: unknown
  error?: { message: string; stack?: string | undefined }
}

type RuntimeContext = {
  meta: WorkflowMeta
  args: Record<string, unknown>
  adapter: AgentAdapter
  cwd: string
  workflowDir: string
  runsDir: string
  runDir: string
  runId: string
  state: WorkflowState
  statePath: string
  eventsPath: string
  concurrency: NormalizedConcurrencyConfig
  gates: ConcurrencyGates
}

type RuntimeApi = RuntimeContext & {
  agent(prompt: string, opts?: AgentOptions): Promise<unknown>
  workflow(nameOrPath: string, args?: Record<string, unknown>): Promise<unknown>
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]>
  pipeline<T>(
    items: T[],
    ...stages: Array<(value: unknown, item: T) => Promise<unknown>>
  ): Promise<unknown[]>
  phase(title: string): void
  log(message: string): void
  emit(type: string, payload?: Record<string, unknown>): void
}

export async function validateWorkflowFile(scriptPath: string) {
  const source = await fs.readFile(scriptPath, 'utf8')
  const { meta } = extractMeta(source)
  validateMeta(meta)
  return { path: scriptPath, meta }
}

export async function runWorkflowFile(
  scriptPath: string,
  options: InternalRuntimeOptions,
): Promise<WorkflowRunResult> {
  const absScriptPath = path.resolve(scriptPath)
  const source = await fs.readFile(absScriptPath, 'utf8')
  const { meta, executableSource } = extractMeta(source)
  validateMeta(meta)

  const runId = options.runId || createRunId(meta.name)
  const runsDir = path.resolve(options.runsDir)
  const runDir = path.join(runsDir, runId)
  await fs.mkdir(runDir, { recursive: true })

  const persistedScriptPath = path.join(runDir, 'script.workflow.js')
  if (!options.runId) {
    await fs.writeFile(persistedScriptPath, source)
    await fs.writeFile(path.join(runDir, 'args.json'), JSON.stringify(options.args ?? {}, null, 2))
  }

  const statePath = path.join(runDir, 'state.json')
  const eventsPath = path.join(runDir, 'events.jsonl')
  const initialState: WorkflowState = {
    runId,
    status: 'running',
    workflow: meta,
    scriptPath: options.runId ? absScriptPath : persistedScriptPath,
    originalScriptPath: absScriptPath,
    args: options.args ?? {},
    effects: {},
    phases: [],
    logs: [],
  }
  const state = await loadOrCreateState(statePath, initialState)
  state.status = 'running'
  state.workflow = meta
  state.args = options.args ?? state.args ?? {}

  const runtime = createRuntime({
    meta,
    args: state.args,
    adapter: options.adapter,
    concurrency: normalizeConcurrency(options.concurrency),
    cwd: options.cwd,
    gates: options.gates ?? new Map(),
    workflowDir: path.dirname(absScriptPath),
    runsDir,
    runDir,
    runId,
    state,
    statePath,
    eventsPath,
  })

  runtime.emit('workflow.started', { runId, workflow: meta.name })
  let workflowResult: unknown
  try {
    workflowResult = await executeWorkflow(executableSource, runtime)
    state.status = 'completed'
    state.result = workflowResult
    runtime.emit('workflow.completed', { result: workflowResult })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    state.status = 'failed'
    state.error = { message: err.message, stack: err.stack }
    runtime.emit('workflow.failed', { message: err.message })
    throw err
  } finally {
    await saveState(statePath, state)
  }

  return {
    status: state.status,
    runId,
    runDir,
    eventsPath,
    statePath,
    scriptPath: state.scriptPath,
    meta,
    workflowResult,
  }
}

function createRuntime(ctx: RuntimeContext): RuntimeApi {
  let effectCounter = 0
  let currentPhase: string | null = null

  function emit(type: string, payload: Record<string, unknown> = {}) {
    const event = {
      ts: new Date().toISOString(),
      runId: ctx.runId,
      type,
      ...payload,
    }
    appendFileSync(ctx.eventsPath, `${JSON.stringify(event)}\n`)
  }

  async function persist() {
    await saveState(ctx.statePath, ctx.state)
  }

  async function agent(prompt: string, opts: AgentOptions = {}) {
    const callIndex = effectCounter++
    const normalized = {
      prompt,
      opts,
      callIndex,
      adapter: ctx.adapter.name,
      workflow: ctx.meta.name,
    }
    const effectId = sha256(JSON.stringify(normalized)).slice(0, 16)
    const cached = ctx.state.effects[effectId]
    if (cached?.status === 'completed') {
      emit('agent.replayed', { effectId, label: opts.label, phase: opts.phase || currentPhase })
      return cached.output
    }

    const effect: EffectState = {
      effectId,
      status: 'running',
      kind: 'agent',
      prompt,
      opts,
      callIndex,
      phase: opts.phase || currentPhase || undefined,
      startedAt: new Date().toISOString(),
    }
    ctx.state.effects[effectId] = effect
    const concurrencyGroup = resolveConcurrencyGroup(opts, currentPhase, ctx.concurrency)
    effect.concurrencyGroup = concurrencyGroup
    const gate = getGate(ctx.gates, ctx.concurrency, concurrencyGroup)
    emit('agent.queued', {
      effectId,
      concurrencyGroup,
      label: opts.label,
      phase: effect.phase,
      agentType: opts.agentType,
    })
    await persist()

    const release = await gate.acquire()
    emit('agent.started', {
      effectId,
      concurrencyGroup,
      label: opts.label,
      phase: effect.phase,
      agentType: opts.agentType,
    })
    try {
      const result = await ctx.adapter.run(
        {
          prompt,
          label: opts.label,
          phase: effect.phase,
          agentType: opts.agentType,
          model: opts.model,
          schema: opts.schema,
          cwd: opts.cwd || ctx.cwd,
          skills: opts.skills,
          metadata: opts.metadata,
        },
        { runId: ctx.runId, runDir: ctx.runDir, effectId },
      )

      effect.status = 'completed'
      effect.completedAt = new Date().toISOString()
      effect.output = result.output
      effect.transcriptRef = result.transcriptRef
      effect.usage = result.usage
      emit('agent.completed', {
        effectId,
        concurrencyGroup,
        label: opts.label,
        phase: effect.phase,
      })
      await persist()
      return result.output
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      effect.status = 'failed'
      effect.completedAt = new Date().toISOString()
      effect.error = { message: err.message, stack: err.stack }
      emit('agent.failed', {
        effectId,
        concurrencyGroup,
        label: opts.label,
        phase: effect.phase,
        message: err.message,
      })
      await persist()
      throw err
    } finally {
      release()
      emit('agent.released', {
        effectId,
        concurrencyGroup,
        label: opts.label,
        phase: effect.phase,
      })
    }
  }

  async function childWorkflow(nameOrPath: string, args: Record<string, unknown> = {}) {
    const workflowPath = resolveChildWorkflow(nameOrPath, ctx.workflowDir)
    const result = await runWorkflowFile(workflowPath, {
      args,
      adapter: ctx.adapter,
      concurrency: ctx.concurrency,
      cwd: ctx.cwd,
      gates: ctx.gates,
      runsDir: ctx.runsDir,
    })
    return result.workflowResult
  }

  async function parallel<T>(tasks: Array<() => Promise<T>>) {
    if (!Array.isArray(tasks)) throw new Error('parallel expects an array of task functions')
    emit('parallel.started', { count: tasks.length, phase: currentPhase })
    const results = await Promise.all(tasks.map((task) => task()))
    emit('parallel.completed', { count: tasks.length, phase: currentPhase })
    return results
  }

  async function pipeline<T>(
    items: T[],
    ...stages: Array<(value: unknown, item: T) => Promise<unknown>>
  ) {
    if (!Array.isArray(items)) throw new Error('pipeline expects an array of items')
    emit('pipeline.started', { count: items.length, stages: stages.length, phase: currentPhase })
    const results = await Promise.all(
      items.map(async (item) => {
        let value: unknown = item
        for (const stage of stages) value = await stage(value, item)
        return value
      }),
    )
    emit('pipeline.completed', { count: items.length, stages: stages.length, phase: currentPhase })
    return results
  }

  function phase(title: string) {
    currentPhase = title
    ctx.state.phases.push({ title, enteredAt: new Date().toISOString() })
    emit('phase.entered', { phase: title })
  }

  function log(message: string) {
    const text = String(message)
    ctx.state.logs.push({ ts: new Date().toISOString(), phase: currentPhase, message: text })
    emit('log', { phase: currentPhase, message: text })
  }

  return { ...ctx, agent, workflow: childWorkflow, parallel, pipeline, phase, log, emit }
}

type InternalRuntimeOptions = RuntimeOptions & {
  gates?: ConcurrencyGates | undefined
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

type ConcurrencyGates = Map<string, Semaphore>

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

function getGate(
  gates: ConcurrencyGates,
  config: NormalizedConcurrencyConfig,
  group: string,
): Semaphore {
  const existing = gates.get(group)
  if (existing) return existing
  const limit = config.groups[group] ?? config.default
  const gate = new Semaphore(limit === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : limit)
  gates.set(group, gate)
  return gate
}

function resolveConcurrencyGroup(
  opts: AgentOptions,
  currentPhase: string | null,
  config: NormalizedConcurrencyConfig,
) {
  for (const rule of config.rules) {
    if (rule.label !== undefined && rule.label !== opts.label) continue
    if (rule.labelPrefix !== undefined && !opts.label?.startsWith(rule.labelPrefix)) continue
    if (rule.phase !== undefined && rule.phase !== (opts.phase || currentPhase)) continue
    if (rule.agentType !== undefined && rule.agentType !== opts.agentType) continue
    if (rule.model !== undefined && rule.model !== opts.model) continue
    return rule.group
  }
  return 'default'
}

async function executeWorkflow(source: string, runtime: RuntimeApi) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>
  const fn = new AsyncFunction(
    'args',
    'agent',
    'workflow',
    'parallel',
    'pipeline',
    'phase',
    'log',
    'Date',
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'globalThis',
    source,
  )
  const blockedTimer = () => {
    throw new Error('workflow scripts cannot use timers; gate agent concurrency instead')
  }
  return fn(
    runtime.args,
    runtime.agent,
    runtime.workflow,
    runtime.parallel,
    runtime.pipeline,
    runtime.phase,
    runtime.log,
    createBlockedDate(),
    blockedTimer,
    blockedTimer,
    blockedTimer,
    blockedTimer,
    createBlockedGlobal(),
  )
}

function createBlockedDate() {
  const blocked = () => {
    throw new Error('workflow scripts cannot use Date; control pacing with agent concurrency')
  }
  return Object.assign(blocked, {
    now: blocked,
    parse: blocked,
    UTC: blocked,
  })
}

function createBlockedGlobal() {
  return {
    Date: createBlockedDate(),
    setTimeout: () => {
      throw new Error('workflow scripts cannot use timers; gate agent concurrency instead')
    },
    setInterval: () => {
      throw new Error('workflow scripts cannot use timers; gate agent concurrency instead')
    },
    clearTimeout: () => {
      throw new Error('workflow scripts cannot use timers; gate agent concurrency instead')
    },
    clearInterval: () => {
      throw new Error('workflow scripts cannot use timers; gate agent concurrency instead')
    },
  }
}

export function extractMeta(source: string): { meta: WorkflowMeta; executableSource: string } {
  const marker = 'export const meta'
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) throw new Error('workflow must begin with `export const meta = ...`')
  const eqIndex = source.indexOf('=', markerIndex)
  if (eqIndex === -1) throw new Error('workflow meta must assign a literal object')
  const objectStart = source.indexOf('{', eqIndex)
  if (objectStart === -1) throw new Error('workflow meta must be an object literal')
  const objectEnd = findMatchingBrace(source, objectStart)
  const literal = source.slice(objectStart, objectEnd + 1)
  const meta = Function(`"use strict"; return (${literal});`)() as WorkflowMeta
  const executableSource = `${source.slice(0, markerIndex)}const meta = ${literal}${source.slice(objectEnd + 1)}`
  return { meta, executableSource }
}

function findMatchingBrace(source: string, start: number) {
  let depth = 0
  let quote: string | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('unterminated workflow meta object')
}

function validateMeta(meta: WorkflowMeta) {
  if (!meta || typeof meta !== 'object') throw new Error('workflow meta must be an object')
  if (!meta.name || typeof meta.name !== 'string')
    throw new Error('workflow meta.name must be a string')
  if (!meta.description || typeof meta.description !== 'string') {
    throw new Error('workflow meta.description must be a string')
  }
  if (!Array.isArray(meta.phases)) throw new Error('workflow meta.phases must be an array')
}

async function loadOrCreateState(statePath: string, fallback: WorkflowState) {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8')) as WorkflowState
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback
    throw error
  }
}

async function saveState(statePath: string, state: WorkflowState) {
  await fs.writeFile(statePath, JSON.stringify(state, null, 2))
}

function resolveChildWorkflow(nameOrPath: string, workflowDir: string) {
  if (nameOrPath.endsWith('.js') || nameOrPath.includes('/') || nameOrPath.includes('\\')) {
    return path.resolve(workflowDir, nameOrPath)
  }
  return path.resolve(workflowDir, `${nameOrPath}.workflow.js`)
}

function createRunId(name: string) {
  const safe = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'workflow'
  return `${safe}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
