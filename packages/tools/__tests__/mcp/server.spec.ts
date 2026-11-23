import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  API_VERSION,
  FRAMEWORK_VERSION,
  MEASURE_PROFILE,
  SCHEMA_VERSION,
  defaultSiteStyles,
  walk,
  type Data,
  type Manifest,
  type Problem,
  type SiteDocument,
} from '@culmjs/core'
import { READ_CAP, memoryStore, type SiteStore } from '@culmjs/core/ops'
import {
  LOOK,
  bigPage,
  kitRegistry,
  node,
  siteWith,
  text,
  twoPages,
} from '../../../core/__tests__/kit.ts'
import { createRegistry, emptySite } from '@culmjs/core'
import starter, { LOOK as STARTER_LOOK, STYLES } from '@culmjs/starter'
import { GUIDE } from '../../../core/src/ops/guide.ts'
import { INSTRUCTIONS, createMcpServer } from '../../src/mcp/server.ts'
import { protect } from '../../src/mcp/protect.ts'

type Options = Parameters<typeof createMcpServer>[0]
const T = { page: 'home' }
const data: Data = {
  rows: {
    projects: [
      { title: 'Alpha', kind: 'a' },
      { title: 'Beta', kind: 'b' },
    ],
  },
}
const closers: (() => Promise<void>)[] = []
after(async () => {
  for (const c of closers) await c()
})

