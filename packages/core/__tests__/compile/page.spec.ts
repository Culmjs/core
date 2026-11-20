import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUDGETS,
  compilePage,
  compileSubtree,
} from '../../src/compile/index.ts'
import { byteLength } from '../../src/compile/budgets.ts'
import type { CompileOptions } from '../../src/compile/index.ts'
import type { KindSpec, Node, SiteDocument } from '../../src/document/index.ts'
import {
  applySetting,
  createRegistry,
  insertBlock,
} from '../../src/registry/index.ts'
import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
} from '../../src/scripts/index.ts'
import {
  DEMO_PLUGIN,
  node,
  projectsList,
  sampleRegistry,
  siteWith,
  siteWithProjectsList,
  stateful,
  text,
} from '../kit.ts'

const registry = sampleRegistry()
const compile = (
  doc: SiteDocument,
  more: Partial<CompileOptions> = {},
  pageId = 'home',
) => compilePage(doc, pageId, { registry, ...more })
/** The compiled page, failing the test with its problems when it did not compile. */
const page = (doc: SiteDocument, more: Partial<CompileOptions> = {}) => {
  const r = compile(doc, more)
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  return r
}
const noScripts = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, '')
const rows = (...titles: string[]) => ({
  rows: { projects: titles.map(title => ({ title })) },
})
const scriptOf = (html: string) => /<script>([\s\S]*)<\/script>/.exec(html)?.[1]

// ---- the document ----

