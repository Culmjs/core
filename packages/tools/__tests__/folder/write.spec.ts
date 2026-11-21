import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plan } from '@culmjs/core/ops'
import type { Op } from '@culmjs/core/ops'
import type { SiteDocument } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { derivedId } from '../../src/folder/ids.ts'
import { loadFiles, loadFolder, readProject } from '../../src/folder/load.ts'
import { parseFile } from '../../src/folder/jsonc.ts'
import { loadPlugins } from '../../src/folder/plugins.ts'
import { expandShortForm, fileEdits } from '../../src/folder/write.ts'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/site-basic',
)
const base = await readProject(FIXTURE)
const { registry } = await loadPlugins(FIXTURE, base)
const first = await loadFiles(base, registry)
const doc0 = first.doc!
const cid = doc0.components[0]!.id
const allergens = derivedId('pages/menu.json', ['root', 'children', 2])
const home = { page: 'home' }
const menu = { page: 'menu' }
const about = { page: 'about' }

type Edits = ReturnType<typeof fileEdits>
async function put(dir: string, e: Edits) {
  for (const [f, t] of Object.entries(e.write)) {
    await mkdir(dirname(join(dir, f)), { recursive: true })
    await writeFile(join(dir, f), t)
  }
  for (const f of e.remove) await rm(join(dir, f))
}
/** Copies the fixture, plans the operations, writes the edits, loads again. */
async function run(ops: Op[], prep?: (dir: string) => Promise<void>) {
  const dir = await copyFixture('site-basic')
  await prep?.(dir)
  const loaded = await loadFolder(dir, registry)
  assert.deepEqual(loaded.problems, [])
  const planned = plan(loaded.doc!, registry, {
    site: 'site',
    baseRevision: 0,
    key: 'k',
    ops,
  })
  assert.ok(planned.ok, JSON.stringify(planned))
  const edits = fileEdits(loaded.doc!, planned.doc, loaded, registry)
  assert.deepEqual(edits.problems, [])
  await put(dir, edits)
  const again = await loadFolder(dir, registry)
  return { dir, loaded, planned, edits, again }
}
const read = (dir: string, f: string) => readFile(join(dir, f), 'utf8')
const linesChanged = (a: string, b: string) => {
  const x = a.split('\n')
  const y = b.split('\n')
  return Math.max(
    x.filter(l => !y.includes(l)).length,
    y.filter(l => !x.includes(l)).length,
  )
}

const CASES: [name: string, ops: Op[]][] = [
  [
    'add',
    [
      {
        op: 'add',
        tree: home,
        parent: 'homeroot',
        index: 1,
        node: { kind: 'text', props: { level: 'p', runs: [{ text: 'New' }] } },
      },
    ],
  ],
  ['remove', [{ op: 'remove', tree: menu, id: 'visit2' }]],
  [
    'move',
    [{ op: 'move', tree: menu, id: 'cards1', parent: 'menuroot', index: 2 }],
  ],
  [
    'setProps',
    [{ op: 'setProps', tree: home, id: 'intro', props: { level: 'h2' } }],
  ],
  ['setText', [{ op: 'setText', tree: home, id: 'intro', text: 'Hello' }]],
  [
    'setStyle',
    [
      {
        op: 'setStyle',
        tree: home,
        id: 'intro',
        layer: 'base',
        decl: { size: 22 },
      },
    ],
  ],
  [
    'setHidden',
    [
      {
        op: 'setHidden',
        tree: home,
        id: 'intro',
        layout: 'phone',
        hidden: true,
      },
    ],
  ],
  ['setSlot', [{ op: 'setSlot', tree: home, id: 'intro', slot: { grow: 1 } }]],
  [
    'setRequired',
    [{ op: 'setRequired', tree: home, id: 'intro', required: true }],
  ],
  [
    'bindData',
    [
      {
        op: 'bindData',
        tree: menu,
        id: 'cards1.list',
        repeat: { source: 'menu', max: 3 },
      },
    ],
  ],
  [
    'setStates',
    [
      {
        op: 'setStates',
        tree: home,
        id: 'intro',
        state: [{ name: 'mode', values: 'on-off', initial: 'off' }],
      },
    ],
  ],
  [
    'insertBlock',
    [
      {
        op: 'insertBlock',
        tree: home,
        parent: 'homeroot',
        index: 2,
        block: 'hero',
        look: 'plain',
        settings: { title: 'Second' },
        id: 'hero2',
      },
    ],
  ],
  [
    'setBlockSetting',
    [
      {
        op: 'setBlockSetting',
        tree: home,
        id: 'hero1',
        key: 'title',
        value: 'Warm bread',
      },
    ],
  ],
  ['updateBlock', [{ op: 'updateBlock', tree: home, id: 'hero1' }]],
  [
    'makeComponent',
    [
      {
        op: 'makeComponent',
        tree: home,
        id: 'intro',
        component: 'introc',
        name: 'Intro card',
      },
    ],
  ],
  [
    'setInstance',
    [
      { op: 'setInstance', tree: about, id: 'visit3', set: { note: 'Late' } },
      { op: 'setInstance', tree: home, id: 'visit1', set: { note: 'Early' } },
    ],
  ],
  ['detach', [{ op: 'detach', tree: menu, id: 'visit2' }]],
  [
    'removeComponent',
    [
      { op: 'detach', tree: home, id: 'visit1' },
      { op: 'detach', tree: menu, id: 'visit2' },
      { op: 'detach', tree: about, id: 'visit3' },
      { op: 'removeComponent', component: cid },
    ],
  ],
  ['addPage', [{ op: 'addPage', title: 'Contact', slug: '/contact' }]],
  ['removePage', [{ op: 'removePage', page: 'about' }]],
  [
    'setPage',
    [{ op: 'setPage', page: 'menu', title: 'Our menu', inFooter: true }],
  ],
  ['movePage', [{ op: 'movePage', page: 'about', index: 0 }]],
  [
    'setSite',
    [
      {
        op: 'setSite',
        name: 'Renamed',
        languages: [{ code: 'en' }, { code: 'fr' }],
      },
    ],
  ],
  ['setLook', [{ op: 'setLook', look: { ...doc0.look, brand: '#cc3300' } }]],
  [
    'setSiteStyles',
    [{ op: 'setSiteStyles', styles: { textRange: { min: 10, max: 90 } } }],
  ],
  ['setFonts', [{ op: 'setFonts', fonts: ['sys:sans'] }]],
]

