import test from 'node:test'
import assert from 'node:assert/strict'
import type { Finding } from '@culmjs/core/measure'
import { locateFinding } from '../../src/folder/locateFinding.ts'

const f = { page: 'home', nodes: ['n1', 'n2'], message: 'm' } as Finding

test('a finding is located by its first node', () => {
  const seen: unknown[] = []
  const r = locateFinding(
    f,
    p => (seen.push(p), { ...p, file: 'pages/home.json', line: 4, column: 7 }),
    () => 'pages/x.json',
  )
  assert.equal((seen[0] as { nodeId: string }).nodeId, 'n1')
  assert.deepEqual([r.file, r.line, r.column], ['pages/home.json', 4, 7])
  assert.equal(r.page, 'home')
})

test('a finding the locator cannot place falls back to the page file', () => {
  const r = locateFinding(
    f,
    p => p,
    id => `pages/${id}.json`,
  )
  assert.deepEqual([r.file, r.line], ['pages/home.json', undefined])
})
