import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { render } from '../gen-scripts.ts'
import { byteLength } from '../../packages/core/src/compile/budgets.ts'
import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
} from '../../packages/core/src/scripts/scriptsMin.ts'

test('scriptsMin.ts is up to date', () => {
  assert.equal(
    readFileSync(
      new URL('../../packages/core/src/scripts/scriptsMin.ts', import.meta.url),
      'utf8',
    ),
    render(),
    'run `npm run gen:scripts`',
  )
})

test('each script is within its ceiling, all appendices included', () => {
  const base = BASE_SCRIPT + OPEN_SCRIPT + EMAIL_SCRIPT
  assert.ok(byteLength(base) <= 10_000)
  assert.ok(byteLength(STATES_SCRIPT) <= 6_193)
  assert.ok(byteLength(base + STATES_SCRIPT) <= 20_000)
})

test('the shipped scripts use no syntax newer than ES2017 and make no request and touch no storage', () => {
  for (const s of [BASE_SCRIPT, OPEN_SCRIPT, EMAIL_SCRIPT, STATES_SCRIPT]) {
    // esbuild lowers newer syntax instead of throwing: if es2017 output differs from esnext output, something was lowered
    const out = (target: string) =>
      transformSync(s, { target, minify: false }).code
    assert.equal(out('es2017'), out('esnext'))
    for (const word of [
      'fetch(',
      'XMLHttpRequest',
      'localStorage',
      'sessionStorage',
      'eval(',
      'new Function',
    ])
      assert.ok(!s.includes(word), word)
  }
})
