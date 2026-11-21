import test from 'node:test'
import assert from 'node:assert/strict'
import { ID_RE } from '../../../core/src/document/kinds.ts'
import { derivedId } from '../../src/folder/ids.ts'

test('derivedId is equal for equal inputs, different for two positions and two files, and matches /^[a-z0-9]{1,20}$/', () => {
  const a = derivedId('pages/home.json', ['blocks', 0])
  assert.equal(a, derivedId('pages/home.json', ['blocks', 0]))
  assert.notEqual(a, derivedId('pages/home.json', ['blocks', 1]))
  assert.notEqual(a, derivedId('pages/about.json', ['blocks', 0]))
  assert.notEqual(derivedId('f', ['a', 1]), derivedId('f', ['a1']))
  assert.match(a, /^[a-z0-9]{1,20}$/)
  assert.match(a, ID_RE)
  assert.equal(a.length, 13)
})

test('derivedId never starts with n', () => {
  for (let i = 0; i < 500; i++)
    assert.ok(derivedId(`f${i}.json`, [i]).startsWith('x'))
})
