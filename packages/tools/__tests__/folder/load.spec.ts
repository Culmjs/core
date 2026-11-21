import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compilePage, validateSite } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { derivedId } from '../../src/folder/ids.ts'
import { loadFiles, loadFolder, readProject } from '../../src/folder/load.ts'
import { loadPlugins } from '../../src/folder/plugins.ts'

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/site-basic',
)
const base = await readProject(FIXTURE)
const { registry } = await loadPlugins(FIXTURE, base)

/** The fixture's files with some replaced (`null` removes one), loaded. */
async function load(change: Record<string, string | null> = {}) {
  const files = new Map(base)
  for (const [k, v] of Object.entries(change))
    if (v === null) files.delete(k)
    else files.set(k, v)
  return loadFiles(files, registry)
}
const text = (name: string) => base.get(name)!
/** `text(name)` with the first `from` replaced by `to`. */
const swap = (name: string, from: string, to: string) => {
  assert.ok(text(name).includes(from), `${name} has ${from}`)
  return text(name).replace(from, to)
}
/** The 1-based line of the first line holding `needle`. */
const lineOf = (t: string, needle: string) => {
  const i = t.split('\n').findIndex(l => l.includes(needle))
  assert.ok(i >= 0, `has ${needle}`)
  return i + 1
}

test('the fixture loads with no problem and validateSite accepts the document', async () => {
  const l = await load()
  assert.deepEqual(l.problems, [])
  assert.ok(l.doc)
  assert.deepEqual(validateSite(l.doc, registry), [])
  assert.equal(l.doc.name, 'Basic')
  assert.deepEqual(l.doc.styles?.textRange, { min: 11, max: 96 })
  assert.deepEqual(
    l.files.map(f => f.path),
    [...base.keys()].sort(),
  )
})

test('pages come in the order of the pages list', async () => {
  assert.deepEqual(
    (await load()).doc?.pages.map(p => p.id),
    ['home', 'menu', 'about'],
  )
  const l = await load({
    'site.json': swap(
      'site.json',
      '["home.json", "menu.json", "about.json"]',
      '["about.json", "home.json", "menu.json"]',
    ),
  })
  assert.deepEqual(l.problems, [])
  assert.deepEqual(
    l.doc?.pages.map(p => p.id),
    ['about', 'home', 'menu'],
  )
})

test('a short form is expanded with the registered block and its settings applied', async () => {
  const { doc, map } = await load()
  const hero = doc!.pages[0]!.root.children![0]!
  assert.equal(hero.id, 'hero1')
  assert.deepEqual(hero.origin, { block: 'hero', version: 1, look: 'plain' })
  const title = hero.children![0]!.children![0]!
  assert.equal(title.id, 'hero1.title')
  assert.equal((title.props!.runs as { text: string }[])[0]!.text.length, 40)
  assert.deepEqual(title.style?.base, {
    width: 'fit',
    size: 64,
    nowrap: true,
  })
  assert.equal(title.required, true)
  assert.deepEqual(map.origin({ page: 'home' }, 'hero1.title'), {
    file: 'pages/home.json',
    path: ['root', 'children', 0],
    form: 'in-short',
    written: false,
  })
  // the menu page's card grid repeats over the source its setting names
  const cards = doc!.pages[1]!.root.children![0]!
  assert.equal(cards.id, 'cards1')
  assert.equal(cards.children![1]!.repeat?.source, 'menu')
})

test('one piece file is one component; each use is one instance carrying its values in `set`', async () => {
  const { doc, map } = await load()
  const id = derivedId('pieces/visit-card.json', [])
  assert.equal(doc!.components.length, 1)
  const c = doc!.components[0]!
  assert.deepEqual(
    [c.id, c.name, c.root.id, c.root.children!.map(k => k.id)],
    [id, 'pieces/visit-card.json', 'card', ['heading', 'line']],
  )
  assert.equal(map.pieceFile(id), 'pieces/visit-card.json')
  const uses = doc!.pages.map(p =>
    p.root.children!.find(k => k.kind === 'instance')!,
  )
  assert.deepEqual(
    uses.map(u => [u.id, u.component, u.set]),
    [
      ['visit1', id, undefined],
      ['visit2', id, undefined],
      ['visit3', id, { note: 'Open from 7' }],
    ],
  )
  assert.equal(map.pageFile('menu'), 'pages/menu.json')
})

