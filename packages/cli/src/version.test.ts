import { expect, test } from 'bun:test'
import { VERSION } from './version.js'

test('VERSION matches the root package.json (drift guard)', async () => {
  const pkg = JSON.parse(await Bun.file(new URL('../../../package.json', import.meta.url)).text())
  expect(VERSION).toBe(pkg.version)
})