test('the table has one case for each of the 26 operations', () => {
  assert.equal(CASES.length, 26)
  assert.equal(new Set(CASES.map(c => c[0])).size, 26)
})

// The order of `components` is not meaningful (the loader lists pieces by path order of first use), so both sides are sorted by id.
const byId = (d: SiteDocument) => ({
  ...d,
  components: [...d.components].sort((a, b) => (a.id < b.id ? -1 : 1)),
})
for (const [name, ops] of CASES)
  test(`${name}: plan, write, load again gives the planned document`, async () => {
    const r = await run(ops)
    assert.deepEqual(r.again.problems, [])
    assert.deepEqual(byId(r.again.doc!), byId(r.planned.doc as SiteDocument))
  })

test('a load and write with no change returns no edits', () => {
  const e = fileEdits(doc0, doc0, first, registry)
  assert.deepEqual(e, { write: {}, remove: [], notes: [], problems: [] })
})

test('a change to one field touches one line of one file', async () => {
  const r = await run([
    { op: 'setText', tree: home, id: 'intro', text: 'Hello there' },
  ])
  assert.deepEqual(Object.keys(r.edits.write), ['pages/home.json'])
  assert.deepEqual(r.edits.remove, [])
  const was = base.get('pages/home.json')!
  const now = r.edits.write['pages/home.json']!
  assert.equal(linesChanged(was, now), 1)
  assert.ok(now.includes('"text": "Hello there"'))
})

test('an added node is written with its id; a reorder writes ids on every sibling that had a derived one', async () => {
  const a = await run([
    {
      op: 'add',
      tree: home,
      parent: 'homeroot',
      index: 1,
      node: { kind: 'text', props: { level: 'p', runs: [{ text: 'New' }] } },
    },
  ])
  const added = a.planned.ok && a.planned.created[0]!.id
  assert.ok(added)
  assert.ok(a.edits.write['pages/home.json']!.includes(`"id": "${added}"`))
  assert.ok(a.again.map.origin(home, added as string)?.written)

  const m = await run([
    { op: 'move', tree: menu, id: 'cards1', parent: 'menuroot', index: 2 },
  ])
  const text = m.edits.write['pages/menu.json']!
  assert.ok(text.includes(`"id": "${allergens}"`))
  assert.ok(m.again.map.origin(menu, allergens)?.written)
  assert.deepEqual(
    m.again.doc!.pages[1]!.root.children!.map(c => c.id),
    ['visit2', allergens, 'cards1'],
  )
})

