import assert from 'node:assert/strict'
import test from 'node:test'
import { subpaths } from '../../src/compile/pathStrokes.ts'

test('relative subpaths track implicit lines, compact arc flags, curves, exponents and closepath', () => {
  assert.deepEqual(
    subpaths('m1 2 3 4 a5 5 0 0110 20 m-3 -4 1 2 S5 8 1e2 9 z m1 1h2'),
    ['M1 2l3 4 a5 5 0 0110 20 ', 'M11 22l1 2 S5 8 1e2 9 z ', 'M12 23h2'],
  )
  assert.equal(subpaths('M0 0a5 5 0 0'), undefined)
  assert.equal(subpaths('M0 0a5 5 0 9 1 0 0m2 3h10'), undefined)
})
