import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { checkSiteFont } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { startFake } from '../fakeSources.ts'
import { fetchFor, makeGet } from '../../src/folder/fetch.ts'
import { readHeld } from '../../src/folder/held.ts'
import { openProject } from '../../src/folder/project.ts'

const fake = await startFake()
after(() => fake.close())

async function site() {
  const dir = await copyFixture('site-basic')
  const doc = (await openProject(dir)).loaded.doc!
  fake.heal()
  fake.hits.length = 0
  return { dir, doc, o: { hosts: fake.hosts } }
}
const set = (...fonts: unknown[]) => [{ op: 'setFonts', fonts }]
const slab = (extra: object = {}) => ({ google: 'Roboto Slab', ...extra })
const fontsDir = async (dir: string) =>
  (await readdir(join(dir, 'fonts')).catch(() => [] as string[])).sort()
const ofType = (hits: string[], re: RegExp) => hits.filter(h => re.test(h))

test('setFonts [{google:"Roboto Slab"}] fetches 400 and 700 once, writes font.json, LICENSE and one woff2, and the op becomes ["up:roboto-slab"]', async () => {
  const { dir, doc, o } = await site()
  const r = await fetchFor(dir, doc, set(slab()), o)
  assert.ok(r.ok)
  assert.deepEqual(r.ops, set('up:roboto-slab'))
  assert.deepEqual(await fontsDir(dir), ['roboto-slab'])
  assert.deepEqual((await readdir(join(dir, 'fonts/roboto-slab'))).sort(), [
    '400-700.woff2',
    'LICENSE',
    'font.json',
  ])
  assert.equal(ofType(fake.hits, /^\/css2/).length, 1)
  assert.equal(ofType(fake.hits, /woff2$/).length, 1)
  assert.match(
    await readFile(join(dir, 'fonts/roboto-slab/LICENSE'), 'utf8'),
    /OPEN FONT LICENSE/,
  )
})

test('the stored font.json passes checkSiteFont and names licence OFL-1.1, kind serif and the css2 source URL', async () => {
  const { dir, doc, o } = await site()
  await fetchFor(dir, doc, set(slab()), o)
  const j = JSON.parse(
    await readFile(join(dir, 'fonts/roboto-slab/font.json'), 'utf8'),
  )
  const f = checkSiteFont(j)
  assert.ok(f)
  assert.equal(f.licence, 'OFL-1.1')
  assert.equal(f.kind, 'serif')
  assert.equal(f.family, 'Roboto Slab')
  assert.equal(
    f.source,
    `${fake.hosts.css}/css2?family=Roboto+Slab:ital,wght@0,400;0,700&display=swap`,
  )
  assert.deepEqual(f.files, [
    { weight: [400, 700], style: 'normal', file: '400-700.woff2' },
  ])
})

test('only the latin block is kept', async () => {
  const { dir, doc, o } = await site()
  await fetchFor(dir, doc, set(slab({ italic: true })), o)
  assert.equal(ofType(fake.hits, /cyr-/).length, 0)
  assert.equal(ofType(fake.hits, /lat-/).length, 2)
  assert.deepEqual((await readdir(join(dir, 'fonts/roboto-slab'))).sort(), [
    '400-700-italic.woff2',
    '400-700.woff2',
    'LICENSE',
    'font.json',
  ])
})

test('a css2 src on another host, a file without wOF2, a 3 MB file and a dropped connection are FETCH_FAILED with op, and fonts/ holds no new folder', async () => {
  const cases: [string, (f: typeof fake) => void][] = [
    ['another host', f => f.fail('/css2', 'foreign')],
    ['not woff2', f => f.fail('/gstatic', 'notfont')],
    ['3 MB', f => f.fail('/gstatic', 'huge')],
    [
      'dropped after the files',
      f => f.fail('/gh/ofl/robotoslab/OFL.txt', 'drop'),
    ],
    ['dropped css', f => f.fail('/css2', 'drop')],
    ['404 file', f => f.fail('/gstatic', 404)],
  ]
  for (const [name, arm] of cases) {
    const { dir, doc, o } = await site()
    arm(fake)
    const r = await fetchFor(dir, doc, [{ op: 'noop' }, ...set(slab())], o)
    assert.ok(!r.ok, name)
    assert.equal(r.problems[0]!.code, 'FETCH_FAILED', name)
    assert.equal(r.problems[0]!.op, 1, name)
    assert.match(r.problems[0]!.message, /Roboto Slab/, name)
    assert.deepEqual(await fontsDir(dir), [], name)
  }
})

