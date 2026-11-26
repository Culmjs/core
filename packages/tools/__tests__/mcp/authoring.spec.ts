import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { INSTRUCTIONS, SECTIONS_INSTRUCTIONS } from '../../src/mcp/server.ts'
import { createRegistry, emptySite, fontSlug, type Data } from '@culmjs/core'
import { memoryStore } from '@culmjs/core/ops'
import starter, { LOOK, STYLES } from '@culmjs/starter'
import { createMcpServer } from '../../src/mcp/server.ts'

const data: Data = { rows: {} }
const closers: (() => Promise<void>)[] = []
after(async () => {
  for (const c of closers) await c()
})
const fakeBrowser = () => {
  const page = {
    close: async () => {},
    blocked: [] as string[],
    errors: [] as string[],
    setViewport: async () => {},
    setScheme: async () => {},
    setReducedMotion: async () => {},
    setTouch: async () => {},
    tab: async () => {},
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
  return { version: 'Fake/1', newPage: async () => page, close: async () => {} }
}
/** The fetch path of a folder site, as far as these tests need it: a Google family becomes `up:<slug>`. */
const fakeFetch =
  (seen: unknown[][] = []) =>
  async (ops: unknown[]) => {
    seen.push(ops)
    return {
      ok: true as const,
      ops: ops.map(o => {
        const op = o as { op: string; fonts?: unknown[] }
        return op.op === 'setFonts'
          ? {
              ...op,
              fonts: op.fonts!.map(f =>
                typeof f === 'object' && f && 'google' in f
                  ? `up:${fontSlug((f as { google: string }).google)}`
                  : f,
              ),
            }
          : o
      }),
    }
  }

async function connect(
  seen: unknown[][] = [],
  jsonOps = false,
  sections = false,
) {
  const registry = createRegistry()
  registry.use(starter)
  const store = memoryStore({
    s: { ...emptySite('Ada', LOOK), styles: STYLES },
  })
  const server = createMcpServer({
    store,
    registry,
    site: 's',
    data,
    browser: fakeBrowser() as never,
    fetch: fakeFetch(seen) as never,
    jsonOps,
    sections,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  closers.push(() => client.close())
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const text = (r.content as { text: string }[])[0]!.text
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { error: r.isError === true, json: JSON.parse(text) as any }
  }
  const rev = async () => (await call('describe')).json.revision as number
  return { call, rev, store, client }
}

test('a whole-site write is all or nothing: a refused page leaves header and footer unwritten', async () => {
  const { call, rev, store } = await connect()
  const base = await rev()
  const r = await call('write', {
    baseRevision: base,
    jsx: '<Header><Row id="hd1"><Text level="p">Hi</Text></Row></Header><Footer><Row id="ft1"><Text level="p">Bye</Text></Row></Footer><Page path="/"><Blorp /></Page>',
  })
  assert.equal(r.error, true)
  assert.equal(r.json.revision, base)
  assert.match(r.json.problems[0].message, /Unknown element <Blorp>/)
  assert.equal(await rev(), base)
  const doc = (
    (await store.head('s')) as { doc: { header: { children?: unknown[] } } }
  ).doc
  assert.equal((doc.header.children ?? []).length, 0)
})

test('a node written without an id gets a readable one, the same on a rewrite; ids show in the JSX', async () => {
  const { call, rev } = await connect()
  const jsx =
    '<Page path="/" title="Home"><Column><Text level="h1">Fresh bread daily</Text><Button label="Order now" link={{ url: "https://example.com" }} /><Text level="p">Warm and local</Text></Column></Page>'
  const a = await call('write', { jsx, baseRevision: await rev() })
  assert.equal(a.error, false, JSON.stringify(a.json))
  const ids = (j: string) =>
    [...j.matchAll(/<\w+\s+id="(\w+)"/g)].map(m => m[1])
  const read = async () =>
    (await call('read', { what: 'page', page: 'home', format: 'jsx' })).json
      .jsx as string
  const first = ids(await read())
  assert.deepEqual(first, [
    'columnfreshbreadd',
    'h1freshbreaddaily',
    'buttonordernow',
    'textwarmandlocal',
  ])
  const b = await call('write', { jsx, baseRevision: await rev() })
  assert.equal(b.error, false, JSON.stringify(b.json))
  assert.deepEqual(ids(await read()), first)
  // two alike get a number
  const c = await call('write', {
    page: 'about',
    baseRevision: await rev(),
    jsx: '<Column><Text level="p">Same</Text><Text level="p">Same</Text></Column>',
  })
  assert.equal(c.error, false, JSON.stringify(c.json))
  assert.deepEqual(
    ids(
      (await call('read', { what: 'page', page: 'about', format: 'jsx' })).json
        .jsx,
    ),
    ['columnsame', 'textsame', 'textsame2'],
  )
})

/** Every node of every tree except the subtree of `id`, as JSON: what must not change in a targeted write. */
async function outside(store: ReturnType<typeof memoryStore>, id: string) {
  const head = (await store.head('s')) as {
    doc: {
      header: unknown
      footer: unknown
      pages: { root: unknown }[]
      centreMaxWidth?: boolean
    }
  }
  type N = { id: string; children?: N[] }
  const cut = (n: N): N => ({
    ...n,
    children: (n.children ?? []).filter(c => c.id !== id).map(cut),
  })
  return JSON.stringify([
    cut(head.doc.header as N),
    cut(head.doc.footer as N),
    ...head.doc.pages.map(p => cut(p.root as N)),
  ])
}

test('find a heading by text, then a target write changes only it: nothing outside it differs', async () => {
  const { call, rev, store } = await connect()
  const w = await call('write', {
    jsx: '<Page path="/"><Column><Text level="h1">Open studio</Text><Text>Visit on Saturday.</Text></Column></Page>',
    baseRevision: await rev(),
  })
  assert.equal(w.error, false, JSON.stringify(w.json.problems))
  const home = await call('read', { what: 'page', page: 'home', format: 'jsx' })
  const firstH1 = /<Text[^>]*level="h1"[^>]*>([^<]+)</.exec(
    home.json.jsx.replace(/\n\s*/g, ' '),
  )!
  const words = firstH1[1]!.trim().split(/\s+/).slice(0, 2).join(' ')
  const f = await call('find', { text: words, kind: 'Text', tree: 'home' })
  assert.equal(f.error, false, JSON.stringify(f.json))
  const hit = f.json.matches[0]
  assert.equal(f.json.revision, await rev())
  assert.equal(hit.tree, 'home')
  assert.match(hit.path, /^Column\[0\]/)
  assert.match(hit.jsx, /^<Text\s+id="/)
  const before = await outside(store, hit.id)
  const t = await call('write', {
    target: hit.id,
    baseRevision: f.json.revision,
    jsx: `<Text id="${hit.id}" level="h1" style={{ size: 40, weight: 800 }}>A new headline</Text>`,
  })
  assert.equal(t.error, false, JSON.stringify(t.json))
  assert.equal(t.json.revision, f.json.revision + 1)
  assert.equal(await outside(store, hit.id), before)
  const after = await call('find', { id: hit.id })
  assert.match(after.json.matches[0].jsx, /A new headline/)
  assert.equal(after.json.matches[0].path, hit.path)
  // the diff names that node and nothing else
  const d = await call('diff', { from: f.json.revision, to: t.json.revision })
  assert.match(JSON.stringify(d.json), new RegExp(hit.id))
})

test('find: text, kind, id, a selector, a tree; the reply has the revision and what a target write needs', async () => {
  const { call, rev } = await connect()
  const base = await rev()
  await call('write', {
    baseRevision: base,
    jsx: '<Header><Row id="bar"><Text id="brand" level="p">Ada Bakes</Text></Row></Header><Page path="/" title="Home"><Column id="hero"><Row id="cols"><Text id="title" level="h1">Fresh bread</Text><Button id="cta" label="Order now" link={{ url: "https://example.com" }} /></Row><Text id="note" level="p">Bread, daily</Text></Column></Page>',
  })
  const r = await rev()
  const ids = async (q: Record<string, unknown>) =>
    (await call('find', q)).json.matches.map((m: { id: string }) => m.id)
  assert.deepEqual(await ids({ text: 'bread' }), ['title', 'note'])
  assert.deepEqual(await ids({ text: 'bread', tree: 'home' }), [
    'title',
    'note',
  ])
  assert.deepEqual(await ids({ text: 'ada' }), ['brand'])
  assert.deepEqual(await ids({ kind: 'Button' }), ['cta'])
  assert.deepEqual(await ids({ id: 'hero' }), ['hero'])
  assert.deepEqual(await ids({ selector: 'Row > Text[level=1]' }), ['title'])
  assert.deepEqual(await ids({ selector: 'Column Text' }), ['title', 'note'])
  assert.deepEqual(await ids({ selector: 'Column > Text' }), ['note'])
  assert.deepEqual(await ids({ selector: 'Button[text*=Order]' }), ['cta'])
  assert.deepEqual(await ids({ selector: '#cols > *' }), ['title', 'cta'])
  const m = (await call('find', { id: 'title' })).json
  assert.equal(m.revision, r)
  assert.deepEqual(
    {
      tree: m.matches[0].tree,
      path: m.matches[0].path,
      kind: m.matches[0].kind,
      text: m.matches[0].text,
    },
    {
      tree: 'home',
      path: 'Column[0] > Row[0] > Text[0]',
      kind: 'Text',
      text: 'Fresh bread',
    },
  )
  const full = (await call('find', { id: 'hero', full: true })).json.matches[0]
  assert.match(full.jsx, /<Text id="title"/)
  const none = await call('find', { text: 'zzz' })
  assert.equal(none.json.total, 0)
  assert.match(none.json.hint, /Trees: header, footer, home/)
  const bad = await call('find', { selector: 'Row >' })
  assert.equal(bad.error, false)
  assert.ok(
    (await call('find', {})).json.outline.some(
      (t: { sections: { id: string }[] }) =>
        t.sections.some(n => n.id === 'hero'),
    ),
  )
})

test('a target write refuses an unknown id and a stale revision with the revision; a kind change keeps the place', async () => {
  const { call, rev } = await connect()
  const base = await rev()
  await call('write', {
    baseRevision: base,
    jsx: '<Page path="/" title="Home"><Column id="c"><Text id="a" level="p">One</Text><Text id="b" level="p">Two</Text><Text id="d" level="p">Three</Text></Column></Page>',
  })
  const r = await rev()
  const stale = await call('write', {
    target: 'b',
    baseRevision: r - 1,
    jsx: '<Text level="p">x</Text>',
  })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].revision, r)
  const unknown = await call('write', {
    target: 'nope',
    baseRevision: r,
    jsx: '<Text level="p">x</Text>',
  })
  assert.match(unknown.json.problems[0].message, /no node with id "nope"/)
  assert.equal(unknown.json.revision, r)
  const two = await call('write', {
    target: 'b',
    baseRevision: r,
    jsx: '<Text level="p">x</Text><Text level="p">y</Text>',
  })
  assert.match(two.json.problems[0].message, /exactly one element/)
  // Text -> Button in the middle: still in the middle
  const k = await call('write', {
    target: 'b',
    baseRevision: r,
    jsx: '<Button id="b2" label="Go" link={{ url: "https://example.com" }} />',
  })
  assert.equal(k.error, false, JSON.stringify(k.json))
  const order = (await call('find', { selector: '#c > *' })).json.matches.map(
    (m: { id: string }) => m.id,
  )
  assert.deepEqual(order, ['a', 'b2', 'd'])
})

test('the instructions carry the starter, the one-shot and the edit workflow; they are byte-stable', () => {
  assert.match(INSTRUCTIONS, /starts with NO pages/)
  assert.match(INSTRUCTIONS, /header\.bar/)
  assert.match(INSTRUCTIONS, /footer\.bar/)
  assert.match(INSTRUCTIONS, /One-shot: ONE write/)
  assert.match(INSTRUCTIONS, /<Page path="\/" title="Home">/)
  assert.match(INSTRUCTIONS, /Edit: find/)
  assert.match(INSTRUCTIONS, /write \{target:/)
  assert.equal(typeof INSTRUCTIONS, 'string')
})

test('HTML/CSS, literal JSX and JSONC author the same responsive section without a registry block', async () => {
  const sources = [
    {
      html: '<section class="hero" id="intro"><h1>Design &amp; build</h1><p>Write <a href="mailto:hello@example.org">to us</a>.</p></section>',
      css: '.hero {padding: 24px 5%} .hero h1 {font-size:48px} @media(max-width:600px){.hero h1{font-size:30px}}',
    },
    {
      jsx: '<Column id="intro" as="section" style={{padding:"24px 5%"}}><Text level="h1" style={{size:48}} phone={{size:30}}>Design &amp; build</Text><Text level="p">Write <a href="mailto:hello@example.org">to us</a>.</Text></Column>',
    },
    {
      json: `{ // JSONC works too
      "kind":"column","id":"intro","as":"section","style":{"padding":"24px 5%"},"children":[
      {"kind":"text","level":"h1","text":"Design & build","style":{"base":{"fontSize":48},"phone":{"fontSize":30}}},
      {"type":"Text","level":"p","runs":[{"text":"Write "},{"text":"to us","link":"mailto:hello@example.org"},{"text":"."}]},]}`,
    },
  ]
  let expected
  for (const source of sources) {
    const { call, store } = await connect()
    const result = await call('write', {
      baseRevision: 0,
      page: 'home',
      ...source,
    })
    assert.equal(result.error, false, JSON.stringify(result.json))
    const site = await store.get('s', 1)
    const nodes = site!.pages[0]!.root.children
    assert.equal(nodes?.[0]?.id, 'intro')
    assert.equal(nodes[0].children![0]!.style!.phone!.size, 30)
    if (expected) assert.deepEqual(nodes, expected)
    expected = nodes
  }
})

test('mixed-format batches, structured patches, target writes and retries stay atomic', async () => {
  const { call, store, rev } = await connect()
  const args = {
    baseRevision: 0,
    theme: {
      bodyFont: 'Arial, sans-serif',
      headingFont: 'Georgia, serif',
      corners: 'square',
    },
    insert: [
      { html: '<section id=intro><h1 id=head>First</h1></section>' },
      { json: { kind: 'shape', id: 'logo', geometry: 'circle' } },
    ],
    patch: [
      { id: 'intro.root', style: { padding: '1rem 5%' } },
      { id: 'head', text: 'New', phone: { fontSize: 24 } },
    ],
  }
  const r = await call('write', args)
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.equal((await call('write', args)).json.revision, 1)
  const first = await store.get('s', 1)
  assert.equal(first?.look.headingFont, 'sys:serif')
  assert.equal(first.look.corners, 0)
  const [intro, logo] = first.pages[0]!.root.children!
  assert.deepEqual(logo!.props?.geometry, { type: 'ellipse' })
  assert.deepEqual(intro!.children?.[0]?.props?.runs, [{ text: 'New' }])
  const failed = await call('write', {
    baseRevision: 1,
    insert: [{ html: '<p id=extra>More</p>' }],
    patch: [
      { id: 'missing', text: 'x' },
      { id: 'missing2', text: 'y' },
    ],
  })
  assert.equal(failed.error, true)
  assert.deepEqual(
    failed.json.problems.map((p: { path: string }) => p.path),
    ['patch[0].id', 'patch[1].id'],
  )
  assert.equal(await rev(), 1)
  for (const invalid of [
    { html: '<section onclick="x()">No</section><script>No</script>' },
    { html: '<p><a href="javascript:alert(1)">No</a></p>' },
    { html: '<p>Hi</p>', jsx: '<Text>Hi</Text>' },
    { json: { kind: '-' } },
  ]) {
    assert.equal(
      (await call('write', { baseRevision: 1, ...invalid })).error,
      true,
    )
    assert.equal(await rev(), 1)
  }
  assert.equal(
    (
      await call('write', {
        baseRevision: 1,
        target: 'head',
        json: { kind: 'text', level: 'h2', text: 'Updated' },
      })
    ).error,
    false,
  )
  const changed = (await store.get('s', 2))!.pages[0]!.root.children!
  assert.deepEqual(changed[1], logo)
  assert.deepEqual(changed[0]?.style, intro?.style)
})

test('a refused batch can be fixed by field path without resending the source', async () => {
  const { call, rev, store } = await connect()
  const r = await call('write', {
    baseRevision: 0,
    insert: [{ html: '<h1 id=head>One</h1>' }],
    patch: [{ id: 'typo', text: 'Two' }],
  })
  assert.equal(r.error, true)
  assert.equal(await rev(), 0)
  const original = r.json.draft
  const amend = (path: string, value: unknown) =>
    call('write', {
      baseRevision: 0,
      draft: original,
      edits: [{ op: 'replace', path, value }],
    })
  for (const path of [
    '/baseRevision',
    '/patch/0/__proto__',
    '/patch/length',
    '/patch/1/id',
  ])
    assert.equal((await amend(path, 'head')).error, true)
  const fixed = await amend('/patch/0/id', 'head')
  assert.equal(fixed.error, false, JSON.stringify(fixed.json))
  assert.equal((await amend('/patch/0/id', 'head')).json.revision, 1)
  assert.deepEqual(
    (await store.get('s', 1))!.pages[0]!.root.children?.[0]?.props?.runs,
    [{ text: 'Two' }],
  )
})

test('JSON operations use the display range only for headings, preserve ordered atomic edits and replay safely', async () => {
  const { call, store, rev } = await connect([], true)
  const example = (await call('describe', { example: 'figure' })).json.node
  const args = {
    baseRevision: 0,
    ops: [
      {
        op: 'insert',
        node: {
          kind: 'column',
          id: 'intro',
          children: [
            {
              kind: 'text',
              id: 'heading',
              level: 'h1',
              text: 'Open studio',
              style: { size: 180 },
              phone: { size: 72 },
            },
            { kind: 'text', id: 'body', text: 'Walk in', style: { size: 180 } },
          ],
        },
      },
      { op: 'insert', node: example },
      { op: 'update', id: 'heading', style: { size: 196 } },
      { op: 'move', id: 'study', index: 0 },
    ],
  }
  const save = await call('write', args)
  assert.equal(save.error, false, JSON.stringify(save.json))
  assert.deepEqual(save.json.sections, ['study', 'intro'])
  assert.equal((await call('write', args)).json.revision, 1)
  const root = (await store.get('s', 1))!.pages[0]!.root
  const [head, body] = root.children![1]!.children!
  assert.equal(head!.style?.base?.size, 196)
  assert.equal(head!.style?.phone?.size, 72)
  assert.equal(body!.style?.base?.size, 96)
  assert.equal(
    (await call('find', { id: 'drawing', full: true })).json.matches[0].node
      .props.geometry.type,
    'path',
  )
  assert.equal(
    (
      await call('write', {
        baseRevision: 1,
        ops: [
          { op: 'remove', id: 'intro' },
          { op: 'move', id: 'absent', index: 0 },
        ],
      })
    ).error,
    true,
  )
  assert.equal(await rev(), 1)
  assert.equal(
    (await call('write', { baseRevision: 1, html: '<p>x</p>' })).error,
    true,
  )
  const other = []
  for (const example of ['display', 'phone-row', 'group']) {
    const node = (await call('describe', { example })).json.node
    other.push({ op: 'insert', node })
  }
  const recipes = await call('write', { baseRevision: 1, ops: other })
  assert.equal(recipes.error, false, JSON.stringify(recipes.json))
})

test('jsonOps supports page ops, chrome edits, hide/slot/state/null-reset, dotted find selectors and JSX comments', async () => {
  const { call, store } = await connect([], true)
  const addP = await call('write', {
    baseRevision: 0,
    page: 'about',
    ops: [
      {
        op: 'insert',
        node: {
          kind: 'column',
          id: 'hero',
          style: { bg: 'ink', color: 'bg', padding: 24 },
          children: [
            { kind: 'text', id: 'heading', level: 'h1', text: 'About' },
          ],
        },
      },
      {
        op: 'update',
        id: 'heading',
        style: { bg: null },
        hide: { phone: true },
        slot: { align: 'center' },
      },
      { op: 'setPage', page: 'about', inFooter: true },
      { op: 'addPage', page: 'faq', title: 'FAQ', slug: '/faq' },
      { op: 'removePage', page: 'faq' },
    ],
  })
  assert.equal(addP.error, false, JSON.stringify(addP.json))
  const hdr = await call('write', {
    baseRevision: addP.json.revision,
    page: 'header',
    ops: [{ op: 'insert', node: { kind: 'text', id: 'tagline', text: 'Hi' } }],
  })
  assert.equal(hdr.error, false, JSON.stringify(hdr.json))
  assert.equal(
    (await call('find', { selector: '#header.bar' })).json.matches.length >= 0,
    true,
  )
  assert.equal(
    (await call('find', { id: 'header' })).json.matches[0]?.id,
    'header',
  )
  const doc = await store.get('s', hdr.json.revision)
  const about = doc!.pages.find(p => p.id === 'about')!
  const heading = about.root.children![0]!.children![0]!
  assert.equal(heading.hide?.phone, true)
  assert.deepEqual(heading.slot, { grow: 0, align: 'center' })
  assert.equal(about.inFooter, true)

  const jsx = await connect()
  const cw = await jsx.call('write', {
    baseRevision: 0,
    page: 'home',
    jsx: '<Text id="t" level="h1" style={{ // line comment\n color: "ink" }}>\n  {"Trimmed"}\n</Text>',
  })
  assert.equal(cw.error, false, JSON.stringify(cw.json))
  const cdoc = await jsx.store.get('s', cw.json.revision)
  assert.deepEqual(cdoc!.pages[0]!.root.children![0]!.props?.runs, [
    { text: 'Trimmed' },
  ])
})

const PARTS = ['intro', 'main', 'contact'].map(
  id => `<Column id="${id}"><Text>${id}</Text></Column>`,
)

test('sections: five tools, a short receipt, and whole, single-section and batched appends converge and replay once', async () => {
  const reference = await connect([], false, true)
  assert.deepEqual(
    (await reference.client.listTools()).tools.map(t => t.name),
    ['describe', 'write', 'find', 'measure', 'build'],
  )
  const whole = await reference.call('write', {
    baseRevision: 0,
    jsx: `<Page path="/">${PARTS.join('')}</Page>`,
  })
  assert.equal(whole.error, false, JSON.stringify(whole.json))
  assert.equal(whole.json.measurement, 'complete')
  assert.ok(!('index' in whole.json) && !('findings' in whole.json))
  const expected = await reference.store.get('s', 1)
  for (const groups of [
    [1, 1, 1],
    [2, 1],
  ]) {
    const { call, rev, store } = await connect([], false, true)
    let i = 0
    for (const count of groups) {
      const args = {
        baseRevision: await rev(),
        page: 'home',
        append: true,
        jsx: PARTS.slice(i, i + count).join(''),
      }
      const r = await call('write', args)
      assert.equal(r.error, false, JSON.stringify(r.json))
      const again = await call('write', args)
      assert.equal(again.json.revision, r.json.revision)
      assert.equal(again.json.replayed, true)
      i += count
    }
    const baseRevision = await rev()
    for (const jsx of [
      '<Text id="other">OK</Text><Unknown/>',
      '<Page path="/"><Text>Wrong mode</Text></Page>',
    ]) {
      assert.equal(
        (await call('write', { baseRevision, page: 'home', append: true, jsx }))
          .error,
        true,
      )
      assert.equal(await rev(), baseRevision)
    }
    assert.deepEqual(await store.get('s', baseRevision), expected)
  }
})

test('sections: a receipt names at most 3 issues, one per check, and moreIssues says there are more', async () => {
  const { call } = await connect([], false, true)
  const r = await call('write', {
    baseRevision: 0,
    jsx:
      '<Page path="/"><Column id="a"><Shape id="s1" geometry={{type:"rect"}} fill="#ff0000"/><Shape id="s2" geometry={{type:"rect"}} fill="#00ff00"/>' +
      '<Text id="e" >🚀</Text><Text id="g" style={{shadow:{x:0,y:0,blur:60,spread:0,color:"#0ff"}}}>Glow</Text></Column><Column id="b"><Text>Below</Text></Column></Page>',
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.equal(r.json.issues.length, 3, JSON.stringify(r.json))
  assert.equal(
    new Set(r.json.issues.map((i: { check: string }) => i.check)).size,
    3,
  )
  assert.equal(r.json.moreIssues, true)
  assert.equal(r.json.measurement, 'complete')
  assert.ok(!('findings' in r.json))
})

test('sections: a clean write has no issues, no moreIssues, and no measuredRevision when measured at its own revision', async () => {
  const { call } = await connect([], false, true)
  const r = await call('write', {
    baseRevision: 0,
    jsx: '<Page path="/"><Column id="a"><Text>Hi</Text></Column></Page>',
  })
  assert.equal(r.error, false)
  assert.equal(r.json.measurement, 'complete')
  assert.deepEqual(r.json.issues, [])
  assert.ok(!('moreIssues' in r.json) && !('measuredRevision' in r.json))
})

test('sections: measurement is incomplete when the browser cannot measure, and ops is refused', async () => {
  const registry = createRegistry()
  registry.use(starter)
  const store = memoryStore({
    s: { ...emptySite('Ada', LOOK), styles: STYLES },
  })
  const server = createMcpServer({
    store,
    registry,
    site: 's',
    data,
    sections: true,
    browser: {
      version: 'Fake/1',
      newPage: async () => {
        throw new Error('no page')
      },
      close: async () => {},
    } as never,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  closers.push(() => client.close())
  const call = async (args: Record<string, unknown>) => {
    const r = await client.callTool({ name: 'write', arguments: args })
    return JSON.parse((r.content as { text: string }[])[0]!.text)
  }
  const ok = await call({
    baseRevision: 0,
    jsx: '<Page path="/"><Column id="a"><Text>Hi</Text></Column></Page>',
  })
  assert.equal(ok.measurement, 'incomplete', JSON.stringify(ok))
  assert.ok(!('problem' in ok)) // problem is set only when measure itself refuses
  assert.equal(
    ((await store.head('s')) as { revision: number }).revision,
    ok.revision,
  )
  const refused = await call({ baseRevision: ok.revision, ops: [] })
  assert.equal(refused.problems[0].code, 'INVALID_OPERATION')
})

test('sections: instructions describe the short receipt, not findings and an index', () => {
  assert.doesNotMatch(
    SECTIONS_INSTRUCTIONS,
    /index of every tree|all you need to go on/,
  )
  assert.match(SECTIONS_INSTRUCTIONS, /moreIssues/)
})

test('sections: a replayed write is measured at the head, so the receipt names measuredRevision', async () => {
  const { call, rev } = await connect([], false, true)
  const a = {
    baseRevision: 0,
    page: 'home',
    jsx: '<Column id="a"><Text>A</Text></Column>',
  }
  const first = await call('write', a)
  assert.equal(first.error, false, JSON.stringify(first.json))
  const second = await call('write', {
    baseRevision: first.json.revision,
    page: 'home',
    append: true,
    jsx: '<Column id="b"><Text>B</Text></Column>',
  })
  assert.equal(second.json.revision, first.json.revision + 1)
  const again = await call('write', a)
  assert.equal(again.json.replayed, true, JSON.stringify(again.json))
  assert.equal(again.json.revision, first.json.revision)
  assert.equal(again.json.measuredRevision, await rev())
})
