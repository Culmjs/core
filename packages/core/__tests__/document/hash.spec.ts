import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODES } from '../../src/document/problems.ts'
import type { Problem } from '../../src/document/problems.ts'
import { canonicalJson, sha256 } from '../../src/document/hash.ts'

test('key order does not change the text', () =>
  assert.equal(
    canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }),
    canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }),
  ))

test('keys are sorted at every depth with no whitespace', () =>
  assert.equal(
    canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    '{"a":1,"b":{"c":2,"d":3}}',
  ))

test('undefined object values are omitted', () =>
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}'))

test('array order changes the text', () =>
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1])))

test('projects list inside an object is sorted inside, ordered outside', () =>
  assert.equal(
    canonicalJson({
      projects: [
        { id: 'p2', a: 1 },
        { id: 'p1', a: 2 },
      ],
    }),
    '{"projects":[{"a":1,"id":"p2"},{"a":2,"id":"p1"}]}',
  ))

test('undefined, functions and NaN follow JSON.stringify', () => {
  assert.equal(canonicalJson([undefined, () => 1, NaN]), '[null,null,null]')
  assert.equal(canonicalJson({ f: () => 1, n: NaN }), '{"n":null}')
  assert.equal(canonicalJson(undefined), 'null')
  assert.equal(
    canonicalJson(() => 1),
    'null',
  )
  assert.equal(canonicalJson(NaN), 'null')
})

test('a cyclic value does not throw and marks the back reference', () => {
  const a: Record<string, unknown> = { x: 1 }
  a.self = a
  assert.equal(canonicalJson(a), '{"self":"[Circular]","x":1}')
  const b: Record<string, unknown> = { x: 2 }
  b.self = b
  assert.notEqual(canonicalJson(a), canonicalJson(b))
  const arr: unknown[] = [1]
  arr.push(arr)
  assert.equal(canonicalJson(arr), '[1,"[Circular]"]')
})

test('a repeated, non-cyclic reference is written in full', () => {
  const shared = { k: 1 }
  assert.equal(
    canonicalJson({ a: shared, b: shared }),
    '{"a":{"k":1},"b":{"k":1}}',
  )
})

test('toJSON is honoured', () =>
  assert.equal(
    canonicalJson({ d: new Date(0) }),
    '{"d":"1970-01-01T00:00:00.000Z"}',
  ))

test('sha256 of "abc"', async () =>
  assert.equal(
    await sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  ))

test('the six new codes come last, in order, and Problem takes op', () => {
  assert.deepEqual(CODES.slice(-6), [
    'REVISION_CONFLICT',
    'INVALID_OPERATION',
    'KEY_CONFLICT',
    'SOURCE_CONFLICT',
    'UNSUPPORTED_CAPABILITY',
    'MEASUREMENT_INCOMPLETE',
  ])
  const p: Problem = { code: 'INVALID_OPERATION', message: 'm', op: 2 }
  assert.equal(p.op, 2)
})