test('a request that never answers is FETCH_FAILED once the timeout passes', async () => {
  const { dir, doc } = await site()
  fake.fail('/css2', 'slow')
  const r = await fetchFor(dir, doc, set(slab()), {
    hosts: fake.hosts,
    get: makeGet(150),
  })
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.deepEqual(await fontsDir(dir), [])
})

test('an italic the family lacks is FETCH_FAILED naming the family and status 400', async () => {
  const { dir, doc, o } = await site()
  const r = await fetchFor(
    dir,
    doc,
    set({ google: 'Mono Only', italic: true }),
    o,
  )
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.match(r.problems[0]!.message, /Mono Only/)
  assert.match(r.problems[0]!.message, /400/)
  assert.deepEqual(await fontsDir(dir), [])
})

test('a held family is not fetched again; asking 300 fetches only 300 and swaps the folder whole', async () => {
  const { dir, doc, o } = await site()
  await fetchFor(dir, doc, set(slab()), o)
  fake.hits.length = 0
  const again = await fetchFor(dir, doc, set(slab()), o)
  assert.ok(again.ok)
  assert.deepEqual(again.ops, set('up:roboto-slab'))
  assert.deepEqual(fake.hits, [])
  const more = await fetchFor(dir, doc, set(slab({ weights: [300] })), o)
  assert.ok(more.ok)
  assert.match(ofType(fake.hits, /^\/css2/)[0]!, /wght@0,300;0,400;0,700/)
  const f = checkSiteFont(
    JSON.parse(
      await readFile(join(dir, 'fonts/roboto-slab/font.json'), 'utf8'),
    ),
  )!
  assert.deepEqual(
    f.files.map(x => x.weight),
    [[300, 700]],
  )
  assert.deepEqual(await fontsDir(dir), ['roboto-slab'])
})

test('up:missing in setFonts is INVALID_OPERATION naming the {google} form; five families in one batch is RESOURCE_LIMIT_EXCEEDED', async () => {
  const { dir, doc, o } = await site()
  const r = await fetchFor(dir, doc, set('up:missing'), o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'INVALID_OPERATION')
  assert.match(r.problems[0]!.message, /\{google/)
  const five = await fetchFor(
    dir,
    doc,
    set(...['A', 'B', 'C', 'D', 'E'].map(google => ({ google }))),
    o,
  )
  assert.ok(!five.ok)
  assert.equal(five.problems[0]!.code, 'RESOURCE_LIMIT_EXCEEDED')
  assert.deepEqual(fake.hits, [])
})

test('a family name or weights that are not plain are refused before any request, and the licence falls back to Apache', async () => {
  const { dir, doc, o } = await site()
  for (const bad of [
    { google: '../x' },
    { google: 'A"b' },
    { google: 'Roboto Slab', weights: [450] },
    {
      google: 'Roboto Slab',
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900, 400],
    },
    { google: 'Roboto Slab', italic: 'yes' },
  ]) {
    const r = await fetchFor(dir, doc, set(bad), o)
    assert.ok(!r.ok, JSON.stringify(bad))
    assert.equal(r.problems[0]!.code, 'INVALID_OPERATION')
  }
  assert.deepEqual(fake.hits, [])
  const m = await fetchFor(
    dir,
    doc,
    set({ google: 'Mono Only', weights: [400] }),
    o,
  )
  assert.ok(m.ok)
  const f = checkSiteFont(
    JSON.parse(await readFile(join(dir, 'fonts/mono-only/font.json'), 'utf8')),
  )!
  assert.equal(f.licence, 'Apache-2.0')
  assert.equal(f.kind, 'mono')
})