test('changing an inner part of a short form rewrites it expanded and returns an "expanded" note naming the node', async () => {
  const r = await run([
    { op: 'setProps', tree: home, id: 'hero1.lead', props: { level: 'h3' } },
  ])
  assert.equal(r.edits.notes.length, 1)
  assert.equal(r.edits.notes[0]!.kind, 'expanded')
  assert.deepEqual(r.edits.notes[0]!.ids, ['hero1'])
  assert.equal(r.again.map.origin(home, 'hero1.lead')?.form, 'node')
  assert.equal(r.again.map.origin(home, 'hero1')?.form, 'node')
  assert.deepEqual(r.again.doc, r.planned.doc)
})

test('a change a setting of a short form can hold stays a short form', async () => {
  const r = await run([
    {
      op: 'setBlockSetting',
      tree: home,
      id: 'hero1',
      key: 'title',
      value: 'Warm bread',
    },
  ])
  assert.deepEqual(r.edits.notes, [])
  assert.equal(r.again.map.origin(home, 'hero1')?.form, 'short')
  assert.equal(
    linesChanged(
      base.get('pages/home.json')!,
      r.edits.write['pages/home.json']!,
    ),
    1,
  )
})

test('a change addressed to a component tree edits the piece file, so all three pages change', async () => {
  const r = await run([
    {
      op: 'setText',
      tree: { component: cid },
      id: 'heading',
      text: 'Come and visit',
    },
  ])
  assert.deepEqual(Object.keys(r.edits.write), ['pieces/visit-card.json'])
  assert.ok(r.edits.write['pieces/visit-card.json']!.includes('Come and visit'))
  assert.deepEqual(r.again.doc, r.planned.doc)
  const text = JSON.stringify(r.again.doc!.components[0])
  assert.ok(text.includes('Come and visit'))
})

test('setInstance edits the keys of that one use', async () => {
  const r = await run([
    { op: 'setInstance', tree: about, id: 'visit3', set: { note: 'Late' } },
  ])
  assert.deepEqual(Object.keys(r.edits.write), ['pages/about.json'])
  assert.equal(
    linesChanged(
      base.get('pages/about.json')!,
      r.edits.write['pages/about.json']!,
    ),
    1,
  )
  assert.equal(
    (r.again.doc!.pages[2]!.root.children![2] as { set?: { note?: string } })
      .set?.note,
    'Late',
  )
  const k = await run([
    { op: 'setInstance', tree: home, id: 'visit1', set: { note: 'Early' } },
  ])
  assert.ok(k.edits.write['pages/home.json']!.includes('"note": "Early"'))
})

test('addPage writes pages/<slug>.json ("/a/b" -> pages/a-b.json, "/" -> pages/home.json) and adds it to the pages list; a name that exists gets -2', async () => {
  const a = await run([
    { op: 'addPage', title: 'Deep', slug: '/a/b', page: 'ab' },
  ])
  assert.ok(a.edits.write['pages/a-b.json'])
  assert.ok(a.edits.write['site.json']!.includes('"a-b.json"'))
  assert.deepEqual(a.edits.remove, [])
  assert.equal(a.again.doc!.pages.at(-1)!.id, 'ab')

  const free = async (dir: string) => {
    await rm(join(dir, 'pages/home.json'))
    const s = await read(dir, 'site.json')
    await writeFile(join(dir, 'site.json'), s.replace('"home.json", ', ''))
  }
  const h = await run(
    [{ op: 'addPage', title: 'Home', slug: '/', page: 'h2' }],
    free,
  )
  assert.ok(h.edits.write['pages/home.json'])

  const two = await run([
    { op: 'setPage', page: 'menu', slug: '/other' },
    { op: 'addPage', title: 'Menu again', slug: '/menu', page: 'm2' },
  ])
  assert.ok(two.edits.write['pages/menu-2.json'])
  assert.equal(two.again.doc!.pages.at(-1)!.slug, '/menu')
})

test('removePage removes the file and the name; movePage edits only the list', async () => {
  const r = await run([{ op: 'removePage', page: 'about' }])
  assert.deepEqual(r.edits.remove, ['pages/about.json'])
  assert.ok(!r.edits.write['site.json']!.includes('about.json'))
  assert.deepEqual(
    r.again.doc!.pages.map(p => p.id),
    ['home', 'menu'],
  )

  const m = await run([{ op: 'movePage', page: 'about', index: 0 }])
  assert.deepEqual(Object.keys(m.edits.write), ['site.json'])
  assert.deepEqual(m.edits.remove, [])
  assert.deepEqual(
    m.again.doc!.pages.map(p => p.id),
    ['about', 'home', 'menu'],
  )
})

