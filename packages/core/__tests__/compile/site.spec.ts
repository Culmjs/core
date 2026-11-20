import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileSite } from '../../src/compile/index.ts'
import { byteLength } from '../../src/compile/budgets.ts'
import type { KindSpec } from '../../src/document/index.ts'
import { createRegistry } from '../../src/registry/index.ts'
import { BASE_SCRIPT, STATES_SCRIPT } from '../../src/scripts/index.ts'
import {
  DEMO_PLUGIN,
  node,
  projectsList,
  sampleRegistry,
  siteWith,
  stateful,
  text,
  twoPages,
} from '../kit.ts'

const registry = sampleRegistry()

test('compileSite writes one file per page that is on, and a manifest of scripts by page', () => {
  const out = compileSite(twoPages([text('t', 'Home')], [stateful()]), {
    registry,
  })
  assert.deepEqual(out.problems, [])
  assert.deepEqual(
    out.files.map(f => f.path),
    ['index.html', 'about/index.html'],
  )
  assert.ok(out.files[0].content.startsWith('<!doctype html>'))
  assert.ok(out.files[0].content.includes('Home'))
  assert.deepEqual(
    out.manifest.scripts.map(s => [s.name, s.pages]),
    [
      ['base', ['home', 'about']],
      ['states', ['about']],
    ],
  )
  assert.equal(out.manifest.scripts[0].bytes, byteLength(BASE_SCRIPT))
  assert.equal(out.manifest.scripts[1].bytes, byteLength(STATES_SCRIPT))
})

test('the manifest names the schema version, each page with its file, and each page style with its size', () => {
  const out = compileSite(twoPages([text('t', 'Home')], [text('u', 'About')]), {
    registry,
  })
  assert.equal(out.manifest.schemaVersion, 1)
  assert.deepEqual(out.manifest.pages, [
    { id: 'home', path: 'index.html' },
    { id: 'about', path: 'about/index.html' },
  ])
  assert.deepEqual(
    out.manifest.styles.map(s => [s.name, s.pages]),
    [
      ['home', ['home']],
      ['about', ['about']],
    ],
  )
  for (const s of out.manifest.styles) assert.ok(s.bytes > 0)
})

test('files lie at the slug: / is index.html, /a/b is a/b/index.html', () => {
  const doc = twoPages([text('t', 'Home')], [text('u', 'Deep')])
  doc.pages[1].slug = '/a/b'
  const out = compileSite(doc, { registry })
  assert.deepEqual(
    out.files.map(f => f.path),
    ['index.html', 'a/b/index.html'],
  )
})

test('no file path can climb out of the output: valid slugs give clean paths, a traversal slug gives no file', () => {
  const doc = twoPages([text('t', 'Home')], [text('u', 'Deep')])
  doc.pages[1].slug = '/a-b/c1'
  const ok = compileSite(doc, { registry })
  assert.equal(ok.files.length, 2)
  for (const { path } of ok.files) {
    assert.ok(!path.includes('..') && !path.includes('\\'), path)
    assert.ok(!path.startsWith('/') && !path.includes('//'), path)
  }
  for (const slug of ['/../x', '/a/../b', '/./x']) {
    doc.pages[1].slug = slug
    const out = compileSite(doc, { registry })
    assert.deepEqual(out.files, [], slug)
    assert.equal(out.problems[0]?.code, 'INVALID_DOCUMENT', slug)
  }
})

test('two slugs that would have shared a file are refused before any file is written', () => {
  for (const slug of ['', 'about', '/about/', '//', 'about/']) {
    const doc = twoPages([text('t', 'Home')], [text('u', 'About')])
    doc.pages[1].slug = slug
    const out = compileSite(doc, { registry })
    assert.deepEqual(out.files, [], slug)
    assert.equal(out.problems[0]?.path, 'pages.1.slug', slug)
  }
})

