import assert from 'node:assert/strict'
import { test } from 'node:test'
import { count } from '../../src/document/index.ts'
import type { KindSpec, Node } from '../../src/document/index.ts'
import { writeHtml } from '../../src/compile/index.ts'
import {
  toElements,
  stateAttrs,
  triggerTargets,
} from '../../src/compile/elements.ts'
import { type ElementCtx } from '../../src/compile/elementsBase.ts'

const links = {
  page: (s: string) => s,
  file: (n: string) => `/f/${n}`,
  form: () => '/_forms',
}
const doc = { pages: [] } as ElementCtx['doc']
const base = (
  classOf: [string, string][] = [['t', 'c0']],
  mode: 'edit' | 'live' = 'live',
): ElementCtx => ({ doc, links, mode, classOf: new Map(classOf) })
const html = (
  w: Node,
  mode: 'edit' | 'live' = 'live',
  extra: Partial<ElementCtx> = {},
  classOf?: [string, string][],
) => {
  const e = toElements(w, { ...base(classOf, mode), ...extra })
  return e ? writeHtml(e) : ''
}
const n = (
  id: string,
  kind: Node['kind'],
  props?: Node['props'],
  more: Partial<Node> = {},
): Node => ({
  id,
  kind,
  name: id,
  slot: {},
  ...(props ? { props } : {}),
  ...more,
})
const text = (runs: unknown[], more: Partial<Node> = {}): Node =>
  n('t', 'text', { level: 'h2', runs } as never, more)

// ---- containers, lists, tables, edit ids, states ----

test('a List renders each child as an li; a decimal marker makes it an ol', () => {
  const kids = [0, 1, 2].map(i => n(`b${i}`, 'box'))
  const out = html(
    n('l', 'list', { marker: 'decimal', start: 4 }, { children: kids }),
  )
  assert.match(out, /^<ol/)
  assert.equal(out.match(/<li/g)?.length, 3)
  assert.equal(
    html(
      n('l', 'list', { marker: 'decimal' }, { children: [n('b~0', 'box')] }),
    ),
    '<ol><li></li></ol>',
  )
})

test('a header table puts th in its first row', () => {
  const table = n(
    'tb',
    'table',
    { header: true },
    {
      children: [
        n('r', 'table-row', undefined, { children: [n('c', 'table-cell')] }),
      ],
    },
  )
  assert.equal(html(table), '<table><tbody><tr><th></th></tr></tbody></table>')
})

test('an empty List renders nothing live and a placeholder in edit; inside a repeated row it renders nothing', () => {
  const empty = n('l', 'list', { marker: 'none' }, { children: [] })
  assert.equal(html(empty), '')
  assert.match(html(empty, 'edit'), /Nothing to show yet/)
  assert.equal(html(n('l~1', 'list', undefined, { children: [] }), 'edit'), '')
})

test("an editor placeholder keeps its node's class and id", () => {
  assert.match(
    html(n('l', 'list', { marker: 'none' }, { children: [] }), 'edit', {}, [
      ['l', 'c4'],
    ]),
    /^<p class="c4 s-placeholder" data-id="l">Nothing to show yet/,
  )
})

test('one element per node: classes, not styles; edit adds data-id', () => {
  const box = n('t', 'box')
  assert.equal(html(box), '<div class="c0"></div>')
  assert.equal(html(box, 'edit'), '<div class="c0" data-id="t"></div>')
})