test('a plain page is one HTML document with its content, and ships the base script only', () => {
  const r = page(siteWith([text('t', 'Hello')]))
  assert.match(r.html, /^<!doctype html><html lang="en">/)
  assert.ok(r.html.includes('Hello'))
  assert.deepEqual(
    r.scripts.map(s => s.name),
    ['base'],
  )
  assert.deepEqual(r.problems, [])
  assert.ok(r.html.endsWith('</script></body></html>'))
  assert.equal(r.html.match(/<script/g)?.length, 1, 'one inline script')
  assert.ok(!/\sstyle="/.test(r.html), 'no inline styles')
  assert.ok(r.stats.bytes <= 100_000 && r.stats.styleBytes <= BUDGETS.css)
})

test('the head holds the charset, the viewport, the title and one style, and nothing else', () => {
  const r = page(siteWith([text('t', 'Hi')], { name: 'Ada', title: 'Home' }))
  const head = r.html.slice(r.html.indexOf('<head>'), r.html.indexOf('</head>'))
  assert.ok(
    head.startsWith('<head><meta charset="utf-8"><meta name="viewport"'),
  )
  assert.ok(head.includes('<title>Home · Ada</title>'))
  assert.equal(head.match(/<style>/g)?.length, 1)
  assert.equal(head.match(/<(?!\/?(?:head|meta|title|style)[ >])[a-z]+/g), null)
  assert.ok(head.includes(':where(*,*::before,*::after)'), 'the base rules')
  assert.ok(head.includes('.s-site{--s-brand:'), 'the look')
})

test('the site wrapper holds header, page and footer in that order, with the classes the styles select on', () => {
  const doc = siteWith([text('t', 'Body')], {
    header: node('hd', 'row', [text('hx', 'Nav')]),
    footer: node('ft', 'row', [text('fx', 'Foot')]),
  })
  const html = page(doc).html
  assert.match(html, /<body><div class="s-site s-scheme-auto s-site--live">/)
  const at = (s: string) => html.indexOf(s)
  assert.ok(
    at('<header class="s-header">') < at('Nav') &&
      at('Nav') < at('<main>') &&
      at('<main>') < at('Body') &&
      at('Body') < at('<footer class="s-footer">') &&
      at('<footer class="s-footer">') < at('Foot'),
  )
  assert.match(
    page({ ...doc, look: { ...doc.look, dark: 'dark' } }).html,
    /class="s-site s-scheme-dark s-site--live"/,
  )
  assert.match(
    page(doc, { mode: 'edit' }).html,
    /<div class="s-site s-scheme-auto">/,
    'no live class in edit mode',
  )
})

test('an empty or hidden header renders no strip; one with a child does; the editor keeps both', () => {
  const none = siteWith([text('t', 'x')])
  assert.ok(!page(none).html.includes('<header'))
  assert.ok(!page(none).html.includes('<footer'))
  const hidden = siteWith([text('t', 'x')], {
    header: {
      ...node('hd', 'row', [text('hx', 'Nav')]),
      style: { base: { hidden: true } },
    },
  })
  assert.ok(!page(hidden).html.includes('<header'))
  const shown = siteWith([text('t', 'x')], {
    header: node('hd', 'row', [text('hx', 'Nav')]),
  })
  assert.match(page(shown).html, /<header class="s-header"/)
  const edit = page(none, { mode: 'edit' }).html
  assert.ok(
    edit.includes('<header class="s-header"') &&
      edit.includes('<footer class="s-footer"'),
  )
})

test('the content is in the HTML with the script removed', () => {
  const r = page(siteWithProjectsList(), { data: rows('Alpha', 'Beta') })
  const body = noScripts(r.html)
  assert.ok(body.includes('Alpha') && body.includes('Beta'))
})

test('a page may be compiled by id although it is off', () => {
  const doc = siteWith([text('t', 'Hidden page')])
  doc.pages[0].on = false
  const r = page(doc, { mode: 'edit' })
  assert.ok(r.html.includes('data-id="homeroot"'))
})

test('a right-to-left language sets dir on the html element and in the styles', () => {
  const doc = siteWith([text('t', 'x')], {
    languages: [{ code: 'en' }, { code: 'fa', dir: 'rtl' }],
  })
  assert.match(
    page(doc, { lang: 'fa' }).html,
    /^<!doctype html><html lang="fa" dir="rtl">/,
  )
  assert.match(
    page(doc).html,
    /^<!doctype html><html lang="en">/,
    'the first language is the default',
  )
  assert.match(page(doc, { lang: 'en' }).html, /<html lang="en">/)
})

test('the same input compiles to the same bytes twice', () => {
  const doc = siteWithProjectsList({
    header: node('hd', 'row', [stateful('hs')]),
  })
  const a = compile(doc, { data: rows('A', 'B') })
  const b = compile(doc, { data: rows('A', 'B') })
  assert.deepEqual(a, b)
})

// ---- scripts ----

test('a page with a declared state ships base and states, in that order, in one script', () => {
  const r = page(siteWith([stateful()]))
  assert.deepEqual(
    r.scripts.map(s => s.name),
    ['base', 'states'],
  )
  assert.equal(r.scripts[0].code, BASE_SCRIPT)
  assert.equal(r.scripts[1].code, STATES_SCRIPT)
  const code = scriptOf(r.html)!
  assert.ok(code.startsWith(BASE_SCRIPT) && code.endsWith(STATES_SCRIPT))
  assert.ok(code.indexOf(BASE_SCRIPT) < code.indexOf(STATES_SCRIPT))
})

test('a state in the header or footer alone adds the states script', () => {
  for (const where of ['header', 'footer'] as const) {
    const r = page(siteWith([text('t', 'x')], { [where]: stateful('s') }))
    assert.deepEqual(
      r.scripts.map(s => s.name),
      ['base', 'states'],
      where,
    )
  }
})

test('a page with no states has no states script, nor does one that only opens a layer', () => {
  assert.ok(
    !scriptOf(page(siteWith([text('t', 'x')])).html)!.includes(STATES_SCRIPT),
  )
  const dlg = node('dlg', 'box')
  dlg.props = { layer: 'dialog' }
  const open = node('op', 'button')
  open.props = { label: 'Open' }
  open.on = [{ on: 'click', do: { open: 'dlg' } }]
  assert.deepEqual(
    page(siteWith([dlg, open])).scripts.map(s => s.name),
    ['base'],
  )
})

test('a trigger other than open or close adds the states script, with no state declared', () => {
  const go = node('go', 'button')
  go.props = { label: 'Go', link: { url: 'https://x.org' } }
  go.on = [{ on: 'click', do: { goTo: { url: 'https://x.org/t' } } }]
  assert.deepEqual(
    page(siteWith([go])).scripts.map(s => s.name),
    ['base', 'states'],
  )
})

test('a loose trigger entry cannot crash the compile', () => {
  const loose = text('t', 'Hi', { on: [null, 3, { on: 'click' }] as never })
  const r = compile(siteWith([loose]))
  assert.equal(typeof r.ok, 'boolean')
})

const openPopover = (id = 'pop'): Node => {
  const close = node(`${id}x`, 'button')
  close.props = { label: 'Close', command: 'hide-popover', opens: id }
  const pop = node(id, 'box', [text(`${id}t`, 'Inside'), close])
  pop.props = { layer: 'popover-manual', open: true }
  return pop
}

test('a popover marked open at load adds the open snippet to the base script', () => {
  const r = page(siteWith([openPopover()]))
  assert.equal(r.scripts[0].code, BASE_SCRIPT + OPEN_SCRIPT)
  const plain = openPopover('pop2')
  plain.props = { layer: 'popover-manual' }
  assert.equal(page(siteWith([plain])).scripts[0].code, BASE_SCRIPT)
})

const mail = (id = 'm'): Node =>
  text(id, '', {
    props: {
      level: 'p',
      runs: [{ text: 'ada@lab.example', link: { email: 'ada@lab.example' } }],
    },
  })
const mailButton: Node = node('mb', 'button')
mailButton.props = { label: 'Write to me', link: { email: 'ada@lab.example' } }

test('a hidden address: no mailto and no address in the HTML, the words read user [at] domain, the script is on the page', () => {
  const r = page(siteWith([mail(), mailButton]))
  assert.ok(!noScripts(r.html).includes('mailto:'))
  assert.ok(!r.html.includes('ada@lab.example'))
  assert.match(
    r.html,
    /<a[^>]*href="#"[^>]*data-u="ada"[^>]*data-d="lab.example"[^>]*>ada \[at\] lab.example<\/a>/,
  )
  assert.match(r.html, /<a[^>]*data-u="ada"[^>]*>Write to me<\/a>/)
  assert.equal(r.scripts[0].code, BASE_SCRIPT + EMAIL_SCRIPT)
  assert.ok(r.html.includes(EMAIL_SCRIPT))
})

test('a page with no email address has no email script and keeps its markup whole', () => {
  const r = page(siteWith([text('t', 'x')]))
  assert.ok(!r.html.includes(EMAIL_SCRIPT))
  assert.ok(r.html.endsWith('</body></html>'))
})

test('owner text that looks like a script marker stays text, and the email script still follows it', () => {
  const html = page(
    siteWith([mail()], { name: 'before /*@email*/ after' }),
  ).html
  assert.ok(html.includes('before /*@email*/ after'))
  assert.ok(html.indexOf(EMAIL_SCRIPT) > html.indexOf('before /*@email*/'))
})

test('on the first touch of a hidden address the link becomes mailto: and the words the address', () => {
  const handlers: Record<string, (e: unknown) => void> = {}
  const attrs: Record<string, string> = { href: '#' }
  const a = {
    dataset: { u: 'ada', d: 'lab.example' },
    textContent: 'ada [at] lab.example',
    getAttribute: (k: string) => attrs[k],
    set href(v: string) {
      attrs.href = v
    },
  }
  const target = { closest: (q: string) => (q === '[data-u]' ? a : null) }
  new Function('document', EMAIL_SCRIPT)({
    addEventListener: (t: string, f: (e: unknown) => void) => {
      handlers[t] = f
    },
  })
  assert.deepEqual(Object.keys(handlers).sort(), [
    'click',
    'focusin',
    'keydown',
    'pointerdown',
  ])
  handlers.pointerdown({ target })
  assert.equal(attrs.href, 'mailto:ada@lab.example')
  assert.equal(a.textContent, 'ada@lab.example')
})

test('every script that can share one page stays under the ceilings, and the email script is at most 300 bytes', () => {
  const all = BASE_SCRIPT + OPEN_SCRIPT + EMAIL_SCRIPT
  assert.ok(byteLength(all) <= BUDGETS.baseScript, String(byteLength(all)))
  assert.ok(byteLength(STATES_SCRIPT) <= BUDGETS.statesScript)
  assert.ok(byteLength(all + STATES_SCRIPT) <= BUDGETS.sharedScripts)
  assert.ok(byteLength(EMAIL_SCRIPT) <= 300, String(byteLength(EMAIL_SCRIPT)))
  const r = page(siteWith([openPopover(), mail(), stateful()]))
  assert.deepEqual(r.problems, [])
  // the reported bytes are the written bytes: base and states together are the script element's content, joiner included
  assert.equal(
    r.stats.scriptBytes.base + r.stats.scriptBytes.states,
    byteLength(r.scripts.map(s => s.code).join(';')),
  )
  assert.equal(r.stats.scriptBytes.base, byteLength(all) + 1)
})

// ---- edit mode ----

test('edit mode ships no script and marks every node', () => {
  const doc = siteWith([text('t', 'Hello'), stateful()])
  const r = page(doc, { mode: 'edit' })
  assert.deepEqual(r.scripts, [])
  assert.ok(!r.html.includes('<script'))
  for (const id of ['homeroot', 't', 'tabs', 'tabsgo'])
    assert.ok(r.html.includes(`data-id="${id}"`), id)
  assert.ok(
    !page(doc).html.includes('data-id='),
    'the live page carries no node ids',
  )
  assert.deepEqual(r.stats.scriptBytes, { base: 0, states: 0 })
})

// ---- states and triggers ----

const stateRoot = (kids: Node[]): Node => ({
  ...node('tabs', 'box', kids),
  state: [
    { name: 'tab', values: ['talks', 'papers'], initial: 'talks' },
    { name: 'menu', values: 'on-off', initial: 'off' },
  ],
})
const goBtn = (on: unknown): Node => {
  const b = node('go', 'button')
  b.props = { label: 'Papers', link: { url: 'https://x.org/p' } }
  b.on = on as Node['on']
  return b
}

test('without script the initial value shows, and the link still works', () => {
  const html = page(
    siteWith([
      stateRoot([goBtn([{ on: 'click', do: { set: 'tab', to: 'papers' } }])]),
    ]),
  ).html
  assert.match(html, /<div[^>]*data-s-tab="talks"/)
  assert.match(html, /data-s-menu="off"/)
  assert.match(html, /<a [^>]*href="https:\/\/x\.org\/p"/)
})

test('triggers write data-s-on as event:verb:arg[:value]', () => {
  const html = page(
    siteWith([
      stateRoot([
        goBtn([
          { on: 'click', do: { set: 'tab', to: 'papers' } },
          { on: 'hover', do: { toggle: 'menu' } },
          { on: 'enter-view', do: { scrollTo: 'go' } },
          { on: 'click', do: { goTo: { url: 'https://x.org/t' } } },
        ]),
      ]),
    ]),
  ).html
  const m = html.match(/data-s-on="([^"]*)"/)
  assert.ok(m, html)
  assert.deepEqual(m[1].split(' '), [
    'click:set:tab:papers',
    'hover:toggle:menu',
    'enter-view:scrollTo:w-go',
    'click:goTo:https%3A%2F%2Fx.org%2Ft',
  ])
})

