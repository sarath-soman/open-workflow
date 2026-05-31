import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dir, '../..')
const CLI = path.join(REPO, 'packages/cli/src/index.ts')

async function runCli(args: string[], cwd: string) {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { stdout, stderr, code }
}

const WF =
  "export const meta = { name: 'cfgwf', description: 'd', phases: [{ title: 'p' }] }\nphase('p')\nconst a = await agent('go', { label: 'a' })\nreturn { a }"

async function project(config: object): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'owf-cfg-'))
  await fs.writeFile(path.join(dir, 'hello.workflow.js'), WF)
  await fs.writeFile(path.join(dir, 'open-workflow.config.json'), JSON.stringify(config, null, 2))
  return dir
}

describe('config resolution', () => {
  test('runs a named workflow resolved from open-workflow.config.json', async () => {
    const dir = await project({ workflows: { hello: 'hello.workflow.js' }, defaultAdapter: 'mock' })
    const r = await runCli(
      ['run', 'hello', '--cwd', dir, '--runs-dir', path.join(dir, 'runs'), '--output', 'json'],
      dir,
    )
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).status).toBe('completed')
  })

  test('errors on an unknown workflow name', async () => {
    const dir = await project({ workflows: { hello: 'hello.workflow.js' } })
    const r = await runCli(['run', 'nope', '--cwd', dir], dir)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('unknown workflow name')
  })

  test('honors config.defaultAdapter when --adapter is omitted', async () => {
    // defaultAdapter: codex, but pointed at a stub bin so no real spend; the run
    // succeeds only if defaultAdapter was honored (mock would also succeed, so we
    // assert the codex packet dir appears — proof the codex adapter ran).
    const dir = await project({
      workflows: { hello: 'hello.workflow.js' },
      defaultAdapter: 'codex',
    })
    const stub = path.join(dir, 'codex.mjs')
    await fs.writeFile(
      stub,
      "#!/usr/bin/env bun\nimport fs from 'node:fs'\nconst a=process.argv.slice(2);const o=a[a.indexOf('-o')+1];if(o)fs.writeFileSync(o,'stub');process.exit(0)\n",
    )
    await fs.chmod(stub, 0o755)
    const runs = path.join(dir, 'runs')
    const r = await runCli(
      ['run', 'hello', '--cwd', dir, '--runs-dir', runs, '--codex-bin', stub, '--output', 'json'],
      dir,
    )
    expect(r.code).toBe(0)
    const runId = JSON.parse(r.stdout).runId
    const agentsDir = path.join(runs, runId, 'agents')
    const packetExists = await fs
      .stat(agentsDir)
      .then((s) => s.isDirectory())
      .catch(() => false)
    expect(packetExists).toBe(true) // codex adapter materialized a packet
  })
})
