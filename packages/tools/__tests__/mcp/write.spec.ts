import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  compileSite,
  createRegistry,
  emptySite,
  fontSlug,
  type Data,
} from '@culmjs/core'
import { memoryStore, plan } from '@culmjs/core/ops'
import starter, { LOOK, STYLES } from '@culmjs/starter'
import { createMcpServer } from '../../src/mcp/server.ts'
import { JsxError, parseJsx } from '../../src/jsx/parse.ts'

const data: Data = { rows: {} }
const closers: (() => Promise<void>)[] = []
after(async () => {
  for (const c of closers) await c()
})

type Probe = { nodes?: unknown[]; docWidth?: number }
/** A browser that measures nothing but what `probe` says. */
const fakeBrowser = (probe: Probe = {}) => {
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
      if (m)
        return {
          width: +m[1]!,
          docWidth: probe.docWidth ?? +m[1]!,
          nodes: probe.nodes ?? [],
          wide: [],
        }
      return expr.includes('fonts.ready') ? true : []
    },
  }
  return { version: 'Fake/1', newPage: async () => page, close: async () => {} }
}

async function connect(
  more: Partial<Parameters<typeof createMcpServer>[0]> = {},
  probe?: Probe,
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
    browser: fakeBrowser(probe) as never,
    ...more,
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
  // the starter's header block, so the site has a menu that must stay
  const first = await call('apply', {
    baseRevision: 0,
    key: 'setup',
    ops: [
      {
        op: 'insertBlock',
        tree: 'header',
        parent: 'header',
        index: 0,
        block: 'page-header',
        look: 'bar',
        id: 'hd',
      },
    ],
  })
  assert.equal(first.error, false, JSON.stringify(first.json))
  return { call, store, registry, revision: first.json.revision as number }
}

const HERO = `
<Column id="hero" style={{ bg: "ink", color: "bg", overflow: "clip", align: "center", padding: [96, 16, 96, 16] }} phone={{ padding: [64, 16, 64, 16] }}>
  <Shape id="glow" placement={{ mode: "behind" }} geometry={{ type: "rect", radius: 24 }} fill="brand" />
  <Row id="cols" slot={{ align: "center" }} style={{ width: "fill", maxWidth: { n: 1100, unit: "px" }, gap: 48, wrap: true, align: "center" }}>
    <Column id="copy" slot={{ grow: 1 }} style={{ gap: 20 }}>
      <Text id="title" level="h1" style={{ size: 56, weight: 800, balance: true }}>Fresh bread daily</Text>
      <Button id="cta" label="Order" link={{ url: "https://example.com" }} style={{ bg: "bg", color: "ink", radius: 999, padding: [14, 32, 14, 32] }} />
    </Column>
  </Row>
</Column>
`

test('the parser refuses an expression, a call, a spread and an unknown element, each with line and column', () => {
  const bad = (src: string, re: RegExp, line: number, col: number) => {
    try {
      parseJsx(src)
    } catch (e) {
      assert.ok(e instanceof JsxError, String(e))
      assert.match(e.message, re)
      assert.deepEqual(e.at, { line, col })
      return
    }
    assert.fail(`parsed: ${src}`)
  }
  bad('<Row>\n  <Text level={size}>x</Text>\n</Row>', /identifier/, 2, 16)
  bad('<Row gap={size + 1} />', /identifier/, 1, 11)
  bad('<Row>\n  {name()}\n</Row>', /call/, 2, 4)
  bad('<Row style={{ ...base }} />', /Spread/, 1, 15)
  bad('<Row {...props} />', /Spread/, 1, 6)
  bad('<Row>{[1, ...rest]}</Row>', /Spread/, 1, 11)
  bad('<Text>{`a ${b}`}</Text>', /Template strings/, 1, 11)
  bad('<Row style={{ a: () => 1 }} />', /starting with "\("/, 1, 18)
  bad('<Row style={{ __proto__: 1 }} />', /not an allowed key/, 1, 15)
  assert.equal(parseJsx('<Row>{/* note */}</Row>').length, 1)
})