test("a click that opens a dialog uses the browser's own command attributes", () => {
  const dlg = node('dlg', 'box')
  dlg.props = { layer: 'dialog' }
  const open = node('op', 'button')
  open.props = { label: 'Open' }
  open.on = [{ on: 'click', do: { open: 'dlg' } }]
  const html = page(siteWith([stateRoot([dlg, open])])).html
  assert.match(html, /<button[^>]*command="show-modal"/)
  assert.match(html, /<button[^>]*commandfor="w-dlg"/)
  assert.ok(!html.includes('data-s-on="'), 'no script needed')
})

test('a state name that could break out of an attribute is refused', () => {
  const bad = stateRoot([])
  bad.state = [{ name: 'x" onload="y', values: ['a', 'b'], initial: 'a' }]
  const r = compile(siteWith([bad]))
  assert.ok(
    !r.ok && r.problems[0].path === 'state',
    'validation refuses it, so no attribute can be written',
  )
})

test('a reserved state name is refused', () => {
  const bad = stateRoot([])
  bad.state = [
    { name: 'open', values: ['a', 'b'], initial: 'a' },
    { name: 'tab', values: ['a', 'b'], initial: 'a' },
  ]
  const r = compile(siteWith([bad]))
  assert.ok(!r.ok && r.problems[0].path === 'state')
  bad.state = [{ name: 'tab', values: ['a', 'b'], initial: 'a' }]
  assert.match(page(siteWith([bad])).html, /data-s-tab="a"/)
})