test("edit mode writes data-id on every node's element; live mode writes none", () => {
  const tree = n('r', 'column', undefined, {
    children: [
      n('a', 'box', undefined, { children: [n('a1', 'divider')] }),
      n('l', 'list', undefined, {
        children: [n('i~0', 'box'), n('i~1', 'box')],
      }),
      n('t', 'table', undefined, {
        children: [
          n('r1', 'table-row', undefined, {
            children: [n('c1', 'table-cell')],
          }),
        ],
      }),
      n('f', 'free', undefined, { children: [n('s', 'box')] }),
    ],
  })
  const edit = html(tree, 'edit')
  assert.equal((edit.match(/data-id="/g) ?? []).length, count(tree))
  assert.ok(edit.includes('data-id="i~1"'))
  assert.ok(!html(tree).includes('data-id'))
})

test('a node hidden on a layout leaves a dashed note in the editor, never on the live site', () => {
  const col = (parent: Node['kind'], hide: Node['hide']) =>
    n('col', parent, undefined, {
      children: [n('pic', 'box', undefined, { name: 'Portrait', hide })],
    })
  const edit = html(col('column', { phone: true }), 'edit')
  assert.match(
    edit,
    /<div class="s-ghost" data-gh="phone"><svg[^>]*aria-hidden="true"/,
  )
  assert.match(edit, /<span data-l="phone">Portrait · hidden on phone<\/span>/)
  assert.ok(!/s-ghost[^>]*data-id/.test(edit), "it can't be picked")
  assert.ok(!html(col('column', { phone: true })).includes('s-ghost'))
  assert.match(
    html(col('column', { desktop: true }), 'edit'),
    /data-gh="desktop tablet"/,
  )
  assert.ok(!html(col('column', undefined), 'edit').includes('s-ghost'))
  assert.match(html(col('free', { phone: true }), 'edit'), /data-in="free"/)
  assert.match(
    html(col('list', { phone: true }), 'edit'),
    /<li class="s-ghost"/,
  )
  const table = n('t', 'table', undefined, {
    children: [
      n('r', 'table-row', undefined, { hide: { phone: true }, children: [] }),
    ],
  })
  assert.ok(!html(table, 'edit').includes('s-ghost'))
})

test('a node hidden on every layout is left out of the live page, kept in the editor', () => {
  const gone = n('g', 'box', undefined, {
    hide: { desktop: true, phone: true },
  })
  assert.equal(html(gone), '')
  assert.match(html(gone, 'edit'), /data-id="g"/)
})

test('an instance that survived expand writes nothing', () => {
  assert.equal(
    html(n('i', 'instance', undefined, { component: 'gone' }), 'edit'),
    '',
  )
})

test('a container with a pattern, a layer, a column span and a breadcrumb', () => {
  const pat = n('b', 'box', {
    pattern: { tile: 'dots', color: 'ink', strength: 20, cursor: 'glow' },
  })
  assert.equal(
    html(pat, 'live', {}, [['b:pattern', 'p0']]),
    '<div><div class="p0" aria-hidden="true" data-s-pattern="glow"></div></div>',
  )
  const pop = n('b', 'box', { layer: 'popover-manual', open: true })
  assert.equal(
    html(pop),
    '<div id="w-b" popover="manual" data-s-open=""></div>',
  )
  assert.equal(html(pop, 'edit'), '<div data-id="b"></div>')
  const dlg = n('b', 'box', { layer: 'dialog' })
  assert.equal(html(dlg), '<dialog id="w-b"></dialog>')
  assert.equal(html(dlg, 'edit'), '<div data-id="b"></div>')
  const cell = n('r', 'table-row', undefined, {
    children: [n('c', 'table-cell', { span: 2 })],
  })
  assert.equal(html(cell), '<tr><td colspan="2"></td></tr>')
  assert.equal(
    html(n('r', 'row', { as: 'breadcrumb' })),
    '<nav aria-label="Breadcrumb"></nav>',
  )
})

test('states and triggers write data-s attributes on live pages only; a tree that skipped the save check writes nothing odd', () => {
  const t = n('b', 'box', undefined, {
    state: [
      { name: 'tab', values: ['one', 'two'], initial: 'one' },
      { name: 'Bad Name', values: 'on-off', initial: 'on' },
    ],
    on: [
      { on: 'click', do: { set: 'tab', to: 'two' } },
      { on: 'hover', do: { goTo: { url: 'javascript:x' } } },
      { on: 'click', do: { scrollTo: 'tgt' } },
    ],
  })
  const root = n('r', 'column', undefined, { children: [t, n('tgt', 'box')] })
  assert.deepEqual(stateAttrs(t), { 'data-s-tab': 'one' })
  const live = html(root)
  assert.match(
    live,
    /<div data-s-tab="one" data-s-on="click:set:tab:two click:scrollTo:w-tgt"><\/div>/,
  )
  assert.match(live, /<div id="w-tgt"><\/div>/)
  assert.ok(!html(root, 'edit').includes('data-s-on'))
  assert.deepEqual([...triggerTargets(root).keys()], ['tgt'])
})

test('tabs: a list, its tabs and panels get role and aria attributes that pair up', () => {
  const tab = (id: string, to: string) =>
    n(
      id,
      'button',
      { tabs: 'tab', label: id },
      { on: [{ on: 'click', do: { set: 'v', to } }] },
    )
  const panel = (id: string, is: string) =>
    n(
      id,
      'box',
      { tabs: 'panel' },
      {
        style: {
          base: { hidden: true },
          when: [{ state: 'v', is, decl: { hidden: false } }],
        },
      },
    )
  const root = n('r', 'column', undefined, {
    state: [{ name: 'v', values: ['a', 'b'], initial: 'a' }],
    children: [
      n(
        'lst',
        'row',
        { tabs: 'list' },
        { children: [tab('ta', 'a'), tab('tb', 'b')] },
      ),
      panel('pa', 'a'),
      panel('pb', 'b'),
    ],
  })
  const out = html(root)
  assert.match(out, /<div role="tablist">/)
  const tag = (id: string) =>
    out.match(new RegExp(`<[a-z]+[^>]* id="w-${id}"[^>]*>`))![0]
  for (const a of [
    'role="tab"',
    'aria-selected="true"',
    'aria-controls="w-pa"',
    'type="button"',
  ])
    assert.ok(tag('ta').includes(a), a)
  for (const a of ['aria-selected="false"', 'aria-controls="w-pb"'])
    assert.ok(tag('tb').includes(a), a)
  for (const a of ['role="tabpanel"', 'aria-labelledby="w-tb"'])
    assert.ok(tag('pb').includes(a), a)
})

test('a plug-in kind is written as its tag with its class and children', () => {
  const kinds = new Map<string, KindSpec>([
    [
      'callout',
      {
        role: 'container',
        parents: 'any',
        tag: () => 'section',
        display: () => 'block',
        props: {},
        styles: [],
        states: [],
        bindable: [],
        repeatable: true,
        label: 'Callout',
        icon: 'x',
      },
    ],
  ])
  const w = n('c', 'callout', undefined, { children: [n('k', 'divider')] })
  assert.equal(
    html(w, 'live', { kinds }, [['c', 'c9']]),
    '<section class="c9"><hr></section>',
  )
  assert.equal(html(w, 'live', { kinds }, []), '<section><hr></section>')
  assert.equal(html(w), '', 'an unknown kind writes nothing')
})

test('a plug-in kind with a tag the page must not carry is written as a div', () => {
  const spec = (tag: unknown): KindSpec =>
    ({
      role: 'container',
      parents: 'any',
      tag: () => tag,
      display: () => 'block',
      props: {},
      styles: [],
      states: [],
      bindable: [],
      repeatable: true,
      label: 'X',
      icon: 'x',
    }) as unknown as KindSpec
  for (const tag of [
    undefined,
    null,
    7,
    'plaintext',
    'xmp',
    'noscript',
    'template',
    'iframe',
    'script',
    'style',
  ]) {
    const kinds = new Map([['callout', spec(tag)]])
    assert.equal(
      html(n('c', 'callout'), 'live', { kinds }, []),
      '<div></div>',
      String(tag),
    )
  }
})

// ---- text and runs ----

test('one element per text: classes, not styles; a link run is an a', () => {
  const out = html(
    text([
      { text: 'Hello ' },
      { text: 'world', link: { url: 'https://x.org' } },
    ]),
  )
  assert.equal(
    out,
    '<h2 class="c0">Hello <a href="https://x.org">world</a></h2>',
  )
  assert.ok(!out.includes('style='))
  assert.match(
    html(text([{ text: 'x' }]), 'edit'),
    /^<h2 class="c0" data-id="t">/,
  )
})

test('a run with a class of its own is a span; an external link run carries rel', () => {
  assert.equal(
    html(
      text([
        { text: 'a' },
        { text: 'b', link: { url: 'https://x.org' }, external: true },
        { text: 'c' },
      ]),
      'live',
      {},
      [
        ['t', 'c0'],
        ['t:run2', 'r2'],
      ],
    ),
    '<h2 class="c0">a<a href="https://x.org" rel="noopener nofollow ugc">b</a><span class="r2">c</span></h2>',
  )
})

test('unsafe and missing link targets are left out, not broken', () => {
  assert.equal(
    html(text([{ text: 'x', link: { url: 'javascript:alert(1)' } }])),
    '<h2 class="c0">x</h2>',
  )
})

test('a {br:true} run writes a line break', () => {
  assert.equal(
    html(text([{ text: 'a' }, { br: true }, { text: 'b' }])),
    '<h2 class="c0">a<br>b</h2>',
  )
})

test('a run that came from a field is a chip in the editor and plain on the live page', () => {
  const t = text([{ text: 'Kyoto', fromData: true }, { text: ' · March' }])
  assert.match(html(t, 'edit'), /<span class="s-field">Kyoto<\/span> · March/)
  assert.ok(!html(t).includes('s-field'))
  assert.equal(html(t), '<h2 class="c0">Kyoto · March</h2>')
})

test('a math run writes its MathML, inline or display; MathML that does not pass is not written', () => {
  const out = html(
    text([
      { text: 'a ' },
      { math: '<math><mi>x</mi></math>' },
      { math: '<math display="block"><mi>y</mi></math>' },
    ]),
  )
  assert.ok(out.includes('<span><math><mi>x</mi></math></span>'))
  assert.ok(
    out.includes('<span><math display="block"><mi>y</mi></math></span>'),
  )
  assert.ok(
    !html(text([{ math: '<math><script>x</script></math>' }])).includes(
      '<script',
    ),
  )
  assert.ok(
    !html(text([{ math: '<math onclick="x"><mi>x</mi></math>' }])).includes(
      'onclick',
    ),
  )
  assert.equal(
    html(text([{ math: '<math><mi>x</mrow></math>' }])),
    '<h2 class="c0"></h2>',
    'unbalanced',
  )
})

test('MathML text and attribute values are decoded once and escaped once', () => {
  const out = html(
    text([
      {
        math: '<math><mo>&lt;</mo><mn>&#x2212;1</mn><mo>&amp;</mo><mi mathvariant="a&quot;b">q</mi></math>',
      },
    ]),
  )
  assert.ok(
    out.includes(
      '<mo>&lt;</mo><mn>\u22121</mn><mo>&amp;</mo><mi mathvariant="a&quot;b">q</mi>',
    ),
    out,
  )
  assert.ok(!out.includes('&amp;lt;'))
  assert.equal(
    html(text([{ math: '<math><mo>&bogus;</mo></math>' }])),
    '<h2 class="c0"></h2>',
  )
})

test('a code text writes pre and code, each coloured run with its page class', () => {
  const runs = [
    { text: 'let', style: { color: '#112233' }, dark: '#aabbcc' },
    { text: ' x' },
  ]
  const w = n('t', 'text', { level: 'code', runs } as never)
  assert.equal(
    html(w, 'live', {}, [
      ['t', 'c0'],
      ['code:#112233|#aabbcc', 'k0'],
    ]),
    '<pre class="c0"><code><span class="k0">let</span> x</code></pre>',
  )
})

test('a current text is aria-current="page"', () => {
  assert.equal(
    html(n('t', 'text', { level: 'p', runs: [{ text: 'x' }], current: true })),
    '<p class="c0" aria-current="page">x</p>',
  )
})

test('text, alt, link text and a field label from hostile input come out escaped', () => {
  const evil = '</p><script>x()</script>"><img src=x onerror=y>'
  const tree = n('r', 'column', undefined, {
    children: [
      text([
        { text: evil },
        { text: evil, link: { url: 'https://x.org/"><b>' } },
      ]),
      n('i', 'image', { src: 'https://x.org/a.png', alt: evil }),
      n('f', 'field', { name: 'name', label: evil }),
      n('b', 'button', { label: evil, link: { url: 'https://x.org' } }),
    ],
  })
  const out = html(tree, 'edit')
  assert.ok(!out.includes('<script>'))
  assert.ok(!out.includes('<img src=x'))
  assert.ok(!out.includes('onerror=y>'))
  assert.ok(
    out.includes(
      '&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=y&gt;',
    ),
  )
  assert.ok(out.includes('href="https://x.org/&quot;&gt;&lt;b&gt;"'), out)
  assert.ok(out.includes('alt="&lt;/p&gt;'), 'alt is escaped')
  assert.ok(out.includes('<label data-id="f">&lt;/p&gt;'), 'label is escaped')
})

// ---- image, icon, video ----

test('an image resolves through links.file; a missing file writes nothing live and a plate in edit', () => {
  assert.equal(
    html(n('i', 'image', { assetId: 'a1', alt: 'Me' })),
    '<img src="/f/a1" alt="Me">',
  )
  const links0 = { ...links, file: () => undefined }
  const gone = n('i', 'image', { assetId: 'gone', alt: '' })
  assert.equal(html(gone, 'live', { links: links0 }), '')
  const edit = html(gone, 'edit', { links: links0 })
  assert.match(
    edit,
    /^<div class="s-placeholder s-plate" data-id="i" data-sample="image" style="[^"]+" role="img"/,
  )
  assert.match(
    edit,
    /style="display:grid;place-items:center;box-sizing:border-box"/,
  )
  assert.match(
    edit,
    /<svg[^>]*aria-hidden="true"[^>]*><rect x="6" y="9" width="36" height="30" rx="3"><\/rect><circle/,
  )
})

test('an image with a fallback and no file is a labelled span; an unsafe src is dropped', () => {
  const links0 = { ...links, file: () => undefined }
  assert.equal(
    html(n('i', 'image', { fallback: 'Logo' }), 'live', { links: links0 }),
    '<span role="img" aria-label="Logo">Logo</span>',
  )
  assert.equal(html(n('i', 'image', { src: 'javascript:x', alt: 'a' })), '')
  assert.equal(
    html(n('i', 'image', { src: 'https://x.org/a.png' })),
    '<img src="https://x.org/a.png" alt="">',
  )
})

test("an icon's svg is 1em, so the size style sizes it; its markup comes from the table", () => {
  const out = html(n('ic', 'icon', { name: 'home' }))
  assert.match(
    out,
    /^<span><svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">.+<\/svg><\/span>$/,
  )
})

test('an icon name outside the table writes no svg, not even an inherited name', () => {
  for (const name of ['nope', 'toString', '__proto__', undefined])
    assert.equal(
      html(n('ic', 'icon', { name } as never), 'edit'),
      '',
      String(name),
    )
  assert.ok(
    !html(
      n('b', 'button', {
        label: 'x',
        icon: 'constructor',
        link: { url: '/a' },
      }),
    ).includes('<svg'),
  )
})

test('new icon names write an svg', () => {
  for (const name of [
    'home',
    'lock',
    'help-circle',
    'newspaper',
    'search',
    'sun',
    'moon',
    'printer',
    'share-2',
    'eye',
    'user',
  ])
    assert.match(html(n('ic', 'icon', { name })), /<svg/, name)
})

test('a linked icon is an a named by its label; a link that points nowhere leaves a plain icon', () => {
  assert.match(
    html(n('ic', 'icon', { name: 'home', link: { url: '/a' }, label: 'Home' })),
    /^<a href="\/a" aria-label="Home"><svg/,
  )
  assert.match(
    html(n('ic', 'icon', { name: 'home', link: { url: 'javascript:x' } })),
    /^<span><svg/,
  )
})

test('a video resolves its file and poster through links.file', () => {
  assert.equal(
    html(
      n('v', 'video', {
        assetId: 'v1',
        poster: 'p1',
        controls: true,
        muted: true,
      }),
    ),
    '<video src="/f/v1" poster="/f/p1" controls="" muted="" playsinline=""></video>',
  )
  assert.equal(
    html(n('v', 'video', { assetId: 'v1' }, {})),
    '<video src="/f/v1" playsinline=""></video>',
  )
  assert.equal(html(n('v', 'video', {}), 'live'), '')
  assert.match(
    html(n('v', 'video', {}), 'edit'),
    /aria-label="Sample video, not yet chosen"/,
  )
})

// ---- button ----

const btn = (props: Node['props'], more: Partial<Node> = {}) =>
  n('b', 'button', props, more)

test('form buttons keep explicit native actions, while ordinary buttons submit', () => {
  const props: Node['props'][] = [
    { label: 'Submit' },
    { label: 'Open', command: 'show-modal', opens: 'dlg' },
    { label: 'Close', command: 'close', opens: 'dlg' },
  ]
  const form = n('fm', 'form', undefined, {
    children: props.map((p, i) => btn(p, { id: `b${i}` })),
  })
  for (const mode of ['live', 'edit'] as const) {
    const buttons = html(form, mode).match(/<button\b[^>]*>/g)!
    assert.equal(buttons.length, 3)
    assert.match(buttons[0], /type="submit"/)
    for (const b of buttons.slice(1)) assert.match(b, /type="button"/)
    assert.match(buttons[1], /commandfor="w-dlg" command="show-modal"/)
    assert.match(buttons[2], /commandfor="w-dlg" command="close"/)
    if (mode === 'edit') for (const b of buttons) assert.match(b, /disabled=""/)
  }
})

test('a popover command also writes popovertarget; a trigger that opens a layer is a native command, not data-s-on', () => {
  assert.match(
    html(btn({ label: 'x', command: 'toggle-popover', opens: 'p1' })),
    /commandfor="w-p1" command="toggle-popover" popovertarget="w-p1" popovertargetaction="toggle"/,
  )
  const root = n('r', 'column', undefined, {
    children: [
      btn({ label: 'Open' }, { on: [{ on: 'click', do: { open: 'dlg' } }] }),
      n('dlg', 'box', { layer: 'dialog' }),
    ],
  })
  const out = html(root)
  assert.match(
    out,
    /<button[^>]* commandfor="w-dlg" command="show-modal" type="button">Open<\/button>/,
  )
  assert.ok(!out.includes('data-s-on'))
})

test('a button that sets a state is a real button; one that goes to a page is a link', () => {
  assert.match(
    html(
      btn(
        { label: 'Next' },
        {
          on: [{ on: 'click', do: { set: 's', to: 'b' } }],
          state: [{ name: 's', values: ['a', 'b'], initial: 'a' }],
        },
      ),
    ),
    /^<button[^>]*type="button">Next<\/button>$/,
  )
  assert.equal(
    html(btn({ label: 'Go', link: { url: 'https://x.org' }, download: true })),
    '<a href="https://x.org" download="">Go</a>',
  )
})

test('a link whose address fails urlOk is written without href', () => {
  assert.equal(
    html(btn({ label: 'x', link: { url: 'javascript:x' } })),
    '<a>x</a>',
  )
  assert.equal(
    html(btn({ label: 'x', link: { url: '//evil.org' } })),
    '<a>x</a>',
  )
})

test('a button with an icon: before the label, after it, or alone with a visually hidden label', () => {
  const before = html(btn({ label: 'Go', icon: 'home', link: { url: '/a' } }))
  assert.match(
    before,
    /^<a href="\/a"><svg[^>]*style="margin-inline-end:0\.5em;flex:none">.+<\/svg>Go<\/a>$/,
  )
  assert.match(
    html(
      btn({ label: 'Go', icon: 'home', iconAfter: true, link: { url: '/a' } }),
    ),
    /Go<svg[^>]*margin-inline-start:0\.5em/,
  )
  const only = html(
    btn({ label: 'Go', icon: 'home', iconOnly: true, link: { url: '/a' } }),
  )
  assert.match(only, /<span class="s-vh">Go<\/span>/)
  assert.ok(!only.includes('style='))
})

test('a hidden-mail link has no address in it, and sets the flag the page reads', () => {
  const mail = { used: false }
  const out = html(btn({ label: 'a@b.c', link: { email: 'a@b.c' } }), 'live', {
    mail,
  })
  assert.equal(out, '<a href="#" data-u="a" data-d="b.c">a [at] b.c</a>')
  assert.ok(mail.used)
  const run = html(text([{ text: 'Mail', link: { email: 'a@b.c' } }]), 'live', {
    mail: { used: false },
  })
  assert.ok(!run.includes('a@b.c'))
})

test('{address} in a mailto link is empty: Links has no origin to fill it', () => {
  assert.equal(
    html(
      btn({ label: 'Share', link: { url: 'mailto:?body={address}' } }),
      'live',
    ),
    '<a href="mailto:?body=">Share</a>',
  )
})

test('a button in a repeated row that links to the open page is aria-current', () => {
  const pages = [{ id: 'p1', slug: '/about', on: true }] as never
  const ctx = { doc: { pages }, current: 'p1' }
  const a = btn({ label: 'About', link: { page: '/about' } }, { id: 'b~0' })
  assert.match(html(a, 'live', ctx), /aria-current="page"/)
  assert.ok(!html({ ...a, id: 'b' }, 'live', ctx).includes('aria-current'))
})

// ---- menu ----

const pages = [
  {
    id: 'a',
    slug: 'javascript:alert(1)',
    title: 'Bad',
    on: true,
    inMenu: true,
    inFooter: false,
    icon: 'home',
  },
  {
    id: 'b',
    slug: '/talks',
    title: 'Talks',
    on: true,
    inMenu: true,
    inFooter: true,
    icon: 'home',
  },
  {
    id: 'c',
    slug: '/cv',
    title: 'CV <b>',
    on: true,
    inMenu: true,
    inFooter: false,
    icon: 'nope',
  },
  {
    id: 'd',
    slug: '/off',
    title: 'Off',
    on: false,
    inMenu: true,
    inFooter: false,
    icon: 'home',
  },
] as never
const menu = (
  props: Node['props'],
  extra: Partial<ElementCtx> = {},
  mode: 'edit' | 'live' = 'live',
) => html(n('m', 'menu', props), mode, { doc: { pages }, ...extra })

test('menu links go through href and unsafe or off pages are left out', () => {
  assert.equal(
    menu({ which: 'menu', limit: 2 }),
    '<nav aria-label="Site menu"><a href="/talks">Talks</a><a href="/cv">CV &lt;b&gt;</a></nav>',
  )
  assert.equal(
    menu({ which: 'footer' }),
    '<nav aria-label="Footer menu"><a href="/talks">Talks</a></nav>',
  )
})

test('a menu marks the open page; in the editor its links have no href', () => {
  assert.match(
    menu({ which: 'menu' }, { current: 'b' }),
    /<a href="\/talks" aria-current="page">/,
  )
  assert.ok(!menu({ which: 'menu' }, {}, 'edit').includes('href='))
})

test('a menu can be halved, and ends with a view-all link', () => {
  assert.match(
    menu({ which: 'menu', half: 'second' }),
    /aria-label="Site menu \(2\)"><a href="\/cv">/,
  )
  const out = menu(
    { which: 'menu', limit: 1, viewAll: { page: '/cv' }, viewAllLabel: 'All' },
    { current: 'c' },
  )
  assert.match(
    out,
    /<a href="\/talks">Talks<\/a><a href="\/cv" data-all="" aria-current="page">All<\/a>/,
  )
})

test("a menu's icons come only from the table", () => {
  const out = menu({ which: 'menu', icons: 'on' })
  assert.match(out, /<a href="\/talks"><svg[^>]*>.*<\/svg>Talks<\/a>/)
  assert.match(out, /<a href="\/cv">CV &lt;b&gt;<\/a>/)
})

test('a dropdown menu is a native disclosure', () => {
  assert.equal(
    menu({ which: 'footer', as: 'dropdown', drop: 'up' }),
    '<nav aria-label="Footer menu"><details class="s-dd" data-up=""><summary>Menu</summary><div><a href="/talks">Talks</a></div></details></nav>',
  )
})

// ---- form, field, details ----

test('a form posts to the site, with a hidden form name and a trap field', () => {
  const f = n(
    'fm',
    'form',
    { formId: 'Newsletter' },
    { children: [n('k', 'text', { level: 'p', runs: [{ text: 'Hi' }] })] },
  )
  assert.equal(
    html(f),
    '<form action="/_forms" method="post"><input type="hidden" name="form" value="Newsletter"><label class="s-trap" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label><p>Hi</p></form>',
  )
  assert.match(
    html(n('fm', 'form'), 'live', {
      links: { page: s => s, file: () => undefined },
    }),
    /^<form method="post"><input type="hidden" name="form" value="Contact">/,
  )
})

test('input and textarea receive their own compiled control class', () => {
  for (const name of ['name', 'email', 'message', 'subject']) {
    const w = n('f', 'field', { name, label: 'Your value', required: true })
    for (const mode of ['live', 'edit'] as const) {
      const out = html(w, mode, {}, [
        ['f', 'label-class'],
        ['f:control', 'control-class'],
      ])
      assert.match(out, /^<label class="label-class"/)
      assert.match(
        out,
        new RegExp(
          `<${name === 'message' ? 'textarea' : 'input'}[^>]*class="control-class"`,
        ),
      )
      assert.ok(!out.includes('style='))
      assert.equal(out.includes('disabled=""'), mode === 'edit')
      assert.ok(out.includes('required=""'))
    }
  }
  assert.match(
    html(n('f', 'field', { name: 'email' })),
    /Email<input name="email" required|Email<input[^>]*type="email"/,
  )
  assert.match(
    html(n('f', 'field', { name: 'subject' })),
    /Subject<input[^>]*maxlength="200"/,
  )
  assert.match(
    html(n('f', 'field', { name: 'message' })),
    /<textarea[^>]* rows="3"><\/textarea>/,
  )
})

test('details: summary, marker class, open, a group name', () => {
  const d = n(
    'd',
    'details',
    { summary: 'More', marker: 'chevron-end', open: true, name: 'faq' },
    { children: [n('k', 'box')] },
  )
  assert.equal(
    html(d, 'live', {}, [['d', 'c1']]),
    '<details class="c1 s-mk-end" open="" name="faq"><summary>More</summary><div></div></details>',
  )
  assert.equal(
    html(n('d', 'details', { foldOn: 'never', name: 'bad name!' })),
    '<details open=""><summary></summary></details>',
  )
  assert.match(
    html(n('d', 'details', { marker: 'none' }), 'live', {}, []),
    /<details class="s-mk-none">/,
  )
})

// ---- embed ----

test('an embed is written as its static markup: a play link over a poster, no frame', () => {
  const out = html(n('e', 'embed', { provider: 'youtube', id: 'dQw4w9WgXcQ' }))
  assert.equal(
    out,
    '<div class="s-embed"><a class="s-embed-go" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer" data-embed="youtube" data-embed-id="dQw4w9WgXcQ"><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span>Play YouTube</span></a></div>',
  )
  assert.ok(!out.includes('<iframe'))
  assert.match(
    html(n('e', 'embed', { provider: 'vimeo', id: '123456789' })),
    /^<div class="s-embed"><a [^>]*data-embed="vimeo"[^>]*><span>Play Vimeo<\/span><\/a><\/div>$/,
  )
  assert.equal(
    html(n('e', 'embed', { provider: 'youtube', id: '"><script>' }), 'live'),
    '',
  )
  assert.equal(html(n('e', 'embed', { provider: 'toString', id: 'x' })), '')
  assert.match(
    html(n('e', 'embed', { provider: 'youtube', id: 'bad' }), 'edit'),
    /Sample video, not yet chosen/,
  )
})

// ---- fix round 1 ----

test('a text level outside the tag set is a div holding the text', () => {
  for (const level of [
    'script',
    'style',
    'H1',
    'img',
    '',
    'iframe',
    'textarea',
  ])
    assert.equal(
      html(n('t', 'text', { level, runs: [{ text: 'x' }] } as never)),
      '<div class="c0">x</div>',
      level,
    )
})

test('a plug-in tag core does not write itself is a div', () => {
  const spec = (tag: string): KindSpec => ({
    role: 'container',
    parents: 'any',
    tag: () => tag,
    display: () => 'block',
    props: {},
    styles: [],
    states: [],
    bindable: [],
    repeatable: true,
    label: 'X',
    icon: 'x',
  })
  const w = n('c', 'callout', undefined, { children: [n('k', 'divider')] })
  for (const tag of ['Section', 'script', 'style', 'img', '', 'a b', 'on'])
    assert.doesNotThrow(
      () => html(w, 'live', { kinds: new Map([['callout', spec(tag)]]) }),
      tag,
    )
  assert.equal(
    html(w, 'live', { kinds: new Map([['callout', spec('img')]]) }),
    '<div><hr></div>',
  )
  assert.equal(
    html(n('c', 'callout'), 'live', {
      kinds: new Map([['callout', spec('img')]]),
    }),
    '<div></div>',
  )
})

test('MathML with an unknown or inherited character reference, or a null or surrogate one, is not written', () => {
  for (const m of [
    '&constructor;',
    '&toString;',
    '&#0;',
    '&#xD800;',
    '&#x110000;',
  ])
    assert.equal(
      html(text([{ math: `<math><mo>${m}</mo></math>` }])),
      '<h2 class="c0"></h2>',
      m,
    )
})

test('a null run is skipped', () => {
  assert.equal(
    html(text([null, { text: 'a' }, 5, 'x'])),
    '<h2 class="c0">a</h2>',
  )
})

test('a prop that is not text never prints [object Object]', () => {
  const bad = { x: 1 }
  const tree = n('r', 'column', undefined, {
    children: [
      n('b', 'button', { label: bad } as never),
      n('d', 'details', { summary: bad } as never),
      n('f', 'form', { formId: bad } as never),
      n('i', 'image', { src: 'https://x.org/a.png', alt: bad } as never),
    ],
  })
  const out = html(tree)
  assert.ok(!out.includes('object'), out)
  assert.ok(out.includes('value="Contact"'))
})

test('a form action that fails urlOk is not written', () => {
  const form = html(n('fm', 'form'), 'live', {
    links: { ...links, form: () => 'javascript:x' },
  })
  assert.ok(
    !form.includes('javascript') && form.startsWith('<form method="post">'),
  )
})