async function connect(
  doc: SiteDocument,
  more: Partial<Options> = {},
  store: SiteStore = memoryStore({ s: doc }),
) {
  const server = createMcpServer({
    store,
    registry: kitRegistry(),
    site: 's',
    data,
    ...more,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  closers.push(() => client.close())
  /** One tool call; the result is one text item of JSON within the cap. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const content = r.content as { type: string; text: string }[]
    assert.equal(content.length, 1)
    assert.equal(content[0]!.type, 'text')
    assert.ok(
      content[0]!.text.length <= READ_CAP,
      `${name}: ${content[0]!.text.length}`,
    )
    return {
      error: r.isError === true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: JSON.parse(content[0]!.text) as any,
    }
  }
  return { client, call, store }
}

/** Every reply of a paged call, following the cursor. */
async function all(
  call: Awaited<ReturnType<typeof connect>>['call'],
  name: string,
  args: Record<string, unknown>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replies: any[] = []
  for (let cursor: string | undefined; replies.length < 200;) {
    const r = await call(name, cursor ? { ...args, cursor } : args)
    assert.equal(r.error, false, JSON.stringify(r.json).slice(0, 300))
    replies.push(r.json)
    cursor = r.json.cursor
    assert.equal(r.json.cut, cursor !== undefined)
    if (!cursor) return replies
  }
  throw new Error('the cursor never ended')
}

const base = () => siteWith([text('t1', 'One')])

test('the server lists exactly eleven tools: describe, read, write, find, catalogue, plan, apply, measure, diff, restore, build', async () => {
  const { client } = await connect(base())
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name).sort(), [
    'apply',
    'build',
    'catalogue',
    'describe',
    'diff',
    'find',
    'measure',
    'plan',
    'read',
    'restore',
    'write',
  ])
  for (const n of ['plan', 'apply']) {
    const t = tools.find(x => x.name === n)!
    const p = t.inputSchema.properties as Record<string, { type: string }>
    assert.equal(p.baseRevision!.type, 'number')
    assert.equal(p.ops!.type, 'array')
    assert.notEqual(t.inputSchema.additionalProperties, false)
  }
})

test('describe reports the versions, the revision, the ceilings, READ_CAP, the required count, the text range and folder: false', async () => {
  const doc = siteWith([
    text('must', 'Keep', { required: true }),
    text('t2', 'x'),
  ])
  doc.styles = { ...defaultSiteStyles(LOOK), textRange: { min: 11, max: 96 } }
  const { call } = await connect(doc)
  const { error, json } = await call('describe')
  assert.equal(error, false)
  assert.equal(json.framework, FRAMEWORK_VERSION)
  assert.equal(json.schema, SCHEMA_VERSION)
  assert.equal(json.pluginApi, API_VERSION)
  assert.equal(json.measureProfile, MEASURE_PROFILE)
  assert.equal(json.site, 's')
  assert.equal(json.name, 'Ada')
  assert.equal(json.revision, 0)
  assert.equal(json.readCap, READ_CAP)
  assert.equal(json.ceilings.operations, 200)
  assert.equal(json.ceilings.requestChars, 1_000_000)
  assert.equal(json.ceilings.page.elements, 2000)
  assert.equal(json.required, 1)
  assert.deepEqual(json.textRange, { min: 11, max: 96 })
  assert.equal(json.folder, false)
  assert.equal(json.cut, false)
  const f = await (await connect(doc, { folder: true })).call('describe')
  assert.equal(f.json.folder, true)
})

test('folder sites pass locate, so problems carry file and line', async () => {
  const locate = <P extends Problem>(p: P): P =>
    ({ ...p, file: 'pages/home.json', line: 3 }) as P
  const { call } = await connect(base(), { folder: true, locate })
  const r = await call('plan', {
    baseRevision: 0,
    ops: [{ op: 'setText', tree: T, id: 'nope', text: 'x' }],
  })
  assert.equal(r.error, true)
  assert.equal(r.json.problems[0].file, 'pages/home.json')
  assert.equal(r.json.problems[0].line, 3)
})

test('CUJ 1, fixture form, on the memory store', async () => {
  const { call } = await connect(siteWith([]))
  const blocks = await call('catalogue', { what: 'blocks' })
  assert.equal(blocks.error, false)
  const names = JSON.stringify(blocks.json)
  assert.ok(names.includes('"stamp"') && names.includes('"demo"'))
  const detail = await call('catalogue', { what: 'blocks', id: 'demo' })
  assert.equal(detail.error, false)

  const ops = [
    {
      op: 'insertBlock',
      tree: T,
      parent: 'homeroot',
      index: 0,
      block: 'stamp',
      look: 'default',
      id: 's1',
    },
    {
      op: 'insertBlock',
      tree: T,
      parent: 'homeroot',
      index: 1,
      block: 'demo',
      look: 'default',
      id: 'd1',
    },
    { op: 'bindData', tree: T, id: 'd1.list', repeat: { source: 'projects' } },
  ]
  const planned = await call('plan', { baseRevision: 0, ops })
  assert.equal(planned.error, false, JSON.stringify(planned.json))
  assert.ok(planned.json.counts.created > 2)
  assert.equal(planned.json.revision, 0)
  const applied = await call('apply', { baseRevision: 0, key: 'k1', ops })
  assert.equal(applied.error, false, JSON.stringify(applied.json))
  assert.equal(applied.json.revision, 1)
  const ids: string[] = applied.json.roots.map((r: string) => r.split(':')[1])
  assert.ok(ids.includes('s1') && ids.includes('d1'))
  for (const id of ids) {
    const r = await call('read', { what: 'node', tree: T, id })
    assert.equal(r.error, false, `${id}: ${JSON.stringify(r.json)}`)
  }
  const second = await call('apply', {
    baseRevision: 1,
    key: 'k2',
    ops: [{ op: 'setText', tree: T, id: 'd1.title', text: 'Menu' }],
  })
  assert.equal(second.error, false, JSON.stringify(second.json))
  assert.equal(second.json.revision, 2)
})

const inst = (id: string) => ({
  id,
  kind: 'instance' as const,
  name: id,
  slot: {},
  component: 'card',
})
function cujDoc(): SiteDocument {
  const doc = twoPages([inst('i1')], [inst('i2')])
  doc.pages.push({
    ...doc.pages[1]!,
    id: 'contact',
    title: 'Contact',
    slug: '/contact',
    inMenu: false,
    root: { ...doc.pages[1]!.root, id: 'contactroot', children: [inst('i3')] },
  })
  doc.components = [
    {
      id: 'card',
      name: 'Card',
      root: node('croot', 'column', [text('ct', 'Old')]),
      props: [],
      variants: [],
    },
  ]
  return doc
}

test('CUJ 2, fixture form, on the memory store', async () => {
  const { call, store } = await connect(cujDoc())
  const ops = [
    { op: 'addPage', title: 'News', slug: '/news', page: 'news', inMenu: true },
    { op: 'setText', tree: { component: 'card' }, id: 'ct', text: 'New' },
  ]
  const first = await call('apply', { baseRevision: 0, key: 'a', ops })
  assert.equal(first.error, false, JSON.stringify(first.json))
  assert.equal(first.json.revision, 1)
  assert.deepEqual([...first.json.pages].sort(), [
    'about',
    'contact',
    'home',
    'news',
  ])

  const d = await call('diff', { from: 0, to: 1 })
  assert.equal(d.error, false)
  assert.deepEqual([...d.json.pages].sort(), [
    'about',
    'contact',
    'home',
    'news',
  ])
  assert.ok(d.json.site.some((s: string) => s.startsWith('pages')))
  const listed = new Set<string>()
  for (const t of d.json.trees)
    for (const id of [
      ...t.added,
      ...t.moved,
      ...t.changed.map((c: { id: string }) => c.id),
    ])
      listed.add(id)
  assert.equal(
    listed.size,
    first.json.counts.created + first.json.counts.changed,
  )
  assert.ok(listed.has('ct') && !listed.has('t1'))

  const late = await call('apply', {
    baseRevision: 0,
    key: 'b',
    ops: [{ op: 'setText', tree: T, id: 'i1', text: 'x' }],
  })
  assert.equal(late.error, true)
  assert.equal(late.json.problems[0].code, 'REVISION_CONFLICT')

  const head = await store.head('s')
  assert.ok(!('problems' in head) && head.revision === 1)
  const back = await call('restore', { to: 0, baseRevision: 1, key: 'r' })
  assert.equal(back.error, false, JSON.stringify(back.json))
  assert.equal(back.json.revision, 2)
  const same = await call('diff', { from: 0, to: 2 })
  assert.deepEqual(
    [same.json.site, same.json.pages, same.json.trees],
    [[], [], []],
  )
})

test('a refused batch is a result with isError, not a protocol error', async () => {
  const { call } = await connect(base())
  for (const tool of ['plan', 'apply']) {
    const r = await call(tool, {
      baseRevision: 0,
      key: 'k',
      ops: [{ op: 'setText', tree: T, id: 'nope', text: 'x' }],
    })
    assert.equal(r.error, true)
    assert.ok(Array.isArray(r.json.problems) && r.json.problems.length > 0)
    assert.deepEqual(Object.keys(r.json), ['problems'])
  }
  const stale = await call('plan', { baseRevision: 5, ops: [] })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].code, 'REVISION_CONFLICT')
  const unknown = await call('nonesuch')
  assert.equal(unknown.error, true)
})