test('a node without a written id gets the derived id, and is one notice with file and line', async () => {
  const l = await load()
  const id = derivedId('pages/menu.json', ['root', 'children', 2])
  assert.ok(l.doc!.pages[1]!.root.children!.some(k => k.id === id))
  const here = l.notices.filter(n => n.file === 'pages/menu.json')
  assert.equal(here.length, 1)
  assert.equal(here[0]!.nodeId, id)
  assert.equal(
    here[0]!.line,
    lineOf(text('pages/menu.json'), '"kind": "text"') - 1,
  )
  assert.deepEqual(l.map.origin({ page: 'menu' }, id)?.written, false)
  // the header block has no id either
  assert.ok(l.notices.some(n => n.file === 'site.json'))
})

test('locate gives file, line and column of a node, of a field of a node, of a setting key of a short form, and of a value of a use', async () => {
  const { map } = await load()
  const home = text('pages/home.json')
  const page = { page: 'home' }
  assert.deepEqual(map.locate(page, 'intro'), {
    file: 'pages/home.json',
    line: lineOf(home, '"id": "intro"') - 1,
    column: 7,
  })
  const size = map.locate(page, 'intro', 'style.base.size')
  assert.equal(size?.line, lineOf(home, '"size": 18'))
  assert.equal(
    size?.column,
    home.split('\n')[size!.line - 1]!.indexOf('"size"') + 1,
  )
  // a setting key of a short form
  const t = map.locate(page, 'hero1', 'titleSize')
  assert.deepEqual(
    [t?.file, t?.line, t?.column],
    ['pages/home.json', lineOf(home, '"titleSize"'), 9],
  )
  // a value of a use
  const about = text('pages/about.json')
  assert.deepEqual(map.locate({ page: 'about' }, 'visit3', 'note'), {
    file: 'pages/about.json',
    line: lineOf(about, '"note": "Open from 7"'),
    column:
      about.split('\n')[lineOf(about, '"note"') - 1]!.indexOf('"note"') + 1,
  })
  // a node inside a short form is the short form's place; a part of an instance is the use's
  assert.equal(
    map.locate(page, 'hero1.title')?.line,
    lineOf(home, '"block": "hero"') - 1,
  )
  assert.equal(map.locate(page, 'visit1.line')?.line, lineOf(home, '"use"'))
  assert.equal(map.locate(page, 'nope'), undefined)
})

test('locateProblem places a validateSite problem: a size outside the range points at the line of that size', async () => {
  const l = await load({
    'pages/home.json': swap('pages/home.json', '"size": 18', '"size": 120'),
  })
  assert.equal(l.problems.length, 1)
  const p = l.problems[0]!
  assert.equal(p.rule, 'textRange')
  assert.equal(p.nodeId, 'intro')
  assert.equal(p.file, 'pages/home.json')
  assert.equal(
    p.line,
    lineOf(
      l.files.find(f => f.path === 'pages/home.json')!.text,
      '"size": 120',
    ),
  )
  // the document is still there: only validation failed
  assert.ok(l.doc)
  // a problem about a part of an instance lands on the `use`
  const part = l.map.locateProblem({
    code: 'POLICY_VIOLATION' as const,
    message: 'x',
    nodeId: 'visit1',
    path: 'parts.line.props',
  })
  assert.equal(part.line, lineOf(text('pages/home.json'), '"use"'))
  // a problem about a part named by its dotted id lands on the `use` too
  const dotted = l.map.locateProblem({
    code: 'INVALID_NODE' as const,
    message: 'x',
    nodeId: 'visit1.line',
    path: 'props.runs',
  })
  assert.equal(dotted.line, lineOf(text('pages/home.json'), '"use"'))
  // a problem about the site
  const site = l.map.locateProblem({
    code: 'INVALID_DOCUMENT' as const,
    message: 'x',
    path: 'styles.textRange',
  })
  assert.deepEqual(
    [site.file, site.line],
    ['site.json', lineOf(text('site.json'), '"textRange"')],
  )
})

test('data/menu.json becomes rows in `data` after checkRows; a row with an unknown field is a located problem', async () => {
  const ok = await load()
  assert.equal(ok.data.rows.menu!.length, 4)
  assert.equal(ok.data.rows.menu![0]!.name, 'Sourdough')
  const l = await load({
    'data/menu.json': swap(
      'data/menu.json',
      '"price": "3"',
      '"price": "3", "colour": "gold"',
    ),
  })
  assert.equal(l.doc, undefined)
  const p = l.problems.find(x => x.file === 'data/menu.json')!
  assert.ok(p)
  assert.equal(
    p.line,
    lineOf(
      text('data/menu.json').replace(
        '"price": "3"',
        '"price": "3", "colour": "gold"',
      ),
      'colour',
    ),
  )
  assert.equal(l.data.rows.menu, undefined)
})