test('a header switch sets a state the header, page and footer react to, written once on the site wrapper', () => {
  const react = (id: string): Node =>
    text(id, id, {
      style: {
        when: [{ state: 'mode', is: 'dark', decl: { color: 'brand' } }],
      },
    })
  const sw = node('sw', 'button')
  sw.props = { label: 'Dark', link: { url: 'https://x.org' } }
  sw.on = [{ on: 'click', do: { set: 'mode', to: 'dark' } }]
  const header: Node = {
    ...node('hd', 'row', [sw, react('hr')]),
    state: [{ name: 'mode', values: ['light', 'dark'], initial: 'light' }],
  }
  const footer = node('ft', 'row', [react('fr')])
  const root = react('pr')
  const doc = siteWith([root], { header, footer })
  doc.pages[0].root.state = [{ name: 'pg', values: ['a', 'b'], initial: 'b' }]
  const html = page(doc).html
  const body = html.slice(html.indexOf('</style>'))
  assert.equal(body.match(/data-s-mode=/g)?.length, 1, 'one holder')
  assert.match(html, /<div class="s-site[^"]*"[^>]*data-s-mode="light"/)
  assert.ok(
    !/<div class="s-site[^"]*"[^>]*data-s-pg/.test(html),
    'the page state stays on the page root',
  )
  assert.match(html, /<div class="c[0-9a-z]+"[^>]*data-s-pg="b"/)
  assert.match(html, /click:set:mode:dark/)
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'))
  assert.ok(
    (css.match(/data-s-mode="dark"/g) ?? []).length >= 2,
    'the classes react',
  )
})

