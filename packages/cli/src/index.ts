#!/usr/bin/env bun

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createMockAdapter } from '@open-workflow/adapter-mock'
import type { ConcurrencyConfig } from '@open-workflow/core'
import { runWorkflowFile, validateWorkflowFile } from '@open-workflow/core'

const DEFAULT_RUNS_DIR = '.open-workflow/runs'

type Flags = Record<string, string | boolean>

type ParsedArgs = {
  positional: string[]
  flags: Flags
}

export async function main(argv: string[]) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'run') return runCommand(rest)
  if (command === 'validate') return validateCommand(rest)
  if (command === 'status') return statusCommand(rest)
  if (command === 'resume') return resumeCommand(rest)

  throw new Error(`unknown command: ${command}`)
}

async function runCommand(argv: string[]) {
  const { positional, flags } = parseArgs(argv)
  const target = positional[0]
  if (!target) throw new Error('run requires a workflow script path or name')

  const cwd = path.resolve(stringFlag(flags.cwd) || process.cwd())
  const runsDir = path.resolve(cwd, stringFlag(flags['runs-dir']) || DEFAULT_RUNS_DIR)
  const config = await loadConfigFromFlags(cwd, flags)
  const adapter = adapterFromFlags(flags)
  const args = await parseJsonOrFile(stringFlag(flags.args) ?? '{}', cwd)
  const workflowPath = resolveWorkflowTarget(target, cwd, config)

  const result = await runWorkflowFile(workflowPath, {
    args,
    adapter,
    concurrency: concurrencyFromFlags(flags, config?.concurrency),
    cwd,
    runsDir,
    output: outputFlag(flags.output),
  })

  renderRunResult(result, outputFlag(flags.output))
}

async function validateCommand(argv: string[]) {
  const { positional, flags } = parseArgs(argv)
  const target = positional[0]
  if (!target) throw new Error('validate requires a workflow script path or name')
  const cwd = path.resolve(stringFlag(flags.cwd) || process.cwd())
  const config = await loadConfigFromFlags(cwd, flags)
  const workflowPath = resolveWorkflowTarget(target, cwd, config)
  const validation = await validateWorkflowFile(workflowPath)
  if (flags.output === 'json') {
    console.log(JSON.stringify(validation, null, 2))
    return
  }
  console.log(`valid workflow: ${validation.meta.name}`)
  console.log(validation.path)
}

async function statusCommand(argv: string[]) {
  const { positional, flags } = parseArgs(argv)
  const runId = positional[0]
  if (!runId) throw new Error('status requires a run id')
  const cwd = path.resolve(stringFlag(flags.cwd) || process.cwd())
  const runsDir = path.resolve(cwd, stringFlag(flags['runs-dir']) || DEFAULT_RUNS_DIR)
  const statePath = path.join(runsDir, runId, 'state.json')
  const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as Record<string, unknown>
  if (flags.output === 'json') {
    console.log(JSON.stringify(state, null, 2))
    return
  }
  const workflow = state.workflow as { name?: string } | undefined
  const effects = state.effects as Record<string, unknown> | undefined
  console.log(`${state.status}: ${workflow?.name ?? '(unknown workflow)'}`)
  console.log(`run: ${state.runId}`)
  console.log(`effects: ${Object.keys(effects || {}).length}`)
  if ('result' in state) console.log(`result: ${JSON.stringify(state.result)}`)
}

async function resumeCommand(argv: string[]) {
  const { positional, flags } = parseArgs(argv)
  const runId = positional[0]
  if (!runId) throw new Error('resume requires a run id')
  const cwd = path.resolve(stringFlag(flags.cwd) || process.cwd())
  const runsDir = path.resolve(cwd, stringFlag(flags['runs-dir']) || DEFAULT_RUNS_DIR)
  const config = await loadConfigFromFlags(cwd, flags)
  const runDir = path.join(runsDir, runId)
  const state = JSON.parse(await fs.readFile(path.join(runDir, 'state.json'), 'utf8')) as {
    scriptPath: string
    args?: Record<string, unknown>
  }
  const adapter = adapterFromFlags(flags)
  const result = await runWorkflowFile(state.scriptPath, {
    args: state.args ?? {},
    adapter,
    concurrency: concurrencyFromFlags(flags, config?.concurrency),
    cwd,
    runsDir,
    runId,
    output: outputFlag(flags.output),
  })
  renderRunResult(result, outputFlag(flags.output))
}