test('a fonts folder that is a link out of the project is refused and nothing is written there', async () => {
  const { dir, doc, o } = await site()
  const out = await copyFixture('site-basic')
  await symlink(out, join(dir, 'fonts'))
  const r = await fetchFor(dir, doc, set(slab()), o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.deepEqual(
    await readdir(out).then(n => n.includes('roboto-slab')),
    false,
  )
})

test('a redirect to another host is refused on every endpoint, that host is never reached, and nothing is written', async () => {
  for (const path of [
    '/css2',
    '/gstatic',
    '/gh/ofl/robotoslab/OFL.txt',
    '/gh/ofl/robotoslab/METADATA.pb',
  ]) {
    const { dir, doc, o } = await site()
    fake.leaked.length = 0
    fake.fail(path, 'redirect')
    const r = await fetchFor(dir, doc, set(slab()), o)
    assert.ok(!r.ok, path)
    assert.equal(r.problems[0]!.code, 'FETCH_FAILED', path)
    assert.deepEqual(fake.leaked, [], path)
    assert.deepEqual(await fontsDir(dir), [], path)
  }
})

test('a fonts/<slug> that is a link is refused on write and not read as held', async () => {
  const { dir, doc, o } = await site()
  const real = await copyFixture('site-basic')
  await mkdir(join(dir, 'fonts'))
  await symlink(real, join(dir, 'fonts/roboto-slab'))
  const r = await fetchFor(dir, doc, set(slab()), o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.deepEqual(
    await readdir(real).then(n => n.includes('font.json')),
    false,
  )
  // a held font whose font.json is a link to another font's file is not held
  const { dir: d2, doc: doc2, o: o2 } = await site()
  await fetchFor(d2, doc2, set(slab()), o2)
  await fetchFor(d2, doc2, set({ google: 'Mono Only', weights: [400] }), o2)
  await rm(join(d2, 'fonts/mono-only/font.json'))
  await symlink(
    join(d2, 'fonts/roboto-slab/font.json'),
    join(d2, 'fonts/mono-only/font.json'),
  )
  assert.deepEqual(Object.keys((await readHeld(d2)).fonts), ['roboto-slab'])
})

test('a hostile font.json is not held: paths, quotes and a name that leaves the folder', async () => {
  const dir = (await site()).dir
  await mkdir(join(dir, 'fonts/evil'), { recursive: true })
  await writeFile(join(dir, 'fonts/evil/400.woff2'), 'wOF2')
  for (const bad of [
    {
      family: 'Evil',
      files: [{ weight: 400, style: 'normal', file: '../../x.woff2' }],
    },
    {
      family: 'Evil";}body{x:y',
      files: [{ weight: 400, style: 'normal', file: '400.woff2' }],
    },
    {
      family: 'Other',
      files: [{ weight: 400, style: 'normal', file: '400.woff2' }],
    },
  ]) {
    await writeFile(
      join(dir, 'fonts/evil/font.json'),
      JSON.stringify({
        kind: 'sans',
        licence: 'MIT',
        source: 'https://x.example/a',
        ...bad,
      }),
    )
    assert.deepEqual((await readHeld(dir)).fonts, {}, bad.family)
  }
})

// ---- icons ----

const T = { page: 'home' }
const addIcon = (id: string, props: object, kind = 'icon') => ({
  op: 'add',
  tree: T,
  parent: 'homeroot',
  index: 0,
  node: { id, kind, props },
})
const nested = (name: string) => ({
  op: 'add',
  tree: T,
  parent: 'homeroot',
  index: 0,
  node: {
    id: 'o1',
    kind: 'column',
    children: [
      {
        id: 'o2',
        kind: 'box',
        children: [{ id: 'o3', kind: 'icon', props: { name } }],
      },
    ],
  },
})
const svgs = async (dir: string) =>
  (
    await readdir(join(dir, 'assets/icons'), { recursive: true }).catch(
      () => [] as string[],
    )
  )
    .filter(f => f.endsWith('.svg'))
    .sort()

test('add with an icon lucide:camera nested two deep writes LICENSE then camera.svg, and the op is unchanged', async () => {
  const { dir, doc, o } = await site()
  const ops = [nested('lucide:camera')]
  const r = await fetchFor(dir, doc, ops, o)
  assert.ok(r.ok, JSON.stringify(r))
  assert.deepEqual(r.ops, ops)
  assert.deepEqual(await svgs(dir), ['lucide/camera.svg'])
  const lic = await readFile(join(dir, 'assets/icons/lucide/LICENSE'), 'utf8')
  assert.match(lic, /ISC/)
  assert.match(lic, /Lucide/)
  assert.ok(lic.includes(`Source: ${fake.hosts.icons}/lucide.json`))
  const held = (await readHeld(dir)).icons
  assert.deepEqual(Object.keys(held), ['lucide:camera'])
  assert.match(
    held['lucide:camera']!,
    /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"><g /,
  )
})

test('a button icon fa6-brands:github takes its width and height from the icon', async () => {
  const { dir, doc, o } = await site()
  const r = await fetchFor(
    dir,
    doc,
    [addIcon('b1', { label: 'x', icon: 'fa6-brands:github' }, 'button')],
    o,
  )
  assert.ok(r.ok, JSON.stringify(r))
  assert.match(
    (await readHeld(dir)).icons['fa6-brands:github']!,
    /viewBox="0 0 496 512"/,
  )
})

test('two icons of one set are one request; a held icon is not fetched again', async () => {
  const { dir, doc, o } = await site()
  const two = [
    addIcon('i1', { name: 'lucide:camera' }),
    addIcon('i2', { name: 'lucide:a1' }),
  ]
  assert.ok((await fetchFor(dir, doc, two, o)).ok)
  assert.equal(ofType(fake.hits, /^\/iconify\/lucide\.json/).length, 1)
  assert.deepEqual(await svgs(dir), ['lucide/a1.svg', 'lucide/camera.svg'])
  fake.hits.length = 0
  assert.ok((await fetchFor(dir, doc, two, o)).ok)
  assert.equal(fake.hits.length, 0)
})

test('a set licensed GPL-3.0 is POLICY_VIOLATION rule icon-licence, and nothing is written', async () => {
  const { dir, doc, o } = await site()
  const r = await fetchFor(dir, doc, [addIcon('i1', { name: 'bad:thing' })], o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'POLICY_VIOLATION')
  assert.equal(r.problems[0]!.rule, 'icon-licence')
  assert.equal(r.problems[0]!.op, 0)
  assert.deepEqual(await readdir(join(dir, 'assets')).catch(() => []), [])
  assert.equal(ofType(fake.hits, /bad\.json/).length, 0)
})

test('an alias, a missing name and each evil icon are FETCH_FAILED by name, and no svg is written', async () => {
  for (const name of [
    'lucide:photo',
    'lucide:nothing',
    'evil:script',
    'evil:onload',
    'evil:href',
    'evil:url',
    'evil:red',
  ]) {
    const { dir, doc, o } = await site()
    // a good icon in the same batch is not kept either
    const r = await fetchFor(
      dir,
      doc,
      [addIcon('g', { name: 'lucide:camera' }), addIcon('i1', { name })],
      o,
    )
    assert.ok(!r.ok, name)
    assert.equal(r.problems[0]!.code, 'FETCH_FAILED', name)
    assert.equal(r.problems[0]!.op, 1, name)
    assert.ok(r.problems[0]!.message.includes(name), name)
    assert.deepEqual(await svgs(dir), [], name)
  }
})

test('setProps name on an icon fetches; setProps name on a field does not', async () => {
  const { dir, doc: d0, o } = await site()
  const doc = structuredClone(d0)
  doc.pages[0]!.root.children!.push(
    { id: 'ic', kind: 'icon', name: 'ic', slot: {} },
    { id: 'fl', kind: 'field', name: 'fl', slot: {} },
  )
  const sp = (id: string) => ({
    op: 'setProps',
    tree: T,
    id,
    props: { name: 'lucide:camera' },
  })
  assert.ok((await fetchFor(dir, doc, [sp('fl')], o)).ok)
  assert.equal(fake.hits.length, 0)
  assert.ok((await fetchFor(dir, doc, [sp('ic')], o)).ok)
  assert.deepEqual(await svgs(dir), ['lucide/camera.svg'])
  // an icon added earlier in the same batch
  const b = await site()
  assert.ok(
    (
      await fetchFor(
        b.dir,
        b.doc,
        [addIcon('n1', {}), { ...sp('n1'), props: { name: 'lucide:a2' } }],
        b.o,
      )
    ).ok,
  )
  assert.deepEqual(await svgs(b.dir), ['lucide/a2.svg'])
})

test('a dropped connection after LICENSE leaves LICENSE and no svg; the retry writes the svg', async () => {
  const { dir, doc, o } = await site()
  fake.fail('/iconify/lucide.json', 'drop')
  const ops = [addIcon('i1', { name: 'lucide:camera' })]
  const r = await fetchFor(dir, doc, ops, o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.ok(r.problems[0]!.message.includes('lucide:camera'))
  assert.deepEqual(await svgs(dir), [])
  assert.ok(
    (await readdir(join(dir, 'assets/icons/lucide'))).includes('LICENSE'),
  )
  assert.deepEqual(Object.keys((await readHeld(dir)).icons), [])
  fake.heal()
  assert.ok((await fetchFor(dir, doc, ops, o)).ok)
  assert.deepEqual(await svgs(dir), ['lucide/camera.svg'])
  assert.deepEqual((await readdir(join(dir, 'assets/icons/lucide'))).sort(), [
    'LICENSE',
    'camera.svg',
  ])
})

test('61 icons in one batch is RESOURCE_LIMIT_EXCEEDED; 60 are fetched', async () => {
  const { dir, doc, o } = await site()
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      addIcon(`m${i}`, { name: `lucide:a${i}` }),
    )
  const r = await fetchFor(dir, doc, many(61), o)
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'RESOURCE_LIMIT_EXCEEDED')
  assert.equal(fake.hits.length, 0)
  assert.ok((await fetchFor(dir, doc, many(60), o)).ok)
  assert.equal((await svgs(dir)).length, 60)
})

test('a redirect on the iconify endpoints is refused, and an icons folder that is a link is refused', async () => {
  const a = await site()
  fake.fail('/iconify/collection', 'redirect')
  const r = await fetchFor(
    a.dir,
    a.doc,
    [addIcon('i', { name: 'lucide:camera' })],
    a.o,
  )
  assert.ok(!r.ok)
  assert.equal(r.problems[0]!.code, 'FETCH_FAILED')
  assert.equal(fake.leaked.length, 0)
  fake.heal()
  const b = await site()
  const out = join(b.dir, '..', `elsewhere-${Date.now()}`)
  await mkdir(out, { recursive: true })
  await mkdir(join(b.dir, 'assets'), { recursive: true })
  await symlink(out, join(b.dir, 'assets/icons'))
  const r2 = await fetchFor(
    b.dir,
    b.doc,
    [addIcon('i', { name: 'lucide:camera' })],
    b.o,
  )
  assert.ok(!r2.ok)
  assert.deepEqual(await readdir(out), [])
  await rm(out, { recursive: true, force: true })
})

test('a hand-written svg is held only with its LICENSE and when siteIcon accepts it', async () => {
  const { dir } = await site()
  const good =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>'
  const w = async (rel: string, text: string) => {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  await w('assets/icons/mine/ok.svg', good)
  await w('assets/icons/mine/LICENSE', 'x')
  await w('assets/icons/mine/bad.svg', good.replace('<path', '<script/><path'))
  await w('assets/icons/nolic/ok.svg', good)
  assert.deepEqual(Object.keys((await readHeld(dir)).icons), ['mine:ok'])
})

test('a weight the family lacks is skipped, not refused: Lato has no 600, Lora has no 100; the weights it has are stored', async () => {
  const lato = await site()
  const a = await fetchFor(
    lato.dir,
    lato.doc,
    set({ google: 'Lato', weights: [300, 400, 600, 700] }),
    lato.o,
  )
  assert.ok(a.ok, JSON.stringify(a))
  assert.deepEqual(a.ops, set('up:lato'))
  const fl = JSON.parse(
    await readFile(join(lato.dir, 'fonts/lato/font.json'), 'utf8'),
  )
  assert.deepEqual(
    fl.files.map((f: { weight: number }) => f.weight).sort(),
    [300, 400, 700],
  )
  const lora = await site()
  const b = await fetchFor(
    lora.dir,
    lora.doc,
    set({ google: 'Lora', weights: [100, 400, 700] }),
    lora.o,
  )
  assert.ok(b.ok, JSON.stringify(b))
  const fo = JSON.parse(
    await readFile(join(lora.dir, 'fonts/lora/font.json'), 'utf8'),
  )
  assert.deepEqual(
    fo.files.map((f: { weight: number }) => f.weight).sort(),
    [400, 700],
  )
})

test('a family with none of the weights asked is still refused', async () => {
  const s = await site()
  const r = await fetchFor(
    s.dir,
    s.doc,
    set({ google: 'Lora', weights: [100, 200] }),
    s.o,
  )
  assert.equal(r.ok, false)
})