test('ops that is not a list, and an op with no name, are refusals, not protocol errors', async () => {
  const { call } = await connect(base())
  for (const tool of ['plan', 'apply'])
    for (const ops of [
      'x',
      7,
      null,
      {},
      undefined,
      [{}],
      [null],
      [{ op: 3 }],
      [{ tree: T }],
    ]) {
      const r = await call(tool, { baseRevision: 0, key: 'k', ops })
      assert.equal(r.error, true, `${tool} ${JSON.stringify(ops)}`)
      assert.equal(r.json.problems[0].code, 'INVALID_OPERATION')
    }
  const r = await call('apply', { baseRevision: 'zero', key: 'k', ops: [] })
  assert.equal(r.error, true)
  const s = await call('restore', { to: 'x' })
  assert.equal(s.error, true)
})

test('every tool reply is within READ_CAP on a 2,000-node site, and its cursor continues it', async () => {
  const { call } = await connect(bigPage(2000))
  const site = await all(call, 'read', { what: 'site' })
  assert.ok(site.length >= 1)
  const outline = await all(call, 'read', {
    what: 'page',
    page: 'home',
    depth: 9,
  })
  assert.ok(outline.length > 1, 'the page outline is cut')
  const found = await all(call, 'read', { what: 'search', text: 'word' })
  assert.ok(found.length > 1, 'the search is cut')
  const idsOf = (rs: { rows: { id: string }[] }[]) =>
    rs.flatMap(r => r.rows.map(x => x.id))
  const walked: string[] = []
  const texts: string[] = []
  walk(bigPage(2000).pages[0]!.root, n => {
    walked.push(n.id)
    if (n.kind === 'text') texts.push(n.id)
  })
  assert.deepEqual(idsOf(found).sort(), texts.sort())
  assert.deepEqual(idsOf(outline).sort(), walked.sort())
  const node1 = await call('read', { what: 'node', tree: T, id: 'c0' })
  assert.equal(node1.error, false)
  for (const what of ['kinds', 'blocks', 'sources', 'operations'])
    await all(call, 'catalogue', { what })
  // a diff of two sizes pages all three of its parts
  const smaller = siteWith([])
  const { call: c2, store } = await connect(bigPage(2000))
  const head = await store.head('s')
  assert.ok(!('problems' in head))
  const r = await store.commit('s', {
    expected: 0,
    doc: smaller,
    key: 'x',
    request: 'x',
    result: {
      ok: true,
      revision: 1,
      created: [],
      changed: [],
      pages: [],
      notes: [],
    },
  })
  assert.ok(r.ok)
  const replies = await all(c2, 'diff', { from: 0, to: 1 })
  assert.ok(replies.length > 1)
  const removed = replies.flatMap(x =>
    x.trees.flatMap((t: { removed: string[] }) => t.removed),
  )
  assert.equal(removed.length, 1999)
  const bad = await call('read', {
    what: 'page',
    page: 'home',
    cursor: '0:1:zz',
  })
  assert.equal(bad.error, true)
})

