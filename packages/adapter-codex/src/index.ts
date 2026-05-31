import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import type {
  AdapterContext,
  AgentAdapter,
  AgentRunInput,
  AgentRunResult,
} from '@open-workflow/core'

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

export type CodexAdapterConfig = {
  /** Codex executable. Defaults to $OPEN_WORKFLOW_CODEX_BIN or `codex`. */
  bin?: string
  /** Default model when an agent() call does not set `model`. */
  model?: string
  /** Sandbox policy passed as `-s`. Left to Codex config when unset. */
  sandbox?: CodexSandbox
  /** Pass `--skip-git-repo-check` so workflows can run outside a repo. Defaults to true. */
  skipGitRepoCheck?: boolean
  /** `-c key=value` config overrides forwarded verbatim. */
  configOverrides?: string[]
  /** Escape hatch: extra flags appended before the prompt argument. */
  extraArgs?: string[]
}

/**
 * Executes `agent()` effects through `codex exec`.
 *
 * Each effect materializes an explicit task packet under
 * `<run-dir>/agents/<effect-id>/` (prompt.md, input.json, output-schema.json,
 * transcript.jsonl, last-message.txt, result.json). The final agent message is
 * read from Codex's `--output-last-message` file — the reliable, JSONL-shape
 * independent source — while `--json` stdout is retained as the transcript.
 */
export function createCodexAdapter(config: CodexAdapterConfig = {}): AgentAdapter {
  const bin = config.bin || process.env.OPEN_WORKFLOW_CODEX_BIN || 'codex'

  return {
    name: 'codex',
    async run(input: AgentRunInput, ctx: AdapterContext): Promise<AgentRunResult> {
      const agentDir = path.join(ctx.runDir, 'agents', ctx.effectId)
      await fs.mkdir(agentDir, { recursive: true })

      const promptPath = path.join(agentDir, 'prompt.md')
      const inputPath = path.join(agentDir, 'input.json')
      const transcriptPath = path.join(agentDir, 'transcript.jsonl')
      const lastMessagePath = path.join(agentDir, 'last-message.txt')
      const resultPath = path.join(agentDir, 'result.json')

      await fs.writeFile(promptPath, input.prompt)
      await fs.writeFile(inputPath, JSON.stringify(serializableInput(input), null, 2))

      const args = ['exec', '--json', '--color', 'never', '-o', lastMessagePath]
      if (config.skipGitRepoCheck !== false) args.push('--skip-git-repo-check')
      if (input.cwd) args.push('-C', input.cwd)
      const model = input.model || config.model
      if (model) args.push('-m', model)
      if (config.sandbox) args.push('-s', config.sandbox)
      for (const override of config.configOverrides ?? []) args.push('-c', override)

      if (input.schema) {
        const schemaPath = path.join(agentDir, 'output-schema.json')
        await fs.writeFile(schemaPath, JSON.stringify(input.schema, null, 2))
        args.push('--output-schema', schemaPath)
      }
      if (config.extraArgs?.length) args.push(...config.extraArgs)
      // `-` forces Codex to read the prompt from stdin regardless of content.
      args.push('-')

      const proc = await runCodex(bin, args, input.prompt)
      await fs.writeFile(transcriptPath, proc.stdout)

      if (proc.code !== 0) {
        throw new Error(
          `codex exec exited with code ${proc.code}` +
            (proc.stderr ? `: ${lastLine(proc.stderr)}` : ''),
        )
      }

      const lastMessage = (await readIfExists(lastMessagePath)) ?? lastAgentMessage(proc.stdout)
      const output = input.schema ? parseStructured(lastMessage) : lastMessage
      const usage = parseUsage(proc.stdout)

      const result: AgentRunResult = {
        output,
        transcriptRef: path.relative(ctx.runDir, transcriptPath),
        usage,
      }
      await fs.writeFile(resultPath, JSON.stringify(result, null, 2))
      return result
    },
  }
}

type CodexProcResult = { stdout: string; stderr: string; code: number }

function runCodex(bin: string, args: string[], stdin: string): Promise<CodexProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        reject(
          new Error(
            `codex binary not found (looked for "${bin}"). Install the Codex CLI or set ` +
              'OPEN_WORKFLOW_CODEX_BIN to its path.',
          ),
        )
        return
      }
      reject(error)
    })
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

function serializableInput(input: AgentRunInput) {
  return {
    label: input.label,
    phase: input.phase,
    agentType: input.agentType,
    model: input.model,
    cwd: input.cwd,
    skills: input.skills,
    metadata: input.metadata,
    hasSchema: Boolean(input.schema),
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    const text = (await fs.readFile(file, 'utf8')).trim()
    return text.length ? text : undefined
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Parse the structured final message, tolerating a fenced ```json block. */
function parseStructured(text: string): unknown {
  const direct = tryParse(text)
  if (direct.ok) return direct.value
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    const inner = tryParse(fenced[1])
    if (inner.ok) return inner.value
  }
  const braced = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (braced) {
    const obj = tryParse(braced)
    if (obj.ok) return obj.value
  }
  throw new Error(`codex returned a non-JSON response for a schema-typed agent: ${lastLine(text)}`)
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** Fallback final-message extraction from the JSONL event stream. */
function lastAgentMessage(jsonl: string): string {
  let message = ''
  for (const event of parseJsonl(jsonl)) {
    const text = agentText(event)
    if (text !== undefined) message = text
  }
  return message
}

function agentText(event: Record<string, unknown>): string | undefined {
  const item = isRecord(event.item) ? event.item : event
  const type = typeof item.type === 'string' ? item.type : ''
  if (!/message|agent/i.test(type)) return undefined
  if (typeof item.text === 'string') return item.text
  if (typeof item.message === 'string') return item.message
  return undefined
}

function parseUsage(jsonl: string): unknown {
  let usage: unknown
  for (const event of parseJsonl(jsonl)) {
    if (isRecord(event.usage)) usage = event.usage
    else if (isRecord(event.item) && isRecord(event.item.usage)) usage = event.item.usage
  }
  return usage
}

function parseJsonl(jsonl: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = tryParse(trimmed)
    if (parsed.ok && isRecord(parsed.value)) events.push(parsed.value)
  }
  return events
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n')
  return lines[lines.length - 1] ?? text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
