import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDeclaration } from '../../src/registry/index.ts'
import type { Declaration } from '../../src/registry/index.ts'

const decl = (more: Partial<Declaration> = {}): Declaration => ({
  name: 'p',
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  ...more,
})

test('a plug-in built for another API version is refused', () => {
  assert.equal(
    checkDeclaration(decl({ api: [2] }))[0]?.code,
    'POLICY_VIOLATION',
  )
  assert.deepEqual(checkDeclaration(decl()), [])
})

test('a bad name or version is an invalid document', () => {
  for (const bad of [
    { name: '' },
    { name: 3 },
    { version: 0 },
    { version: 1.5 },
  ]) {
    const p = checkDeclaration(decl(bad as unknown as Partial<Declaration>))
    assert.equal(p[0]?.code, 'INVALID_DOCUMENT')
  }
})

test('checkDeclaration never throws', () => {
  for (const bad of [null, 'x', {}, { name: 'p', version: 1, api: 'x' }]) {
    assert.ok(checkDeclaration(bad as unknown as Declaration).length > 0)
  }
})