test('apply returns counts and the created roots; diff gives every id', async () => {
  const { call } = await connect(siteWith([]))
  const ops = Array.from({ length: 12 }, (_, i) => ({
    op: 'add',
    tree: T,
    parent: 'homeroot',
    index: i,
    node: {
      id: `n${i}`,
      kind: 'column',
      children: Array.from({ length: 50 }, (_, j) => ({
        id: `n${i}x${j}`,
        kind: 'text',
        props: { level: 'p', runs: [{ text: 'w' }] },
      })),
    },
  }))
  const r = await call('apply', { baseRevision: 0, key: 'big', ops })
  assert.equal(r.error, false, JSON.stringify(r.json).slice(0, 400))
  assert.equal(r.json.revision, 1)
  assert.equal(r.json.counts.created, 12 * 51)
  assert.equal(r.json.cut, false)
  assert.equal(r.json.roots.length, 12)
  assert.deepEqual(r.json.roots[0], 'home:n0')
  assert.equal('created' in r.json, false)
  const replies = await all(call, 'diff', { from: 0, to: 1 })
  const added = replies.flatMap(x =>
    x.trees.flatMap((t: { added: string[] }) => t.added),
  )
  assert.equal(added.length, 12 * 51)
})

test('build on a host-supplied document with no build function is UNSUPPORTED_CAPABILITY', async () => {
  const { call } = await connect(base())
  const r = await call('build')
  assert.equal(r.error, true)
  assert.equal(r.json.problems[0].code, 'UNSUPPORTED_CAPABILITY')
})

test('build with a build function returns a summary of the manifest, or its problems', async () => {
  const manifest: Manifest = {
    schemaVersion: 1,
    pages: [{ id: 'home', path: 'index.html' }],
    scripts: [{ name: 'base', bytes: 900, pages: ['home'] }],
    styles: [{ name: 'home', bytes: 400, pages: ['home'] }],
  }
  const ok = await (
    await connect(base(), { build: async () => ({ ok: true, manifest }) })
  ).call('build')
  assert.equal(ok.error, false)
  assert.deepEqual(ok.json.pages, manifest.pages)
  assert.deepEqual(ok.json.scripts, manifest.scripts)
  const bad = await (
    await connect(base(), {
      build: async () => ({
        ok: false,
        problems: [{ code: 'INVALID_DOCUMENT', message: 'no' }],
      }),
    })
  ).call('build')
  assert.equal(bad.error, true)
  assert.equal(bad.json.problems[0].message, 'no')
})

test('with allow: protect, setRequired null is refused through the tool', async () => {
  const doc = siteWith([text('must', 'Keep', { required: true })])
  const { call } = await connect(doc, { allow: protect })
  const op = { op: 'setRequired', tree: T, id: 'must', required: null }
  for (const tool of ['plan', 'apply']) {
    const r = await call(tool, { baseRevision: 0, key: 'k', ops: [op] })
    assert.equal(r.error, true)
    assert.equal(r.json.problems[0].code, 'POLICY_VIOLATION')
    assert.equal(r.json.problems[0].rule, 'protected')
  }
  const open = await (
    await connect(doc)
  ).call('plan', { baseRevision: 0, ops: [op] })
  assert.equal(open.error, false)
})