test('write refuses a parse error and an unknown element with line, column and the element path', async () => {
  const { call, revision } = await connect()
  const one = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column>\n  <Text level={size}>x</Text>\n</Column>',
  })
  assert.equal(one.error, true)
  assert.equal(one.json.problems[0].jsx.line, 2)
  assert.equal(one.json.problems[0].jsx.column, 16)
  const two = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column>\n  <Foo />\n</Column>',
  })
  assert.equal(two.error, true)
  assert.match(two.json.problems[0].message, /Unknown element <Foo>/)
  assert.equal(two.json.problems[0].jsx.line, 2)
  assert.equal(two.json.problems[0].jsx.column, 3)
  assert.equal(two.json.problems[0].jsx.path, 'Column[0] > Foo[0]')
  // a core refusal is located in the JSX too: the second child of the Column has a style no Text takes
  const three = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column id="a">\n  <Text level="h1">ok</Text>\n  <Text level="p" sample>no</Text>\n</Column>',
  })
  assert.equal(three.error, true, JSON.stringify(three.json))
  assert.equal(three.json.problems[0].jsx.path, 'Column[0] > Text[1]')
  assert.equal(three.json.problems[0].jsx.line, 3)
})

test('write on an empty starter page builds a hero that compiles and passes plan, and replies with findings', async () => {
  const { call, store, registry, revision } = await connect()
  const r = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: HERO,
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.equal(r.json.revision, revision + 1)
  assert.equal(r.json.counts.created, 6)
  assert.ok(Array.isArray(r.json.findings))
  assert.equal(r.json.complete, true)
  const head = await store.head('s')
  assert.ok(!('problems' in head))
  const doc = (head as { doc: Parameters<typeof plan>[0] }).doc
  const root = doc.pages[0]!.root
  assert.deepEqual(
    root.children![0]!.children!.map(c => c.kind),
    ['shape', 'row'],
  )
  const kinds: string[] = []
  const walk = (n: typeof root) => {
    kinds.push(n.kind)
    n.children?.forEach(walk)
  }
  walk(root)
  for (const k of ['row', 'text', 'button', 'shape'])
    assert.ok(kinds.includes(k), k)
  const planned = plan(doc, registry, {
    site: 's',
    baseRevision: 0,
    key: 'p',
    ops: [],
  })
  assert.ok(planned.ok, JSON.stringify(planned))
  const compiled = compileSite(doc, {
    registry,
    data,
    links: undefined as never,
  })
  assert.deepEqual(compiled.problems, [])
  assert.ok(
    compiled.files
      .find(f => f.path === 'index.html')!
      .content.includes('Fresh bread daily'),
  )
})

test('a header write may keep the menu by id or drop it: the nav is not required', async () => {
  const { call, revision } = await connect()
  const jsx = (
    await call('read', { what: 'page', page: 'header', format: 'jsx' })
  ).json.jsx as string
  assert.match(jsx, /<Menu\s+id="hd\.nav"/)
  const ok = await call('write', {
    page: 'header',
    baseRevision: revision,
    jsx: jsx.replace('Site name', 'Ada Bakes'),
  })
  assert.equal(ok.error, false, JSON.stringify(ok.json))
  assert.equal(ok.json.revision, revision + 1)
  const dropped = await call('write', {
    page: 'header',
    baseRevision: revision + 1,
    jsx: '<Column id="x"><Text level="p">Only a name</Text></Column>',
  })
  assert.equal(dropped.error, false, JSON.stringify(dropped.json))
})

test('read format jsx then write with no change is no operations; so is the header', async () => {
  const { call, revision } = await connect()
  const w = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: HERO,
  })
  const n = w.json.revision as number
  for (const page of ['home', 'header', 'footer']) {
    const jsx = (await call('read', { what: 'page', page, format: 'jsx' })).json
      .jsx as string
    const back = await call('write', { page, baseRevision: n, jsx })
    assert.equal(back.error, false, `${page}: ${JSON.stringify(back.json)}`)
    assert.equal(back.json.ops, 0, page)
    assert.equal(back.json.noop, true)
    assert.equal(back.json.revision, n, page)
  }
  // and one real change is one revision with only that change
  const jsx = (
    await call('read', { what: 'page', page: 'home', format: 'jsx' })
  ).json.jsx as string
  const edit = await call('write', {
    page: 'home',
    baseRevision: n,
    jsx: jsx.replace('Fresh bread daily', 'Warm bread daily'),
  })
  assert.equal(edit.json.ops, 1)
  assert.equal(edit.json.revision, n + 1)
})

test('write returns the findings of the page, and an overflow shows up in the same reply', async () => {
  const box = (x: number, w: number) => ({ x, y: 0, w, h: 40 })
  const node = (id: string, b: ReturnType<typeof box>) => ({
    id,
    tag: 'div',
    box: b,
    visible: true,
    bg: null,
    clip: false,
    fixedOrSticky: false,
  })
  const { call, revision } = await connect(
    {},
    { nodes: [node('wrap', box(0, 100)), node('big', box(0, 300))] },
  )
  const r = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column id="wrap"><Text id="big" level="p">Wide</Text></Column>',
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  const hit = r.json.findings.find(
    (f: { check: string }) => f.check === 'overflow',
  )
  assert.ok(hit, JSON.stringify(r.json.findings))
  assert.deepEqual(hit.nodes, ['big'])
  assert.ok(hit.fix)
  // the finding names the node id and its JSX path, so a target write needs no read
  assert.deepEqual(hit.jsx, ['big = home:Column[0] > Text[0]'])
})

