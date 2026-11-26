import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FRAMEWORK_VERSION, buildIdentity } from '../../src/compile/index.ts'
import { SCRIPTS_DIGEST } from '../../src/scripts/scriptsMin.ts'
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

test('a plug-in with another name, same version, is another build', async () => {
  const named = (name: string) => {
    const r = createRegistry()
    r.use(plug(1, name))
    return r
  }
  assert.notEqual(
    await buildIdentity(doc(), data, named('p'), files),
    await buildIdentity(doc(), data, named('q'), files),
  )
})

test('rows nested past the stack limit of JSON reject with the same clear error', async () => {
  let deep: Record<string, unknown> = { n: 1 }
  for (let i = 0; i < 20000; i++) deep = { z: deep }
  await assert.rejects(
    buildIdentity(doc(), { rows: { a: [deep] } }, reg()),
    (e: Error) => e instanceof Error && /cannot be hashed/.test(e.message),
  )
})

test('two files with one path give the same identity in either order', async () => {
  const dup = [
    { path: 'fonts/a.woff2', sha256: 'aa' },
    { path: 'fonts/a.woff2', sha256: 'bb' },
  ]
  assert.equal(
    await buildIdentity(doc(), data, reg(), dup),
    await buildIdentity(doc(), data, reg(), [...dup].reverse()),
  )
})

test('what is hashed is the JSON form of the rows and values: a function value, a Date and its ISO text, null and no values do not tell builds apart', async () => {
  const at = new Date('2026-01-02T03:04:05.000Z')
  const same = async (a: object, b: object) =>
    assert.equal(
      await buildIdentity(doc(), a as never, reg()),
      await buildIdentity(doc(), b as never, reg()),
    )
  await same(
    { rows: { a: [{ n: 1, f: () => 1 }] } },
    { rows: { a: [{ n: 1 }] } },
  )
  await same(
    { rows: { a: [{ at }] } },
    { rows: { a: [{ at: at.toISOString() }] } },
  )
  await same(
    { rows: { a: [{ m: new Map([[1, 2]]) }] } },
    { rows: { a: [{ m: {} }] } },
  )
  await same({ ...data, values: null }, data)
})

test('a changed shipped script changes the identity', async () => {
  const real = await buildIdentity(doc(), data, reg(), files)
  const same = await buildIdentity(doc(), data, reg(), files, SCRIPTS_DIGEST)
  const other = await buildIdentity(doc(), data, reg(), files, 'different')
  assert.equal(real, same)
  assert.notEqual(real, other)
})
