import { describe, expect, test } from 'bun:test'
import { extractMeta } from './runtime.js'

describe('extractMeta', () => {
  test('parses a simple meta literal and strips the export', () => {
    const src = "export const meta = { name: 'w', description: 'd', phases: [] }\nreturn 1"
    const { meta, executableSource } = extractMeta(src)
    expect(meta.name).toBe('w')
    expect(meta.description).toBe('d')
    expect(executableSource).toContain('const meta =')
    expect(executableSource).not.toContain('export const meta')
  })

  test('handles nested braces in phases', () => {
    const src =
      "export const meta = { name: 'w', description: 'd', phases: [{ title: 'a' }, { title: 'b' }] }"
    const { meta } = extractMeta(src)
    expect(meta.phases.map((p) => p.title)).toEqual(['a', 'b'])
  })

  test('ignores braces inside strings and comments', () => {
    const src =
      "export const meta = { name: 'w', description: 'a } not-a-close { brace', phases: [] } // trailing }"
    const { meta } = extractMeta(src)
    expect(meta.description).toBe('a } not-a-close { brace')
  })

  test('throws when meta is missing', () => {
    expect(() => extractMeta("phase('plan')")).toThrow(/export const meta/)
  })

  test('throws on an unterminated meta object', () => {
    expect(() => extractMeta("export const meta = { name: 'w'")).toThrow()
  })
})