test('the pages link to each other as the files lie: the home page at /, the others under their slug', () => {
  const link = node('lk', 'button')
  link.props = { label: 'About', link: { page: '/about' } }
  const back = node('bk', 'button')
  back.props = { label: 'Home', link: { page: '/' } }
  const out = compileSite(twoPages([link], [back]), { registry })
  assert.deepEqual(out.problems, [])
  assert.ok(out.files[1].content.includes('href="/"'))
  assert.ok(out.files[0].content.includes('href="/about"'))
})

test('a page that is off is not written', () => {
  const doc = twoPages([text('t', 'Home')], [text('u', 'About')])
  doc.pages[1].on = false
  const out = compileSite(doc, { registry })
  assert.deepEqual(
    out.files.map(f => f.path),
    ['index.html'],
  )
  assert.deepEqual(
    out.manifest.pages.map(p => p.id),
    ['home'],
  )
})

test('a page that fails is left out and its problems come back under its path', () => {
  const boom: KindSpec = {
    role: 'container',
    parents: 'any',
    tag: () => {
      throw new Error('outside code failed')
    },
    display: () => 'block',
    props: {},
    styles: [],
    states: [],
    bindable: [],
    repeatable: true,
    label: 'Boom',
    icon: 'x',
  }
  const reg = createRegistry()
  reg.use({ ...DEMO_PLUGIN, kinds: { boom } })
  const out = compileSite(twoPages([text('t', 'Home')], [node('b', 'boom')]), {
    registry: reg,
  })
  assert.deepEqual(
    out.files.map(f => f.path),
    ['index.html'],
  )
  assert.deepEqual(
    out.manifest.pages.map(p => p.id),
    ['home'],
  )
  assert.equal(out.problems.length, 1)
  assert.equal(out.problems[0].code, 'INVALID_DOCUMENT')
  assert.equal(out.problems[0].path, 'pages.about')
})

test('the problems of a page that compiled are returned too, under its path', () => {
  const many = Array.from({ length: 900 }, (_, i) => ({
    ...node(`n${i}`, 'column'),
    style: { base: { width: { n: i + 1, unit: 'px' as const } } },
  }))
  const out = compileSite(twoPages([text('t', 'Home')], many), { registry })
  assert.equal(out.files.length, 2)
  assert.deepEqual(
    out.problems.map(p => [p.code, p.path]),
    [['RESOURCE_LIMIT_EXCEEDED', 'pages.about.css']],
  )
})

test('an invalid document compiles no file and returns its problems', () => {
  const out = compileSite(siteWith([node('x', 'frame')]), { registry })
  assert.deepEqual(out.files, [])
  assert.deepEqual(out.manifest.pages, [])
  assert.ok(out.problems.length > 0)
  assert.doesNotThrow(() => compileSite(null as never, { registry }))
})

test('rows that break a source schema are reported once, under their own path', () => {
  const doc = twoPages([projectsList()], [projectsList('other')])
  const out = compileSite(doc, {
    registry,
    data: { rows: { projects: [{ title: 3 } as never] } },
  })
  assert.deepEqual(out.files, [])
  assert.equal(out.problems.length, 1)
  assert.ok(out.problems[0].path?.startsWith('projects.0'))
})

test('missing options return a problem and do not throw', () => {
  for (const o of [undefined, null, {}, { registry: null }])
    assert.doesNotThrow(() => {
      const out = compileSite(siteWith([text('t', 'x')]), o as never)
      assert.deepEqual(out.files, [])
      assert.ok(out.problems.length > 0)
    })
})

test('a font address that could bend the font rules is refused once for the site', () => {
  const doc = twoPages([text('t', 'x')], [text('u', 'y')])
  const out = compileSite(doc, { registry, fontBase: '/_fonts);x{}' })
  assert.deepEqual(out.files, [])
  assert.deepEqual(
    out.problems.map(p => p.path),
    ['fontBase'],
  )
})

test('compileSite compiles for the live site whatever the options say about the editor', () => {
  const out = compileSite(siteWith([text('t', 'x')]), {
    registry,
    mode: 'edit',
  })
  assert.ok(out.files[0].content.includes('<script>'))
  assert.ok(!out.files[0].content.includes('data-id='))
})