// ---- tabs ----

const tabBtn = (id: string, v: string): Node => {
  const b = node(id, 'button')
  b.props = { label: v, tabs: 'tab' }
  b.on = [{ on: 'click', do: { set: 'tab', to: v } }]
  return b
}
const tabPanel = (id: string, v: string): Node => ({
  ...node(id, 'box', [text(`${id}t`, v)]),
  props: { tabs: 'panel' },
  style: {
    base: { hidden: true },
    when: [{ state: 'tab', is: v, decl: { hidden: false } }],
  },
})
const tabList = (): Node => ({
  ...node('tl', 'row', [tabBtn('b1', 'talks'), tabBtn('b2', 'papers')]),
  props: { tabs: 'list' },
})

test('tabs are announced as tabs: roles, selection and the ids that tie tab and panel together', () => {
  const html = page(
    siteWith([
      stateRoot([tabList(), tabPanel('p1', 'talks'), tabPanel('p2', 'papers')]),
    ]),
  ).html
  assert.match(html, /<div[^>]*role="tablist"/)
  assert.match(
    html,
    /<button(?=[^>]*role="tab")(?=[^>]*id="w-b1")(?=[^>]*aria-selected="true")(?=[^>]*aria-controls="w-p1")/,
  )
  assert.match(
    html,
    /<button(?=[^>]*id="w-b2")(?=[^>]*aria-selected="false")(?=[^>]*aria-controls="w-p2")/,
  )
  assert.match(
    html,
    /<div(?=[^>]*role="tabpanel")(?=[^>]*id="w-p1")(?=[^>]*aria-labelledby="w-b1")/,
  )
  assert.match(
    html,
    /<div(?=[^>]*role="tabpanel")(?=[^>]*id="w-p2")(?=[^>]*aria-labelledby="w-b2")/,
  )
  const loose = compile(siteWith([stateRoot([tabBtn('b1', 'talks')])]))
  assert.equal(loose.ok, false, 'a tab with no list around it is refused')
})

const tabBlock = (id: string): Node => ({
  ...node(id, 'column', [
    {
      ...node(`${id}l`, 'row', [
        tabBtn(`${id}b1`, 'a'),
        tabBtn(`${id}b2`, 'z'),
      ]),
      props: { tabs: 'list' },
    },
    tabPanel(`${id}p1`, 'a'),
    tabPanel(`${id}p2`, 'z'),
  ]),
  state: [{ name: 'tab', values: ['a', 'z'], initial: 'a' }],
})
const tied = (html: string, tabs: number) => {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))
  const refs = [
    ...html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g),
  ].map(m => m[1])
  assert.equal((html.match(/role="tab"/g) ?? []).length, tabs)
  assert.equal(refs.length, tabs * 2)
  assert.ok(
    refs.every(r => ids.has(r)),
    html,
  )
}

test('tabs inside a repeat get aria ids that resolve', () => {
  const list: Node = {
    ...node('tabsl', 'list', [tabBlock('it')]),
    repeat: { source: 'projects' },
  }
  tied(page(siteWith([list]), { data: rows('A', 'B') }).html, 4)
})

test('tabs inside a component used twice get aria ids that resolve', () => {
  const inst = (id: string): Node => ({
    id,
    kind: 'instance',
    name: id,
    slot: {},
    component: 'tabs',
  })
  const doc = siteWith([inst('u1'), inst('u2')], {
    components: [
      {
        id: 'tabs',
        name: 'Tabs',
        root: tabBlock('m'),
        props: [],
        variants: [],
      },
    ],
  })
  tied(page(doc).html, 4)
})