test('a store that throws is a refusal result, not a protocol error', async () => {
  const store = memoryStore({ s: base() })
  const broken: SiteStore = {
    ...store,
    commit: async () => {
      throw new Error('disk full')
    },
  }
  const { call } = await connect(base(), {}, broken)
  const r = await call('apply', {
    baseRevision: 0,
    key: 'k',
    ops: [{ op: 'setText', tree: T, id: 't1', text: 'x' }],
  })
  assert.equal(r.error, true)
  assert.match(r.json.problems[0].message, /disk full/)
})

test('measure with no browser available returns MEASUREMENT_INCOMPLETE as a result', async () => {
  const { call } = await connect(base(), {
    executable: '/nonexistent/chrome-for-culm',
  })
  const r = await call('measure', {})
  assert.equal(r.error, false)
  assert.equal(r.json.cut, false)
  assert.equal(r.json.findings.length, 0)
  assert.ok(r.json.incomplete.length > 0)
  assert.equal(r.json.incomplete[0].problem.code, 'MEASUREMENT_INCOMPLETE')
  const since = await call('measure', { since: 99 })
  assert.equal(since.error, true)
  assert.equal(since.json.problems[0].code, 'UNSUPPORTED_CAPABILITY')
  const bad = await call('measure', { widths: 'wide' })
  assert.equal(bad.error, true)
})

test('inputs of the wrong type are INVALID_OPERATION, never ignored', async () => {
  const { call } = await connect(base())
  const cases: [string, Record<string, unknown>][] = [
    ['diff', { from: 'a' }],
    ['diff', { from: 0, to: 1.5 }],
    ['diff', { from: 0, cursor: 5 }],
    ['read', { what: 'site', cursor: 5 }],
    ['read', { what: 'page', page: 'home', cursor: {} }],
    ['catalogue', { what: 'kinds', cursor: 5 }],
    ['measure', { cursor: 5 }],
  ]
  for (const [tool, args] of cases) {
    const r = await call(tool, args)
    assert.equal(r.error, true, `${tool} ${JSON.stringify(args)}`)
    assert.equal(r.json.problems[0].code, 'INVALID_OPERATION')
  }
})

test('a measure cursor for a report that is no longer held is refused, and no browser is opened', async () => {
  const { call } = await connect(base(), {
    executable: '/nonexistent/chrome-for-culm',
  })
  const r = await call('measure', { cursor: '0:1:[null,null,null,null]' })
  assert.equal(r.error, true)
  assert.match(r.json.problems[0].message, /run measure again/)
})

// ---- token cuts: apply and plan replies
const blockOps = [
  ['page-header', 'bar', 'top1'],
  ['hero', 'plain', 'hero1'],
  ['card-grid', 'cards', 'grid1'],
].map(([block, look, id], index) => ({
  op: 'insertBlock',
  tree: T,
  parent: 'homeroot',
  index,
  block,
  look,
  id,
}))
function starterSite() {
  const registry = createRegistry()
  registry.use(starter)
  registry.use({
    name: 'rows',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    sources: [
      {
        name: 'menu',
        fields: { name: 'text', text: 'text', price: 'text', image: 'text' },
        sample: [],
      },
    ],
  })
  return connect(
    { ...emptySite('Ada', STARTER_LOOK), styles: STYLES },
    { registry },
  )
}

test('apply of page-header, hero and card-grid replies counts, roots ["home:<id>" x 3], pages and the hint, no created list, in at most 600 characters', async () => {
  const { call } = await starterSite()
  const r = await call('apply', { baseRevision: 0, key: 'a', ops: blockOps })
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.deepEqual(r.json.roots, ['home:top1', 'home:hero1', 'home:grid1'])
  assert.equal('created' in r.json, false)
  assert.equal(r.json.counts.created > 3, true)
  assert.deepEqual(r.json.pages, ['home'])
  assert.equal(r.json.hint, 'All ids: read, or diff(from, to).')
  const n = JSON.stringify(r.json).length
  assert.ok(n <= 600, `${n}`)
})

test('plan replies the same shape without from; a batch of 30 changes lists 20 and more: 10', async () => {
  const { call } = await starterSite()
  const p = await call('plan', { baseRevision: 0, ops: blockOps })
  assert.deepEqual(p.json.roots, ['home:top1', 'home:hero1', 'home:grid1'])
  assert.equal('from' in p.json, false)
  const adds = Array.from({ length: 30 }, (_, i) => ({
    op: 'add',
    tree: T,
    parent: 'homeroot',
    index: i,
    node: { id: `n${i}`, kind: 'column' },
  }))
  const r = await call('plan', { baseRevision: 0, ops: adds })
  assert.equal(r.json.roots.length, 20)
  assert.equal(r.json.more.roots, 10)
})

