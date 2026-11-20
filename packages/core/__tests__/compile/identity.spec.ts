import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FRAMEWORK_VERSION, buildIdentity } from '../../src/compile/index.ts'
import { createRegistry } from '../../src/registry/index.ts'
import { siteWith, text } from '../kit.ts'

const plug = (version = 1, name = 'p') => ({
  name,
  version,
  api: [1],
  runs: ['build' as const],
  trust: 'declarative' as const,
})
const reg = (version = 1) => {
  const r = createRegistry()
  r.use(plug(version))
  return r
}
const doc = () => siteWith([text('t', 'Hi')])
const data = { rows: { a: [{ n: 1 }, { n: 2 }] } }
const files = [{ path: 'fonts/a.woff2', sha256: 'aa' }]

test('equal inputs give equal identities', async () => {
  const a = await buildIdentity(doc(), data, reg(), files)
  const b = await buildIdentity(doc(), structuredClone(data), reg(), files)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(a, b)
})

test('a changed row, a changed document, a changed file hash and a changed plug-in version each change it', async () => {
  const base = await buildIdentity(doc(), data, reg(), files)
  const other = [
    await buildIdentity(
      doc(),
      { rows: { a: [{ n: 1 }, { n: 3 }] } },
      reg(),
      files,
    ),
    await buildIdentity(siteWith([text('t', 'Bye')]), data, reg(), files),
    await buildIdentity(doc(), data, reg(), [
      { path: 'fonts/a.woff2', sha256: 'bb' },
    ]),
    await buildIdentity(doc(), data, reg(2), files),
    await buildIdentity(doc(), { ...data, values: { x: 1 } }, reg(), files),
    await buildIdentity(doc(), data, reg()),
  ]
  for (const o of other) assert.notEqual(o, base)
})

test('rows in another order are another build', async () => {
  const swapped = { rows: { a: [{ n: 2 }, { n: 1 }] } }
  assert.notEqual(
    await buildIdentity(doc(), data, reg()),
    await buildIdentity(doc(), swapped, reg()),
  )
})

test('the order of the files passed does not matter', async () => {
  const f2 = [{ path: 'assets/b.png', sha256: 'cc' }, ...files]
  assert.equal(
    await buildIdentity(doc(), data, reg(), f2),
    await buildIdentity(doc(), data, reg(), [...f2].reverse()),
  )
})

test('rows no JSON text can hold reject with a clear error', async () => {
  const cyc: Record<string, unknown> = {}
  cyc.self = cyc
  for (const rows of [{ a: [cyc] }, { a: [{ n: 1n }] }]) {
    await assert.rejects(
      buildIdentity(doc(), { rows }, reg()),
      (e: Error) =>
        e instanceof Error &&
        /cannot be hashed/.test(e.message) &&
        !(e instanceof TypeError),
    )
  }
})

test('FRAMEWORK_VERSION equals the version in packages/core/package.json', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  assert.equal(FRAMEWORK_VERSION, pkg.version)
})