// ---- stats and ceilings ----

test('stats match the output', () => {
  const r = page(siteWith([text('t', 'Hello'), stateful()]))
  assert.equal(r.stats.bytes, byteLength(r.html))
  assert.equal(r.stats.styleBytes, byteLength(r.css))
  assert.equal(r.scripts.length, 2)
  assert.equal(r.stats.scriptBytes.states, byteLength(STATES_SCRIPT))
  assert.equal(
    r.stats.scriptBytes.base + r.stats.scriptBytes.states,
    byteLength(r.scripts.map(s => s.code).join(';')),
  )
  assert.ok(
    r.html.includes(`>${r.scripts.map(s => s.code).join(';')}</script>`),
  )
  const base = page(siteWith([text('t', 'Hello')]))
  assert.equal(base.scripts.length, 1)
  assert.equal(base.stats.scriptBytes.base, byteLength(base.scripts[0].code))
  assert.ok(r.css.length > 0 && r.html.includes(r.css))
  assert.equal(page(siteWith([text('t', 'Hello')])).stats.scriptBytes.states, 0)
})

test('elements and depth count the expanded tree, nested repeats included', () => {
  const inner = projectsList('in')
  const outer = projectsList('out')
  outer.children![0].children!.push(inner)
  const r = page(siteWith([outer]), { data: rows('A', 'B', 'C') })
  const body = r.html.slice(
    r.html.indexOf('<body>') + 6,
    r.html.indexOf('</body>'),
  )
  assert.equal(r.stats.elements, body.match(/<[a-zA-Z][^>]*>/g)!.length)
  assert.ok(r.stats.elements >= 25, `got ${r.stats.elements}`)
  assert.ok(r.stats.depth >= 5, `depth ${r.stats.depth}`)
})

test('a page over a ceiling still compiles and reports RESOURCE_LIMIT_EXCEEDED', () => {
  const many = Array.from({ length: 900 }, (_, i) =>
    node(`n${i}`, 'column', undefined),
  ).map((n, i) => ({
    ...n,
    style: { base: { width: { n: i + 1, unit: 'px' as const } } },
  }))
  const r = page(siteWith(many))
  assert.ok(r.stats.styleBytes > BUDGETS.css, String(r.stats.styleBytes))
  assert.equal(r.problems[0].code, 'RESOURCE_LIMIT_EXCEEDED')
  assert.equal(r.problems[0].path, 'css')
})

test('a list past the node limit stops there and reports it, in bounded time', () => {
  const big = Array.from({ length: 10_000 }, (_, i) => ({ title: `P${i}` }))
  const outer = projectsList('out')
  outer.repeat!.max = 200
  const inner = projectsList('in')
  inner.repeat!.max = 200
  outer.children![0].children!.push(inner)
  const t0 = Date.now()
  const r = page(siteWith([outer]), { data: { rows: { projects: big } } })
  assert.ok(Date.now() - t0 < 5000)
  // the cut and the ceiling are one cause: reported once
  assert.equal(
    r.problems.filter(
      p => p.code === 'RESOURCE_LIMIT_EXCEEDED' && p.path === 'elements',
    ).length,
    1,
  )
  assert.ok(r.stats.elements <= BUDGETS.elements + 10)
})

// ---- refusals ----

test('an invalid document, an unknown page, and rows that break the source schema compile nothing', () => {
  const bad = compile(siteWith([node('x', 'frame')]))
  const unknown = compile(siteWith([text('t', 'x')]), {}, 'nope')
  const rowsBad = compile(siteWithProjectsList(), {
    data: { rows: { projects: [{ title: 3 } as never] } },
  })
  const notList = compile(siteWithProjectsList(), {
    data: { rows: { projects: 'x' as never } },
  })
  for (const r of [bad, unknown, rowsBad, notList]) {
    assert.equal(r.ok, false)
    assert.ok(!r.ok && r.problems.length > 0)
  }
  assert.equal(!unknown.ok && unknown.problems[0].code, 'INVALID_DOCUMENT')
  assert.ok(!rowsBad.ok && rowsBad.problems[0].path?.startsWith('projects'))
})

