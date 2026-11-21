import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '@culmjs/core'
import type { Plugin, Registry } from '@culmjs/core'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv/dist/2020.js'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { parseFile } from '../../src/folder/jsonc.ts'
import { authoringSchema } from '../../src/schema/authoring.ts'
import { FIXTURES } from '../../../core/__tests__/compile/fixtures.ts'

const check = (registry: Registry) => {
  const validate = new Ajv2020({ allErrors: true }).compile(
    authoringSchema(registry),
  )
  return (value: unknown): { ok: boolean; errors: ErrorObject[] } => ({
    ok: validate(value) as boolean,
    errors: [...(validate.errors ?? [])],
  })
}

const sample = async () => {
  const dir = await copyFixture('site-basic')
  return { dir, project: await openProject(dir) }
}

test('every file of site-basic passes', async () => {
  const { project } = await sample()
  const ok = check(project.registry)
  const files = project.loaded.files
  assert.ok(files.length >= 8)
  for (const f of files) {
    const r = ok(parseFile(f.text).value)
    assert.ok(r.ok, `${f.path}: ${JSON.stringify(r.errors)}`)
  }
})

test('every valid document fixture of core tests, written out as a page file, passes', () => {
  assert.ok(FIXTURES.length > 5)
  for (const [name, doc, options] of FIXTURES) {
    const ok = check(options.registry ?? createRegistry())
    for (const p of doc.pages) {
      const r = ok(p)
      assert.ok(r.ok, `${name} page ${p.id}: ${JSON.stringify(r.errors)}`)
    }
    const chrome = ok({
      name: doc.name,
      header: doc.header,
      footer: doc.footer,
    })
    assert.ok(chrome.ok, `${name} chrome: ${JSON.stringify(chrome.errors)}`)
    for (const c of doc.components) {
      const r = ok({ id: c.id, name: c.name, settings: c.props, root: c.root })
      assert.ok(r.ok, `${name} piece ${c.id}: ${JSON.stringify(r.errors)}`)
    }
  }
})

test('a misspelt kind fails and the error lists the kinds', async () => {
  const { project } = await sample()
  const r = check(project.registry)({
    id: 'p',
    title: 'P',
    slug: '/p',
    root: { kind: 'colunm', children: [] },
  })
  assert.equal(r.ok, false)
  const e = r.errors.find(
    x => x.keyword === 'enum' && x.instancePath === '/root/kind',
  )
  assert.ok(e, JSON.stringify(r.errors))
  const allowed = (e.params as { allowedValues: string[] }).allowedValues
  for (const k of ['column', 'row', 'text', 'button'])
    assert.ok(allowed.includes(k), k)
})

test('a misspelt setting on a short form fails', async () => {
  const { project } = await sample()
  const ok = check(project.registry)
  const page = (child: unknown) => ({
    id: 'p',
    title: 'P',
    slug: '/p',
    root: { kind: 'column', children: [child] },
  })
  assert.ok(ok(page({ block: 'hero', title: 'Hi', titleSize: 40 })).ok)
  const r = ok(page({ block: 'hero', titel: 'Hi' }))
  assert.equal(r.ok, false)
  assert.ok(
    r.errors.some(
      x =>
        x.keyword === 'additionalProperties' &&
        (x.params as { additionalProperty: string }).additionalProperty ===
          'titel',
    ),
    JSON.stringify(r.errors),
  )
  assert.equal(ok(page({ block: 'hero', titleSize: 'big' })).ok, false)
  assert.equal(ok(page({ block: 'nope' })).ok, false)
})

test('a comment-only difference does not matter: the schema is applied to the parsed value', async () => {
  const { project } = await sample()
  const ok = check(project.registry)
  const plain = '{"id":"p","title":"P","slug":"/p","root":{"kind":"column"}}'
  const noisy = `// a page\n{\n "id": "p", /* the id */ "title": "P",\n "slug": "/p",\n "root": { "kind": "column", }, // end\n}`
  assert.deepEqual(parseFile(noisy).value, parseFile(plain).value)
  assert.ok(ok(parseFile(plain).value).ok)
  assert.ok(ok(parseFile(noisy).value).ok)
})

test('the schema changes when a block is registered', () => {
  const plugin: Plugin = {
    name: 'extra',
    version: 1,
    api: [1],
    runs: ['load', 'edit', 'build'],
    trust: 'declarative',
    blocks: [
      {
        id: 'banner',
        version: 1,
        name: 'Banner',
        category: 'content',
        looks: [
          {
            id: 'plain',
            name: 'Plain',
            tree: { id: 'root', kind: 'column', name: 'Banner', slot: {} },
          },
        ],
        settings: [],
      },
    ],
  }
  const before = createRegistry()
  const after = createRegistry()
  after.use(plugin)
  const page = {
    id: 'p',
    title: 'P',
    slug: '/p',
    root: { kind: 'column', children: [{ block: 'banner' }] },
  }
  assert.notDeepEqual(authoringSchema(before), authoringSchema(after))
  assert.equal(check(before)(page).ok, false)
  assert.ok(check(after)(page).ok)
})

test('piece and use may carry id and name; a block file and a data file pass', () => {
  const ok = check(createRegistry())
  assert.ok(
    ok({
      id: 'visit',
      name: 'Visit card',
      settings: [{ key: 'note', label: 'Note', type: 'text', part: 'line' }],
      root: { kind: 'box' },
    }).ok,
  )
  assert.ok(
    ok({
      id: 'p',
      title: 'P',
      slug: '/p',
      root: {
        kind: 'column',
        children: [
          { use: '../pieces/v.json', id: 'u', name: 'Card', note: 'x' },
        ],
      },
    }).ok,
  )
  assert.ok(
    ok({
      fields: { name: 'text', rows: { rows: { a: 'number' } } },
      rows: [{ name: 'a' }],
    }).ok,
  )
  assert.equal(ok({ fields: { name: 'texte' } }).ok, false)
})