test('a missing page file', async () => {
  const l = await load({ 'pages/about.json': null })
  assert.equal(l.doc, undefined)
  assert.equal(l.problems.length, 1)
  assert.deepEqual(
    [l.problems[0]!.file, l.problems[0]!.line],
    ['site.json', lineOf(text('site.json'), '"pages"')],
  )
  assert.match(l.problems[0]!.message, /pages\/about\.json is missing/)
})

test('a page file the list does not name', async () => {
  const l = await load({
    'pages/extra.json': '{ "id": "extra", "root": { "kind": "column" } }',
  })
  assert.equal(l.problems.length, 1)
  assert.deepEqual(
    [l.problems[0]!.file, l.problems[0]!.line],
    ['pages/extra.json', 1],
  )
  assert.match(l.problems[0]!.message, /not in the "pages" list/)
})

test('an unknown setting on a short form', async () => {
  const l = await load({
    'pages/home.json': swap(
      'pages/home.json',
      '"nowrap": true,',
      '"nowrap": true,\n        "bogus": 1,',
    ),
  })
  assert.equal(l.doc, undefined)
  assert.equal(l.problems.length, 1)
  const p = l.problems[0]!
  assert.equal(p.file, 'pages/home.json')
  assert.equal(
    p.line,
    lineOf(
      text('pages/home.json').replace(
        '"nowrap": true,',
        '"nowrap": true,\n        "bogus": 1,',
      ),
      '"bogus"',
    ),
  )
  assert.match(p.message, /no setting "bogus"/)
  assert.ok(p.allowed?.includes('title'))
})

test('a use of a missing piece', async () => {
  const l = await load({
    'pages/home.json': swap('pages/home.json', 'visit-card.json', 'nope.json'),
  })
  assert.equal(l.problems.length, 1)
  assert.deepEqual(
    [l.problems[0]!.file, l.problems[0]!.line],
    ['pages/home.json', lineOf(text('pages/home.json'), '"use"')],
  )
  assert.match(l.problems[0]!.message, /pieces\/nope\.json is missing/)
})

test('a circular use', async () => {
  const l = await load({
    'pages/home.json': swap('pages/home.json', 'visit-card.json', 'a.json'),
    'pieces/a.json':
      '{ "root": { "id": "a", "kind": "box", "children": [ { "use": "./b.json", "id": "ub" } ] } }',
    'pieces/b.json':
      '{ "root": { "id": "b", "kind": "box", "children": [\n { "use": "./a.json", "id": "ua" } ] } }',
  })
  const p = l.problems.filter(x => /uses itself/.test(x.message))
  assert.equal(p.length, 1)
  assert.deepEqual([p[0]!.file, p[0]!.line], ['pieces/b.json', 2])
  assert.equal(l.doc, undefined)
})

test('a use path outside the project', async () => {
  const l = await load({
    'pages/home.json': swap(
      'pages/home.json',
      '../pieces/visit-card.json',
      '../../secret.json',
    ),
  })
  assert.equal(l.problems.length, 1)
  assert.deepEqual(
    [l.problems[0]!.file, l.problems[0]!.line, l.problems[0]!.code],
    [
      'pages/home.json',
      lineOf(text('pages/home.json'), '"use"'),
      'POLICY_VIOLATION',
    ],
  )
  assert.match(l.problems[0]!.message, /outside the project/)
})

test('a node that a trigger refers to but that has no written id', async () => {
  const target = derivedId('pages/menu.json', ['root', 'children', 2])
  const t = swap(
    'pages/menu.json',
    '"name": "Page",',
    `"name": "Page",\n    "on": [{ "on": "enter-view", "do": { "scrollTo": "${target}" } }],`,
  )
  const l = await load({ 'pages/menu.json': t })
  assert.equal(l.doc, undefined)
  assert.equal(l.problems.length, 1)
  assert.equal(l.problems[0]!.file, 'pages/menu.json')
  assert.equal(l.problems[0]!.line, lineOf(t, '"scrollTo"'))
  assert.match(l.problems[0]!.message, /no written id/)
  // the same trigger at a node with a written id is fine
  const ok = await load({ 'pages/menu.json': t.replace(target, 'cards1') })
  assert.deepEqual(ok.problems, [])
})