test('measure that cannot run is said so in the reply, and the write stays', async () => {
  const { call, revision } = await connect({
    browser: undefined,
    executable: '/nonexistent/chrome-for-culm',
  })
  const r = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column id="a"><Text level="p">Hi</Text></Column>',
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.equal(r.json.complete, false)
  assert.ok(r.json.incomplete.length > 0)
  assert.equal((await call('describe')).json.revision, revision + 1)
})

test('a stale baseRevision is refused before any fetch; a fresh one fetches the font once', async () => {
  const seen: unknown[][] = []
  const fetch = async (ops: unknown[]) => {
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
  const { call, revision } = await connect({ fetch: fetch as never })
  seen.length = 0 // the setup batch went through the fetch path too
  const jsx =
    '<Site fonts={{ heading: "google:Roboto Slab", body: "sys:sans" }} />\n<Column id="a"><Text level="h1">Hi</Text></Column>'
  const stale = await call('write', {
    page: 'home',
    baseRevision: revision - 1,
    jsx,
  })
  assert.equal(stale.error, true)
  assert.equal(stale.json.problems[0].code, 'REVISION_CONFLICT')
  assert.equal(seen.length, 0)
  const bad = await call('write', { page: 'home', baseRevision: 'x', jsx })
  assert.equal(bad.error, true)
  assert.equal(seen.length, 0)
  const ok = await call('write', { page: 'home', baseRevision: revision, jsx })
  // the fonts must not reach core as anything but what the fetch path made of them
  assert.equal(seen.length, 1)
  assert.deepEqual(
    (
      seen[0]!.find(o => (o as { op: string }).op === 'setFonts') as {
        fonts: unknown[]
      }
    ).fonts.slice(0, 2),
    [{ google: 'Roboto Slab', weights: [400, 600, 700] }, 'sys:sans'],
  )
  if (ok.error) assert.fail(JSON.stringify(ok.json))
  const again = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx,
  })
  // the same call again is replayed by its key: same revision, no second fetch beyond the offline one
  assert.equal(again.error, false, JSON.stringify(again.json))
  assert.equal(again.json.revision, ok.json.revision)
})

test('a new page id makes the page; a bad page id is refused', async () => {
  const { call, revision } = await connect()
  const r = await call('write', {
    page: 'about',
    title: 'About us',
    path: '/about',
    baseRevision: revision,
    jsx: '<Column id="a"><Text level="h1">About</Text></Column>',
  })
  assert.equal(r.error, false, JSON.stringify(r.json))
  const site = await call('read', { what: 'site' })
  assert.ok(
    site.json.rows.some(
      (x: { page?: string; slug?: string }) =>
        x.page === 'about' && x.slug === '/about',
    ),
  )
  const no = await call('write', {
    page: 'Bad Page',
    baseRevision: r.json.revision,
    jsx: '',
  })
  assert.equal(no.error, true)
})

test('an edit keeps the nodes it names by id: adds, removes and moves only what differs', async () => {
  const { call, revision } = await connect()
  const a = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column id="a"><Text id="x" level="h1">One</Text><Text id="y" level="p">Two</Text><Text id="z" level="p">Three</Text></Column>',
  })
  assert.equal(a.error, false, JSON.stringify(a.json))
  const b = await call('write', {
    page: 'home',
    baseRevision: a.json.revision,
    // z first, y gone, a new w, x unchanged
    jsx: '<Column id="a"><Text id="z" level="p">Three</Text><Text id="x" level="h1">One</Text><Text id="w" level="p">New</Text></Column>',
  })
  assert.equal(b.error, false, JSON.stringify(b.json))
  assert.equal(b.json.counts.created, 1)
  const back = (
    await call('read', { what: 'page', page: 'home', format: 'jsx' })
  ).json.jsx as string
  assert.deepEqual(
    [...back.matchAll(/<Text id="(\w+)"/g)].map(m => m[1]),
    ['z', 'x', 'w'],
  )
})