test('createdRoots lists a created node once and none of its created children', async () => {
  const { call } = await starterSite()
  const r = await call('apply', {
    baseRevision: 0,
    key: 'nest',
    ops: [
      {
        op: 'add',
        tree: T,
        parent: 'homeroot',
        index: 0,
        node: {
          id: 'outer',
          kind: 'column',
          children: [{ id: 'inner', kind: 'column' }],
        },
      },
    ],
  })
  assert.deepEqual(r.json.roots, ['home:outer'])
  assert.equal(r.json.counts.created, 2)
})

test('a cursor still pages the compact rows', async () => {
  const shapes = Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`,
    kind: 'shape',
    name: `Shape ${i}`,
    slot: {},
    // One brand stroke below the first section, so `no-accent` stays quiet and the rows are the 200 raw colours.
    props: {
      geometry: { type: 'rect' },
      fill: '#ff0000',
      ...(i === 1 ? { stroke: { color: 'brand', width: 1 } } : {}),
    },
  }))
  const page = {
    close: async () => {},
    blocked: [] as string[],
    errors: [] as string[],
    setViewport: async () => {},
    setScheme: async () => {},
    setScripts: async () => {},
    unblock: async () => {},
    answer: async () => {},
    goto: async () => ({ ok: true }),
    screenshot: async () => new Uint8Array(),
    evaluate: async (expr: string) => {
      const m = /\)\(document, window, (\d+)\)$/.exec(expr)
      if (m) return { width: +m[1]!, docWidth: +m[1]!, nodes: [], wide: [] }
      return expr.includes('fonts.ready') ? true : []
    },
  }
  const browser = {
    version: 'Fake/1',
    newPage: async () => page,
    close: async () => {},
  }
  const { call } = await connect(siteWith(shapes as never), {
    browser: browser as never,
  })
  const first = await call('measure', {})
  assert.equal(first.error, false, JSON.stringify(first.json).slice(0, 300))
  assert.equal(first.json.cut, true)
  assert.ok(first.json.cursor)
  assert.deepEqual(Object.keys(first.json.findings[0]).sort(), [
    'at',
    'check',
    'fix',
    'message',
    'nodes',
    'page',
  ])
  const rows = [...first.json.findings]
  let next = first.json
  while (next.cursor) {
    next = (await call('measure', { cursor: next.cursor })).json
    rows.push(...next.findings)
  }
  assert.equal(rows.length, 200)
})

test('the initialize result carries INSTRUCTIONS exactly', async () => {
  const { client } = await connect(siteWith([text('t', 'Hi')]))
  assert.equal(client.getInstructions(), INSTRUCTIONS)
  assert.ok(
    INSTRUCTIONS.startsWith(
      'Culm builds a site from HTML/CSS, literal JSX or JSON',
    ),
  )
  assert.ok(INSTRUCTIONS.endsWith('then move on.'))
  assert.match(
    INSTRUCTIONS,
    /\{google:"Name",weights:\[400,700\]\}.*Iconify set:name\./,
  )
})

test('INSTRUCTIONS and the last GUIDE row carry the one-pass rule', () => {
  assert.match(INSTRUCTIONS, /Fix each finding once on each node;/)
  assert.match(INSTRUCTIONS, /try the other way its fix names once/)
  const last = GUIDE.at(-1)!
  assert.match(last, /fix each finding once on each node;/)
  assert.match(last, /try the other way its fix names once, then move on\.$/)
  assert.doesNotMatch(GUIDE.join(' '), /textFill/)
  assert.match(
    GUIDE.join(' '),
    /inner column with a max width needs slot align center, or it sits at the start/,
  )
})

test('the catalogue description lists guide first', async () => {
  const { client } = await connect(siteWith([text('t', 'Hi')]))
  const t = (await client.listTools()).tools.find(x => x.name === 'catalogue')!
  assert.match(
    t.description!,
    /what: guide \| kinds \| operations \| recipes \| blocks \| sources/,
  )
  const what = (t.inputSchema.properties as { what: { enum: string[] } }).what
  assert.deepEqual(what.enum, [
    'guide',
    'kinds',
    'operations',
    'recipes',
    'blocks',
    'sources',
  ])
})