test('a font address that is not a plain path or address is refused', () => {
  for (const fontBase of [
    '/_fonts);x{}',
    '</style>',
    '/a b',
    "/a'b",
    'javascript:x',
    '//host/f',
    '/a;b',
    '/a\\b',
  ])
    assert.deepEqual(
      compile(siteWith([text('t', 'x')]), { fontBase }).ok,
      false,
      fontBase,
    )
  for (const fontBase of [
    '/_fonts',
    'https://cdn.example.org/fonts',
    '/a/b-c_d.e',
  ])
    assert.ok(compile(siteWith([text('t', 'x')]), { fontBase }).ok, fontBase)
})

test('a mode that is not live or edit is refused, by every entry point', () => {
  const doc = siteWith([text('t', 'x')])
  for (const mode of ['foo', '', 3, null])
    for (const r of [
      compile(doc, { mode: mode as never }),
      compileSubtree(doc, 'home', 't', { registry, mode: mode as never }),
    ]) {
      assert.equal(r.ok, false, String(mode))
      assert.ok(!r.ok && r.problems.some(p => p.path === 'mode'))
    }
  for (const mode of ['live', 'edit'] as const)
    assert.ok(compile(doc, { mode }).ok, mode)
})

test('input that is not a document returns problems and does not throw', () => {
  for (const doc of [null, 7, {}, { pages: 3 }])
    assert.equal(compile(doc as never).ok, false)
})

test('a throw inside the compile steps becomes a problem naming the page', () => {
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
  reg.use({ ...DEMO_PLUGIN, kinds: { boom: boom } })
  const r = compilePage(siteWith([node('b', 'boom')]), 'home', {
    registry: reg,
  })
  assert.equal(r.ok, false)
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, 'INVALID_DOCUMENT')
  assert.ok(r.problems[0].message.includes('home'))
})

test('a free slot that is not a finite row is refused, not thrown', () => {
  const far = text('a', 'a', { slot: { x: 0, y: Infinity, w: 24, h: 2, z: 0 } })
  const free = { ...node('fr', 'free', [far]) }
  const r = compile(siteWith([free]))
  assert.equal(r.ok, false)
})

// ---- hostile text ----

test('hostile text in the site name, page title, a row and a setting cannot open a tag', () => {
  const evil = '</title></style></script><script>window.x=1</script>'
  const inserted = insertBlock(registry, 'demo', 'default', 'abc')
  assert.ok(inserted.ok)
  const set = applySetting(registry, inserted.root, 'heading', evil)
  assert.ok(set.ok)
  const doc = siteWithProjectsList({ name: evil, title: evil })
  doc.pages[0].root.children!.push(set.root)
  const r = page(doc, { data: rows(evil) })
  assert.ok(
    (r.html.match(/&lt;\/script&gt;/g)?.length ?? 0) >= 4,
    'written as text in each place',
  )
  assert.equal(r.html.match(/<script>/g)?.length, 1)
  assert.ok(!r.html.includes('window.x=1</script><'))
  assert.ok(!r.html.includes('<script>window.x'))
  assert.equal(r.html.match(/<\/script>/g)?.length, 1)
  assert.equal(r.html.match(/<\/style>/g)?.length, 1)
  assert.equal(r.html.match(/<\/title>/g)?.length, 1)
  assert.ok(r.html.includes('&lt;/title&gt;&lt;/style&gt;'))
})

// ---- untouched sample content ----

test('a published page leaves out an untouched sample text, header and footer included; the editor keeps it', () => {
  const sample = (id: string, words: string) =>
    text(id, words, {
      props: { level: 'p', runs: [{ text: words }], sample: true },
    })
  const doc = siteWith([
    node('blk', 'column', [
      text('own', 'Mine'),
      sample('s1', 'Write a quote.'),
    ]),
  ])
  doc.header = node('header', 'column', [
    text('hown', 'Menu'),
    sample('s2', 'Write a tagline.'),
  ])
  doc.footer = node('footer', 'column', [
    text('fown', 'Foot'),
    sample('s3', 'Write a note.'),
  ])
  const live = page(doc).html
  for (const w of ['Mine', 'Menu', 'Foot']) assert.ok(live.includes(w), w)
  for (const w of ['Write a quote.', 'Write a tagline.', 'Write a note.'])
    assert.ok(!live.includes(w), w)
  const edit = page(doc, { mode: 'edit' }).html
  for (const w of ['Write a quote.', 'Write a tagline.', 'Write a note.'])
    assert.ok(edit.includes(w), w)
})