test('a header written as a left sidebar, with its menu moved into a new layout, keeps the required nav', async () => {
  const { call, store, registry, revision } = await connect()
  const jsx = `
<Column id="hd" style={{ side: 280, padding: 24, gap: 16, width: "fill" }}>
  <Text level="p" id="hd.name" style={{ size: 20, weight: 700 }}>Ada Bakes</Text>
  <Column id="hd.bar" style={{ gap: 8 }}>
    <Menu id="hd.nav" which="menu" keep style={{ direction: "column", gap: 8 }} />
  </Column>
</Column>`
  const r = await call('write', { page: 'header', baseRevision: revision, jsx })
  assert.equal(r.error, false, JSON.stringify(r.json))
  const head = await store.head('s')
  const doc = (head as { doc: Parameters<typeof plan>[0] }).doc
  const ids: string[] = []
  const walk = (n: typeof doc.header) => {
    ids.push(n.id)
    n.children?.forEach(walk)
  }
  walk(doc.header)
  assert.ok(ids.includes('hd.nav'), ids.join())
  assert.ok(!ids.includes('hd.bar'))
  const compiled = compileSite(doc, {
    registry,
    data,
    links: undefined as never,
  })
  assert.deepEqual(compiled.problems, [])
  assert.match(
    compiled.files.map(f => f.content).join('\n'),
    /min-width:901px\)\{[^}]*grid-template-columns:280px minmax\(0,1fr\)/,
  )
  // side belongs on the header's top blocks only
  const bad = await call('write', {
    page: 'home',
    baseRevision: r.json.revision,
    jsx: '<Column id="a" style={{ side: 280 }}><Text level="p">x</Text></Column>',
  })
  assert.equal(bad.error, true)
  assert.match(bad.json.problems[0].message, /Side belongs/)
})

test('a write with an unknown element is refused with its element and line:col; the other slips are warnings, not refusals', async () => {
  const { call, revision } = await connect()
  const r = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: [
      '<Column id="a">',
      '  <Foo />',
      '  <Text level="p">a</Text>',
      '</Column>',
    ].join('\n'),
  })
  assert.equal(r.error, true)
  const at = r.json.problems.map(
    (p: { jsx: { line: number; column: number; path: string } }) =>
      `${p.jsx.line}:${p.jsx.column} ${p.jsx.path}`,
  )
  assert.ok(at.includes('2:3 Column[0] > Foo[0]'), at.join(' | '))
  assert.match(r.json.problems[0].message, /Unknown element <Foo>/)
  // the refusal carries the revision
  assert.equal(r.json.revision, revision)
  const ok = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: [
      '<Column id="a">',
      '  <Text level="p" bogus="x">a</Text>',
      '  <Text level="p" style={{ letterSpacing: 5, cols: 2 }}>b</Text>',
      '</Column>',
    ].join('\n'),
  })
  assert.equal(ok.error, false, JSON.stringify(ok.json))
  const w = ok.json.warnings
    .map((x: { message: string }) => x.message)
    .join('\n')
  assert.match(w, /"bogus" is not a setting of <Text>/)
  assert.match(w, /cols is not a style/)
})

test('real refusals made fixable: <br />, a menu re-parented under a new kind, a style that is a setting, a Google font in a style', async () => {
  const { call, revision } = await connect()
  const br = await call('write', {
    page: 'home',
    baseRevision: revision,
    jsx: '<Column id="a"><Text id="t" level="p">1234 Somewhere Rd.<br />Nashville<br />US</Text></Column>',
  })
  assert.equal(br.error, false, JSON.stringify(br.json))
  const back = (
    await call('read', { what: 'page', page: 'home', format: 'jsx' })
  ).json.jsx as string
  assert.match(back, />1234 Somewhere Rd\.<br \/>Nashville<br \/>US<\/Text>/)
  const again = await call('write', {
    page: 'home',
    baseRevision: br.json.revision,
    jsx: back,
  })
  assert.equal(again.json.noop, true)
  // the bar changes kind (Row to Column) and a dotted id is written for a new node: the menu inside is moved, not lost
  const chrome = await call('write', {
    page: 'header',
    baseRevision: br.json.revision,
    jsx: '<Column id="hd"><Column id="hd.bar2"><Text level="p" id="hd.name">Hi</Text><Menu id="hd.nav" which="menu" keep /></Column></Column>',
  })
  assert.equal(chrome.error, false, JSON.stringify(chrome.json))
  // a CSS font and a setting written as a style are mapped, with a warning each
  const style = await call('write', {
    page: 'home',
    baseRevision: chrome.json.revision,
    jsx: '<Grid id="g" cols={2}><Text level="p" style={{ font: "sys:sans" }}>x</Text></Grid><Column id="c" phone={{ cols: 1 }} />',
  })
  assert.equal(style.error, false, JSON.stringify(style.json))
  assert.match(
    JSON.stringify(style.json.warnings),
    /cols is not a style of a column/,
  )
})