test('a JSON syntax error in a file the loader owns is one problem and the load returns no document', async () => {
  for (const [file, broken] of [
    [
      'pieces/visit-card.json',
      text('pieces/visit-card.json').replace('"root": {', '"root" {'),
    ],
    ['pages/menu.json', text('pages/menu.json') + '}'],
    ['site.json', text('site.json').replace('"Basic"', '"Basic')],
  ] as const) {
    const l = await load({ [file]: broken })
    assert.equal(l.doc, undefined, file)
    assert.equal(l.problems.length, 1, file)
    assert.equal(l.problems[0]!.file, file)
    assert.ok(l.problems[0]!.line! >= 1, file)
  }
})

/** What a caller that runs loadPlugins and then loadFiles sees. */
async function both(change: Record<string, string>) {
  const files = new Map(base)
  for (const [k, v] of Object.entries(change)) files.set(k, v)
  const plugins = await loadPlugins(FIXTURE, files)
  const loaded = await loadFiles(files, plugins.registry, {
    alreadyReported: true,
  })
  return { problems: [...plugins.problems, ...loaded.problems], loaded }
}

test('loadFiles alone reports a broken file it does not own, once', async () => {
  for (const [file, broken] of [
    [
      'blocks/hero.json',
      text('blocks/hero.json').replace('"version": 1,', '"version": ,'),
    ],
    ['data/menu.json', text('data/menu.json').replace('"fields"', 'fields')],
    [
      'culm.json',
      text('culm.json').replace('"plugins": []', '"plugins": [ , ,'),
    ],
  ] as const) {
    const l = await load({ [file]: broken })
    assert.equal(l.doc, undefined, file)
    assert.equal(l.problems.length, 1, file)
    assert.equal(l.problems[0]!.file, file)
    assert.ok(l.problems[0]!.line! >= 1)
  }
})

test('each file has one owner: a change to one file is reported once by loadPlugins and loadFiles together', async () => {
  const clean = await both({})
  assert.deepEqual(clean.problems, [])
  for (const [file, broken] of [
    [
      'data/menu.json',
      swap('data/menu.json', '"price": "3"', '"price": "3", "colour": "gold"'),
    ],
    [
      'blocks/hero.json',
      text('blocks/hero.json').replace('"version": 1,', '"version": ,'),
    ],
    ['data/menu.json', text('data/menu.json').replace('"fields"', 'fields')],
    [
      'culm.json',
      text('culm.json').replace('"plugins": []', '"plugins": [ , ,'),
    ],
  ] as const) {
    const r = await both({ [file]: broken })
    assert.equal(r.problems.length, 1, `${file}: ${JSON.stringify(r.problems)}`)
    assert.equal(r.problems[0]!.file, file)
    assert.ok(r.problems[0]!.line! >= 1)
  }
})

test('the hero title follows its text and its row stacks on a phone, so a nowrap title passes its parent', async () => {
  const { loaded } = await both({})
  const c = compilePage(loaded.doc!, 'home', {
    registry,
    data: loaded.data,
    mode: 'measure',
  })
  assert.ok(c.ok)
  const cls = (id: string) =>
    new RegExp(`class="(c\\d+)" data-id="${id.replace('.', '\\.')}"`).exec(
      c.html,
    )![1]!
  const rule = (k: string) => new RegExp(`\\.${k}\\{[^}]*\\}`).exec(c.css)![0]
  const title = rule(cls('hero1.title'))
  // the box is as wide as the line (a width that hugs the text), and flex does not squeeze it to the row
  assert.match(title, /width:fit-content/)
  assert.match(title, /font-size:64px/)
  assert.match(title, /white-space:nowrap/)
  // the row is a column at 600 px and below, so the title is not stretched or shrunk across the row
  const inner = cls('hero1.inner')
  assert.match(
    c.css,
    new RegExp(
      `@media \\(max-width: 600px\\)\\{[^]*?\\.${inner}\\{flex-direction:column\\}`,
    ),
  )
})

test('the CUJ 3 repair (phone nowrap false, size 28) gives the title wrapping text that fits its row', async () => {
  const { loaded } = await both({})
  const doc = structuredClone(loaded.doc!)
  const title = doc.pages[0]!.root.children![0]!.children![0]!.children![0]!
  assert.equal(title.id, 'hero1.title')
  title.style!.phone = { nowrap: false, size: 28 }
  const c = compilePage(doc, 'home', {
    registry,
    data: loaded.data,
    mode: 'measure',
  })
  assert.ok(c.ok)
  const k = new RegExp('class="(c\\d+)" data-id="hero1\\.title"').exec(
    c.html,
  )![1]!
  // the base rule keeps the fit width; the phone rule turns wrapping back on and shrinks the text
  assert.match(c.css, new RegExp(`\\.${k}\\{[^}]*width:fit-content`))
  const phone = new RegExp(
    `@media \\(max-width: 600px\\)\\{[^]*?\\.${k}\\{([^}]*)\\}`,
  ).exec(c.css)![1]!
  assert.match(phone, /font-size:28px/)
  assert.match(phone, /white-space:normal/)
})

