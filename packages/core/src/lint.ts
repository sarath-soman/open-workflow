import { DSL_CONTRACT } from './dsl.js'
import { extractMeta } from './runtime.js'

export type LintFinding = {
  severity: 'error' | 'warning'
  rule: string
  message: string
  line: number
}

/**
 * Static lint for a workflow script. Dependency-free by design — it masks
 * strings/comments then runs targeted token checks, so the compiled binary
 * gains no parser dependency. Behavioral gaps are covered by a `--adapter mock`
 * dry run, not by adding an AST library here.
 */
export function lintWorkflow(source: string): LintFinding[] {
  const findings: LintFinding[] = []

  // 1. meta integrity (reuses the runtime's own extractor).
  let metaTitles: string[] = []
  try {
    const { meta } = extractMeta(source)
    if (!meta.name) findings.push(err('meta', 'meta.name is required', 1))
    if (!meta.description) findings.push(err('meta', 'meta.description is required', 1))
    if (!Array.isArray(meta.phases)) findings.push(err('meta', 'meta.phases must be an array', 1))
    else metaTitles = meta.phases.map((p) => p.title)
  } catch (error) {
    findings.push(err('meta', error instanceof Error ? error.message : String(error), 1))
  }

  const masked = maskLiterals(source)

  // 2. forbidden identifiers (clocks, non-determinism, unavailable imports).
  for (const f of DSL_CONTRACT.forbidden) {
    const re =
      f.name === 'Math.random'
        ? /\bMath\s*\.\s*random\b/g
        : new RegExp(`\\b${escapeRegExp(f.name)}\\b`, 'g')
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      findings.push(
        err(
          `no-${f.name}`,
          `${f.name} is not allowed in workflow code — ${f.reason}`,
          lineAt(source, m.index),
        ),
      )
    }
  }

  // 3. phase() <-> meta.phases consistency (phase literals read from raw source).
  const declared = new Set(metaTitles)
  const entered = new Set<string>()
  const phaseRe = /\bphase\s*\(\s*(['"`])([^'"`]*)\1/g
  for (let m = phaseRe.exec(source); m; m = phaseRe.exec(source)) {
    const title = m[2] ?? ''
    entered.add(title)
    if (!declared.has(title)) {
      findings.push(
        warn(
          'phase-not-declared',
          `phase('${title}') is entered but not listed in meta.phases`,
          lineAt(source, m.index),
        ),
      )
    }
  }
  for (const title of declared) {
    if (!entered.has(title)) {
      findings.push(
        warn(
          'phase-not-entered',
          `meta.phases declares '${title}' but no phase('${title}') call was found (ok if entered dynamically)`,
          1,
        ),
      )
    }
  }

  // 4. agent() option keys — conservative: only flags clean literal option objects.
  for (const { key, line } of agentOptionKeys(masked, source)) {
    if (!ALLOWED_AGENT_OPTS.has(key)) {
      findings.push(
        warn(
          'unknown-agent-option',
          `agent() option '${key}' is not in the contract (${[...ALLOWED_AGENT_OPTS].join(', ')})`,
          line,
        ),
      )
    }
  }

  return findings.sort((a, b) => a.line - b.line)
}

const ALLOWED_AGENT_OPTS = new Set(DSL_CONTRACT.agentOptions.map((o) => o.name))

function err(rule: string, message: string, line: number): LintFinding {
  return { severity: 'error', rule, message, line }
}
function warn(rule: string, message: string, line: number): LintFinding {
  return { severity: 'warning', rule, message, line }
}

/** Replace string/comment *contents* with spaces so token regexes ignore prose in prompts. */
function maskLiterals(src: string): string {
  const out = src.split('')
  let quote: string | null = null
  let escaped = false
  let line = false
  let block = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (line) {
      if (ch === '\n') line = false
      else out[i] = ' '
      continue
    }
    if (block) {
      if (ch === '*' && next === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        block = false
        i++
      } else if (ch !== '\n') out[i] = ' '
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) {
        quote = null
        continue
      }
      if (ch !== '\n') out[i] = ' '
      continue
    }
    if (ch === '/' && next === '/') {
      line = true
      continue
    }
    if (ch === '/' && next === '*') {
      block = true
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
  }
  return out.join('')
}

/**
 * Best-effort extraction of top-level option keys from `agent(arg, { ... })`
 * calls. Skips objects with spreads/computed keys (can't be read precisely
 * without a parser, and we refuse to false-positive). Operates on masked source.
 */
function agentOptionKeys(masked: string, raw: string): Array<{ key: string; line: number }> {
  const results: Array<{ key: string; line: number }> = []
  const callRe = /\bagent\s*\(/g
  for (let m = callRe.exec(masked); m; m = callRe.exec(masked)) {
    const open = masked.indexOf('{', m.index + m[0].length)
    if (open === -1) continue
    const close = matchBrace(masked, open)
    if (close === -1) continue
    const body = masked.slice(open + 1, close)
    if (body.includes('...')) continue // spread — bail rather than guess
    // top-level `key:` entries only (depth 0 within this object)
    let depth = 0
    const keyRe = /([,{]?\s*)([A-Za-z_$][\w$]*)\s*:/g
    // re-scan with depth tracking
    let i = 0
    const keys: Array<{ key: string; offset: number }> = []
    let pending = ''
    for (; i < body.length; i++) {
      const c = body[i]
      if (c === '{' || c === '[' || c === '(') depth++
      else if (c === '}' || c === ']' || c === ')') depth--
      else if (depth === 0 && c === ':') {
        const km = /([A-Za-z_$][\w$]*)\s*$/.exec(pending)
        if (km?.[1]) keys.push({ key: km[1], offset: i - km[1].length })
        pending = ''
        continue
      } else if (depth === 0 && c === ',') {
        pending = ''
        continue
      }
      if (depth === 0) pending += c
    }
    void keyRe
    for (const k of keys) results.push({ key: k.key, line: lineAt(raw, open + 1 + k.offset) })
  }
  return results
}

function matchBrace(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function lineAt(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
