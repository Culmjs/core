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

test('items list inside an object is sorted inside, ordered outside', () =>
  assert.equal(
    canonicalJson({
      items: [
        { id: 'p2', a: 1 },
        { id: 'p1', a: 2 },
      ],
    }),
    '{"items":[{"a":1,"id":"p2"},{"a":2,"id":"p1"}]}',
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

test('a cyclic value throws a TypeError, as JSON.stringify does', () => {
  const a: Record<string, unknown> = { x: 1 }
  a.self = a
  assert.throws(() => canonicalJson(a), TypeError)
})

test('5,000 levels of nesting does not throw and equal deep values give equal text', () => {
  const deep = (): unknown => {
    let v: unknown = { b: 1, a: 2 }
    for (let i = 0; i < 5000; i++) v = { z: v, a: [i] }
    return v
  }
  assert.equal(canonicalJson(deep()), canonicalJson(deep()))
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

test('a toJSON that returns its own object is written once, as JSON.stringify writes it; one that returns a structure holding itself throws, as a cycle does', () => {
  const self = {
    a: 1,
    toJSON() {
      return this
    },
  }
  assert.equal(canonicalJson(self), JSON.stringify(self))
  assert.equal(canonicalJson(self), '{"a":1}')
  const loop = {
    a: 1,
    toJSON() {
      return { b: this }
    },
  }
  assert.throws(() => canonicalJson(loop))
})

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