test("words set through a setting are the owner's and are written in live and edit mode", () => {
  const inserted = insertBlock(registry, 'demo', 'default', 'abc')
  assert.ok(inserted.ok)
  const fresh = siteWith([inserted.root])
  assert.ok(page(fresh, { mode: 'edit' }).html.includes('Old'))
  assert.ok(
    !page(fresh).html.includes('Old'),
    'the untouched sample is not published',
  )
  const set = applySetting(registry, inserted.root, 'heading', 'Selected work')
  assert.ok(set.ok)
  for (const mode of ['live', 'edit'] as const)
    assert.ok(
      page(siteWith([set.root]), { mode }).html.includes('Selected work'),
      mode,
    )
})

// ---- words set on a component use are the owner's ----

const hours: SiteDocument['components'][number] = {
  id: 'c1',
  name: 'Hours',
  root: node('m', 'column', [
    text('title', 'Office hours', {
      props: { level: 'h2', runs: [{ text: 'Office hours' }], chrome: true },
    }),
    text('times', 'Write the days and times.', {
      props: {
        level: 'p',
        runs: [{ text: 'Write the days and times.' }],
        sample: true,
      },
    }),
  ]),
  props: [
    {
      key: 't',
      label: 'Times',
      type: 'text',
      part: 'times',
      field: 'text',
      default: 'Write the days and times.',
    },
  ],
  variants: [],
}
const use = (more: Partial<Node> = {}): Node => ({
  ...node('u1', 'instance'),
  component: 'c1',
  ...more,
})
const withUse = (n: Node, c = hours) =>
  siteWith([node('root2', 'column', [n])], { components: [c] })

test('words an override, a property or a variant sets on a component use are written in a live page; an untouched use shows nothing', () => {
  const words = (n: Node, c?: typeof hours) => page(withUse(n, c)).html
  assert.ok(
    words(
      use({
        overrides: { times: { props: { runs: [{ text: 'Tuesdays 10-12' }] } } },
      }),
    ).includes('Tuesdays 10-12'),
  )
  assert.ok(words(use({ set: { t: 'Mondays 2-4' } })).includes('Mondays 2-4'))
  const untouched = words(use())
  assert.ok(
    !untouched.includes('Write the days and times.') &&
      !untouched.includes('Office hours'),
  )
  const variant = {
    ...hours,
    props: [
      {
        key: 'look',
        label: 'Look',
        type: 'choice' as const,
        options: ['a', 'b'],
        default: 'a',
      },
    ],
    variants: [
      {
        when: { look: 'b' },
        patch: { times: { props: { runs: [{ text: 'Fridays' }] } } },
      },
    ],
  }
  assert.ok(words(use({ set: { look: 'b' } }), variant).includes('Fridays'))
  assert.ok(!words(use({ set: { look: 'a' } }), variant).includes('Fridays'))
  // and the editor still shows the sample
  assert.ok(
    page(withUse(use()), { mode: 'edit' }).html.includes(
      'Write the days and times.',
    ),
  )
})

test('the states script ships only when a state attribute or trigger entry is written', () => {
  const names = (doc: SiteDocument) => {
    const r = page(doc)
    assert.ok(r.ok)
    return r.scripts.map(s => s.name)
  }
  const hiddenEverywhere = {
    ...stateful(),
    hide: {
      desktop: true as const,
      tablet: true as const,
      phone: true as const,
    },
  }
  // not drawn, so no attribute and no script
  const doc = siteWith([text('t', 'x'), hiddenEverywhere])
  const r = page(doc)
  assert.ok(r.ok && !r.html.includes('data-s-tab'))
  assert.deepEqual(names(doc), ['base'])
  // drawn: attribute, trigger entry and script together
  const shown = page(siteWith([text('t', 'x'), stateful()]))
  assert.ok(shown.ok)
  assert.ok(shown.html.includes('data-s-tab="talks"'))
  assert.ok(shown.html.includes('data-s-on='))
  assert.deepEqual(
    shown.scripts.map(s => s.name),
    ['base', 'states'],
  )
  // a state on the header root is written on the wrapper: the script follows what was written
  const withHeader = siteWith([text('t', 'x')])
  withHeader.header = {
    ...withHeader.header,
    state: [{ name: 'm', values: 'on-off', initial: 'off' }],
  } as never
  const h = page(withHeader)
  assert.ok(h.ok)
  assert.equal(
    h.scripts.some(s => s.name === 'states'),
    h.html.includes('data-s-m="off"'),
  )
})
