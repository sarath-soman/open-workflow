import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentRunInput } from '@open-workflow/core'
import { createCodexAdapter } from './index.js'

let tmp: string
let okBin: string
let failBin: string
let fencedBin: string

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'owf-codex-'))

  // Stub that honors -o and --output-schema, emits a JSONL transcript + usage.
  okBin = path.join(tmp, 'ok.mjs')
  writeFileSync(
    okBin,
    `#!/usr/bin/env bun
import fs from 'node:fs'
const a = process.argv.slice(2)
const out = a[a.indexOf('-o') + 1]
const schema = a.includes('--output-schema')
let p = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { p += d })
process.stdin.on('end', () => {
  const msg = schema ? JSON.stringify({ verdict: 'ok', note: p.trim().slice(0, 10) }) : 'plain: ' + p.trim()
  fs.writeFileSync(out, msg)
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: msg } }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } }) + '\\n')
  process.exit(0)
})
`,
  )

  // Stub that writes a fenced ```json block (no -o file) to test tolerant parsing.
  fencedBin = path.join(tmp, 'fenced.mjs')
  writeFileSync(
    fencedBin,
    `#!/usr/bin/env bun
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'here:\\n\\\`\\\`\\\`json\\n{"verdict":"ok","note":"f"}\\n\\\`\\\`\\\`' } }) + '\\n')
  process.exit(0)
})
`,
  )

  failBin = path.join(tmp, 'fail.mjs')
  writeFileSync(
    failBin,
    `#!/usr/bin/env bun
process.stderr.write('boom: auth required\\n')
process.exit(1)
`,
  )

  for (const b of [okBin, fencedBin, failBin]) chmodSync(b, 0o755)
})

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function input(over: Partial<AgentRunInput> = {}): AgentRunInput {
  return { prompt: 'hello world', cwd: tmp, ...over }
}

async function runCtx() {
  const runDir = await fs.mkdtemp(path.join(tmp, 'run-'))
  return { runId: 'r', runDir, effectId: `e${Math.random().toString(36).slice(2, 8)}` }
}

describe('codex adapter', () => {
  test('returns the plain final message and materializes a task packet', async () => {
    const a = createCodexAdapter({ bin: okBin })
    const ctx = await runCtx()
    const res = await a.run(input(), ctx)
    expect(res.output).toBe('plain: hello world')
    expect(res.transcriptRef).toBe(`agents/${ctx.effectId}/transcript.jsonl`)
    const packet = path.join(ctx.runDir, 'agents', ctx.effectId)
    expect(await fs.readFile(path.join(packet, 'prompt.md'), 'utf8')).toBe('hello world')
    expect(await Bun.file(path.join(packet, 'result.json')).exists()).toBe(true)
  })

  test('parses structured output and writes output-schema.json when schema is set', async () => {
    const a = createCodexAdapter({ bin: okBin })
    const ctx = await runCtx()
    const res = await a.run(input({ schema: { type: 'object' } }), ctx)
    expect(res.output).toEqual({ verdict: 'ok', note: 'hello worl' })
    expect(
      await Bun.file(path.join(ctx.runDir, 'agents', ctx.effectId, 'output-schema.json')).exists(),
    ).toBe(true)
  })

  test('tightens object schemas for OpenAI strict structured outputs', async () => {
    const a = createCodexAdapter({ bin: okBin })
    const ctx = await runCtx()
    await a.run(
      input({
        schema: {
          type: 'object',
          properties: { verdict: { enum: ['ok'] }, note: { type: 'string' } },
          required: ['verdict'],
        },
      }),
      ctx,
    )
    const written = JSON.parse(
      await fs.readFile(
        path.join(ctx.runDir, 'agents', ctx.effectId, 'output-schema.json'),
        'utf8',
      ),
    )
    expect(written.additionalProperties).toBe(false)
    expect(written.required.sort()).toEqual(['note', 'verdict']) // all props become required
  })

  test('parses usage from the JSONL stream', async () => {
    const a = createCodexAdapter({ bin: okBin })
    const res = await a.run(input(), await runCtx())
    expect(res.usage).toEqual({ input_tokens: 3, output_tokens: 2 })
  })

  test('tolerates a fenced ```json block when no -o file is written', async () => {
    const a = createCodexAdapter({ bin: fencedBin })
    const res = await a.run(input({ schema: { type: 'object' } }), await runCtx())
    expect(res.output).toEqual({ verdict: 'ok', note: 'f' })
  })

  test('fails the effect with stderr on a non-zero exit', async () => {
    const a = createCodexAdapter({ bin: failBin })
    expect(a.run(input(), await runCtx())).rejects.toThrow(/boom: auth required/)
  })

  test('reports a clear error when the binary is missing', async () => {
    const a = createCodexAdapter({ bin: path.join(tmp, 'does-not-exist') })
    expect(a.run(input(), await runCtx())).rejects.toThrow(/not found/)
  })
})