test('a symbolic link in pieces/ that points outside the project is refused with file and line', async () => {
  const dir = await copyFixture('site-basic')
  const outside = mkdtempSync(join(tmpdir(), 'culm-outside-'))
  try {
    writeFileSync(
      join(outside, 'secret.json'),
      '{ "root": { "id": "s", "kind": "box" } }',
    )
    symlinkSync(join(outside, 'secret.json'), join(dir, 'pieces/x.json'))
    const files = await readProject(dir)
    assert.equal(files.has('pieces/x.json'), false)
    // nothing refers to it: the link itself is named
    let l = await loadFolder(dir, registry)
    assert.equal(l.problems.length, 1)
    assert.deepEqual(
      [l.problems[0]!.file, l.problems[0]!.line, l.problems[0]!.code],
      ['pieces/x.json', 1, 'POLICY_VIOLATION'],
    )
    assert.match(
      l.problems[0]!.message,
      /symbolic link that leaves the project/,
    )
    // a use of it is named at the use
    writeFileSync(
      join(dir, 'pages/home.json'),
      swap('pages/home.json', 'visit-card.json', 'x.json'),
    )
    l = await loadFolder(dir, registry)
    assert.equal(l.problems.length, 1)
    assert.deepEqual(
      [l.problems[0]!.file, l.problems[0]!.line],
      ['pages/home.json', lineOf(text('pages/home.json'), '"use"')],
    )
    assert.ok(!l.files.some(f => f.text.includes('"id": "s"')))
    assert.equal(l.doc, undefined)
  } finally {
    rmSync(outside, { recursive: true })
  }
})

test('a link in pages/, blocks/ or data/ that leaves the project is refused at the link', async () => {
  const dir = await copyFixture('site-basic')
  const outside = mkdtempSync(join(tmpdir(), 'culm-outside-'))
  try {
    writeFileSync(join(outside, 'x.json'), '{}')
    for (const f of ['pages/zz.json', 'blocks/zz.json', 'data/zz.json'])
      symlinkSync(join(outside, 'x.json'), join(dir, f))
    const l = await loadFolder(dir, registry)
    assert.deepEqual(
      l.problems.map(p => [p.file, p.line, p.code]),
      ['pages/zz.json', 'blocks/zz.json', 'data/zz.json'].map(f => [
        f,
        1,
        'POLICY_VIOLATION',
      ]),
    )
    assert.equal(l.doc, undefined)
  } finally {
    rmSync(outside, { recursive: true })
  }
})

test('site.json as a link that leaves the project is refused, not missing', async () => {
  const dir = await copyFixture('site-basic')
  const outside = mkdtempSync(join(tmpdir(), 'culm-outside-'))
  try {
    writeFileSync(join(outside, 'site.json'), '{}')
    rmSync(join(dir, 'site.json'))
    symlinkSync(join(outside, 'site.json'), join(dir, 'site.json'))
    const l = await loadFolder(dir, registry)
    assert.equal(l.problems.length, 1)
    assert.deepEqual(
      [l.problems[0]!.file, l.problems[0]!.line, l.problems[0]!.code],
      ['site.json', 1, 'POLICY_VIOLATION'],
    )
    assert.match(l.problems[0]!.message, /symbolic link/)
  } finally {
    rmSync(outside, { recursive: true })
  }
})

test('a symbolic link to a file inside the project is read', async () => {
  const dir = await copyFixture('site-basic')
  symlinkSync(
    join(dir, 'pieces/visit-card.json'),
    join(dir, 'pieces/alias.json'),
  )
  const files = await readProject(dir)
  assert.equal(
    files.get('pieces/alias.json'),
    files.get('pieces/visit-card.json'),
  )
})

test('load and write-back with no change leaves every file byte for byte the same', async () => {
  const dir = await copyFixture('site-basic')
  const { registry: r, problems } = await loadPlugins(
    dir,
    await readProject(dir),
  )
  assert.deepEqual(problems, [])
  const l = await loadFolder(dir, r)
  assert.deepEqual(l.problems, [])
  assert.equal(l.files.length, 10)
  for (const f of l.files)
    assert.equal(readFileSync(join(dir, f.path), 'utf8'), f.text, f.path)
  assert.match(l.files[0]!.sha256, /^[0-9a-f]{64}$/)
})