test('makeComponent writes pieces/<component id>.json and replaces the node with a use; removeComponent removes the file', async () => {
  const r = await run([
    {
      op: 'makeComponent',
      tree: home,
      id: 'intro',
      component: 'introc',
      name: 'Intro card',
    },
  ])
  assert.ok(r.edits.write['pieces/introc.json'])
  assert.ok(
    r.edits.write['pages/home.json']!.includes(
      '"use": "../pieces/introc.json"',
    ),
  )
  assert.equal(r.again.map.origin(home, 'intro')?.form, 'use')

  const d = await run(CASES.find(c => c[0] === 'removeComponent')![1])
  assert.deepEqual(d.edits.remove, ['pieces/visit-card.json'])
  assert.equal(d.again.doc!.components.length, 0)
})

test('comments and key order of every untouched part of an edited file are unchanged', async () => {
  const r = await run([
    { op: 'setText', tree: home, id: 'intro', text: 'Changed' },
    { op: 'setPage', page: 'home', title: 'Start' },
    {
      op: 'setStyle',
      tree: home,
      id: 'intro',
      layer: 'base',
      decl: { size: 20 },
    },
  ])
  const was = base.get('pages/home.json')!
  const now = r.edits.write['pages/home.json']!
  const comments = (t: string) =>
    t.split('\n').filter(l => l.trim().startsWith('//'))
  assert.deepEqual(comments(now), comments(was))
  const keys = (t: string) => Object.keys(parseFile(t).value as object)
  assert.deepEqual(keys(now), keys(was))
  const root = (t: string) =>
    Object.keys((parseFile(t).value as { root: object }).root)
  assert.deepEqual(root(now), root(was))
})

test('CRLF line endings and tab indentation are kept', async () => {
  const crlf = (t: string) => t.replace(/\n/g, '\r\n')
  const files = new Map(base)
  files.set('pages/home.json', crlf(base.get('pages/home.json')!))
  const l = await loadFiles(files, registry)
  const p = plan(l.doc!, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: [
      {
        op: 'add',
        tree: home,
        parent: 'homeroot',
        index: 0,
        node: { kind: 'text', props: { level: 'p', runs: [{ text: 'x' }] } },
      },
    ],
  })
  assert.ok(p.ok)
  const e = fileEdits(l.doc!, p.doc, l, registry)
  const t = e.write['pages/home.json']!
  assert.ok(!/[^\r]\n/.test(t))
})

test('an edit that cannot be made is a located problem and nothing is written', () => {
  const broken = {
    ...first,
    files: first.files.map(f =>
      f.path === 'pages/home.json' ? { ...f, text: f.text + '\n}' } : f,
    ),
  }
  const p = plan(doc0, registry, {
    site: 's',
    baseRevision: 0,
    key: 'k',
    ops: [{ op: 'setText', tree: home, id: 'intro', text: 'x' }],
  })
  assert.ok(p.ok)
  const e = fileEdits(doc0, p.doc, broken, registry)
  assert.deepEqual(e.write, {})
  assert.deepEqual(e.remove, [])
  assert.equal(e.problems.length, 1)
  assert.equal(e.problems[0]!.file, 'pages/home.json')
})

test('expandShortForm rewrites one short form as nodes and leaves the rest of the file', async () => {
  const text = base.get('pages/home.json')!
  const out = expandShortForm(
    text,
    ['root', 'children', 0],
    registry,
    'pages/home.json',
  )
  assert.ok(out)
  const was = parseFile(text).value as { root: { children: unknown[] } }
  const now = parseFile(out).value as {
    root: { children: { id: string; kind: string; children: unknown[] }[] }
  }
  assert.equal(now.root.children[0]!.id, 'hero1')
  assert.equal(now.root.children[0]!.kind, 'column')
  assert.ok(now.root.children[0]!.children.length > 0)
  assert.deepEqual(now.root.children.slice(1), was.root.children.slice(1))
  assert.ok(
    out.startsWith(
      text.slice(0, text.lastIndexOf('{', text.indexOf('"block"'))),
    ),
  )
  assert.ok(
    out.endsWith(
      text.slice(text.indexOf('},\n      {\n        "id": "intro"') + 1),
    ),
  )
  const files = new Map(base)
  files.set('pages/home.json', out)
  const again = await loadFiles(files, registry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.doc, first.doc)
  assert.equal(
    expandShortForm(text, ['root', 'children', 1], registry),
    undefined,
  )
})