function adapterFromFlags(flags: Flags) {
  const name = stringFlag(flags.adapter) || 'mock'
  if (name !== 'mock') {
    throw new Error(`adapter "${name}" is not implemented yet; use --adapter mock`)
  }
  return createMockAdapter({
    responses: flags['mock-responses'] ? JSON.parse(String(flags['mock-responses'])) : {},
  })
}

function resolveWorkflowTarget(target: string, cwd: string, config: OpenWorkflowConfig | null) {
  if (target.endsWith('.js') || target.includes('/') || target.includes('\\')) {
    return path.resolve(cwd, target)
  }

  const mapped = config?.workflows?.[target]
  if (!mapped) throw new Error(`unknown workflow name "${target}"`)
  return path.resolve(cwd, mapped)
}

async function loadConfigFromFlags(cwd: string, flags: Flags) {
  const configPath = stringFlag(flags.config)
  return configPath
    ? await loadConfig(path.resolve(cwd, configPath))
    : await loadConfigIfPresent(cwd)
}

async function loadConfigIfPresent(cwd: string) {
  for (const name of ['open-workflow.config.json', '.open-workflow/config.json']) {
    try {
      return await loadConfig(path.join(cwd, name))
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    }
  }
  return null
}

async function loadConfig(configPath: string) {
  return JSON.parse(await fs.readFile(configPath, 'utf8')) as OpenWorkflowConfig
}

type OpenWorkflowConfig = {
  workflows?: Record<string, string>
  concurrency?: ConcurrencyConfig
}

function concurrencyFromFlags(
  flags: Flags,
  config?: ConcurrencyConfig,
): ConcurrencyConfig | undefined {
  const concurrency: ConcurrencyConfig = {
    default: config?.default,
    groups: { ...(config?.groups ?? {}) },
    rules: [...(config?.rules ?? [])],
  }
  const defaultLimit = stringFlag(flags['agent-concurrency'])
  if (defaultLimit) concurrency.default = parsePositiveInteger(defaultLimit, '--agent-concurrency')

  const groupSpec = stringFlag(flags.concurrency)
  if (groupSpec) {
    for (const part of groupSpec.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const [name, value] = trimmed.split('=')
      if (!name || !value) throw new Error(`invalid --concurrency entry: ${trimmed}`)
      const limit = parsePositiveInteger(value, `--concurrency ${name}`)
      if (name === 'default') concurrency.default = limit
      else concurrency.groups = { ...(concurrency.groups ?? {}), [name]: limit }
    }
  }

  if (
    concurrency.default === undefined &&
    Object.keys(concurrency.groups ?? {}).length === 0 &&
    (concurrency.rules ?? []).length === 0
  ) {
    return undefined
  }
  return concurrency
}

function parsePositiveInteger(value: string, flag: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer; got ${value}`)
  }
  return parsed
}

async function parseJsonOrFile(value: string, cwd: string): Promise<Record<string, unknown>> {
  const trimmed = value.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>
  return JSON.parse(await fs.readFile(path.resolve(cwd, trimmed), 'utf8')) as Record<
    string,
    unknown
  >
}

function renderRunResult(
  result: Awaited<ReturnType<typeof runWorkflowFile>>,
  output: 'pretty' | 'json',
) {
  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(`${result.status}: ${result.meta.name}`)
  console.log(`run: ${result.runId}`)
  console.log(`dir: ${result.runDir}`)
  if (result.workflowResult !== undefined) {
    console.log(`result: ${JSON.stringify(result.workflowResult)}`)
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token?.startsWith('--')) {
      if (token) positional.push(token)
      continue
    }
    const eq = token.indexOf('=')
    if (eq !== -1) {
      flags[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return { positional, flags }
}

function stringFlag(value: string | boolean | undefined) {
  return typeof value === 'string' ? value : undefined
}

function outputFlag(value: string | boolean | undefined): 'pretty' | 'json' {
  return value === 'json' ? 'json' : 'pretty'
}

function printHelp() {
  console.log(`open-workflow

Usage:
  open-workflow run <workflow.js|name> [--args JSON_OR_FILE] [--adapter mock] [--output pretty|json]
                     [--agent-concurrency N] [--concurrency GROUP=N[,GROUP=N]]
  open-workflow validate <workflow.js|name>
  open-workflow status <run-id>
  open-workflow resume <run-id>

MVP adapter:
  mock
`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