test('rotate compiles on a shape, box and icon with a phone layer and survives the round trip; write turns on centreMaxWidth', async () => {
  const { call, store, registry, revision } = await connect()
  const jsx = `<Column id="a">
  <Shape id="d1" geometry={{ type: "rect", radius: 8 }} fill="brand" style={{ rotate: 45, width: { n: 40, unit: "px" }, height: { n: 40, unit: "px" } }} phone={{ rotate: 0 }} />
  <Box id="d2" style={{ rotate: -30, scale: 1.1 }} tablet={{ rotate: 15 }} />
  <Icon id="d3" name="star" style={{ rotate: 90 }} />
</Column>`
  const r = await call('write', { page: 'home', baseRevision: revision, jsx })
  assert.equal(r.error, false, JSON.stringify(r.json))
  const doc = ((await store.head('s')) as { doc: Parameters<typeof plan>[0] })
    .doc
  assert.equal(doc.centreMaxWidth, true)
  const css = compileSite(doc, { registry, data, links: undefined as never })
    .files.map(f => f.content)
    .join('\n')
  assert.match(css, /rotate\(45deg\)/)
  assert.match(
    css,
    /rotate\(-30deg\)[^;}]*scale\(1\.1\)|scale\(1\.1\)[^;}]*rotate\(-30deg\)/,
  )
  assert.match(css, /rotate\(0deg\)/)
  const back = (
    await call('read', { what: 'page', page: 'home', format: 'jsx' })
  ).json.jsx as string
  assert.match(back, /rotate: 45/)
  const again = await call('write', {
    page: 'home',
    baseRevision: r.json.revision,
    jsx: back,
  })
  assert.equal(again.json.noop, true)
  const bad = await call('write', {
    page: 'home',
    baseRevision: r.json.revision,
    jsx: '<Column id="a"><Shape id="d1" geometry={{ type: "rect" }} style={{ rotate: 400 }} /></Column>',
  })
  assert.equal(bad.error, true)
  assert.match(bad.json.problems[0].message, /rotate/)
})

test('text marks, divide and toggle round-trip through JSX; two fill siblings produce a warning', async () => {
  const { call, revision } = await connect()
  const jsx = `<Column id="a">
  <Text id="t1">Hi <b>there</b> <a href="https://x.com">link</a> and <a href="/about" style={{ color: "#ff0000" }}>about</a> <span style={{ weight: 300, italic: true }}>soft</span><br />next <u>line</u> <a href="mailto:a@b.co">mail</a> <s>gone</s></Text>
  <Text id="t2"><b>Journal</b> by us</Text>
  <Text id="t3">a{" b "}{"c"}<i> d</i></Text>
  <Grid id="g" cols={2} divide><Text id="g1">x</Text><Text id="g2">y</Text></Grid>
  <Row id="r">
    <Box id="b1" style={{ width: "fill" }} />
    <Box id="b2" style={{ width: "fill" }} />
  </Row>
  <Row id="ok"><Box id="b3" style={{ width: "fill" }} /><Box id="b4" slot={{ grow: 1 }} style={{ width: "fill" }} /></Row>
  <Menu id="m" which="menu" foldOn="phone" toggle="outline" />
</Column>`
  const r = await call('write', { page: 'home', baseRevision: revision, jsx })
  assert.equal(r.error, false, JSON.stringify(r.json))
  assert.equal(r.json.warnings.length, 1)
  assert.match(r.json.warnings[0].message, /Grid cols=\{2\}/)
  assert.match(r.json.warnings[0].jsx.path, /Row\[4\]/)
  const back = (
    await call('read', { what: 'page', page: 'home', format: 'jsx' })
  ).json.jsx as string
  assert.match(back, /Hi <b>there<\/b> <a href="https:\/\/x\.com">link<\/a>/)
  assert.match(
    back,
    /<a href="\/about" style=\{\{ color: "#ff0000" \}\}>about<\/a>/,
  )
  assert.match(
    back,
    /<span style=\{\{ italic: true, weight: 300 \}\}>soft<\/span><br \/>next/,
  )
  assert.match(back, /<s>gone<\/s>/)
  const again = await call('write', {
    page: 'home',
    baseRevision: r.json.revision,
    jsx: back,
  })
  assert.equal(again.error, false, JSON.stringify(again.json))
  assert.equal(again.json.noop, true)
  assert.equal(again.json.warnings.length, 1)
})
