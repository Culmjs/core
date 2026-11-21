import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KINDS } from '../../src/document/index.ts'
import type { Look, Node, SiteStyles } from '../../src/document/index.ts'
import { expand } from '../../src/data/index.ts'
import { compileStyles } from '../../src/compile/styles.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { BASE_CSS } from '../../src/style/baseCss.ts'
import { lookCss } from '../../src/style/look.ts'

const look = {
  id: 'l',
  name: 'L',
  family: 'Minimal',
  brand: '#2244aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'cat:source-serif-4',
  bodyFont: 'cat:inter',
  corners: 6,
  dark: 'auto',
} as Look
const ctx = (mode: 'edit' | 'live' = 'live') => ({
  look,
  mode,
  style: { fileUrl: () => undefined, fontFamily: () => 'x' },
})
const txt = (id: string, slot = {}, style?: Node['style']): Node => ({
  id,
  kind: 'text',
  name: id,
  slot,
  props: { level: 'p', runs: [] },
  ...(style ? { style } : {}),
})
const row: Node = {
  id: 'row',
  kind: 'row',
  name: 'R',
  slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
  children: [
    txt('a', { grow: 1 }, { base: { padding: 8 } }),
    txt('b', { grow: 1 }, { base: { padding: 8 } }),
  ],
}
const page: Node = {
  id: 'root',
  kind: 'free',
  name: 'P',
  slot: {},
  children: [
    row,
    {
      id: 'nav',
      kind: 'row',
      name: 'N',
      slot: { x: 0, y: 4, w: 24, h: 2, z: 0 },
      props: { as: 'nav' },
    },
  ],
}

test('identical styles share one class, numbered in first-seen order', () => {
  const { css, classOf } = compileStyles(page, ctx())
  assert.equal(classOf.get('a'), classOf.get('b'))
  assert.deepEqual([...new Set(classOf.values())], ['c0', 'c1', 'c2', 'c3'])
  assert.equal(compileStyles(page, ctx()).css, css, 'byte-identical on repeat')
})

test('Free placement, phone rules, row stacking, nav wrapping', () => {
  const { css, classOf } = compileStyles(page, ctx())
  const rowClass = classOf.get('row')!
  assert.match(css, new RegExp(`\\.${rowClass}\\{[^}]*grid-column:1 / span 24`))
  const phone = css.slice(css.indexOf('@media (max-width: 600px)'))
  assert.match(
    phone,
    new RegExp(
      `:where\\(\\.s-site--live\\) \\.${rowClass}\\{[^}]*flex-direction:column`,
    ),
  )
  assert.match(
    phone,
    new RegExp(`\\.${classOf.get('nav')}\\{[^}]*flex-wrap:wrap`),
  )
  assert.ok(!css.includes('.s-site--phone'), 'editor copy only in edit mode')
  assert.ok(compileStyles(page, ctx('edit')).css.includes('.s-site--phone'))
})

test('hide flags, fixed variant order, base stylesheet weight', () => {
  const hidden: Node = {
    ...page,
    children: [
      {
        ...txt('h', { x: 0, y: 0, w: 4, h: 2, z: 0 }),
        hide: { desktop: true },
      },
    ],
  }
  const { css, classOf } = compileStyles(hidden, ctx())
  const k = classOf.get('h')!
  assert.match(css, new RegExp(`\\.${k}\\{[^}]*display:none`))
  assert.match(
    css.slice(css.indexOf('@media (max-width: 600px)')),
    new RegExp(`\\.${k}\\{[^}]*display:block`),
  )
  assert.ok(
    css.indexOf(':hover') < css.indexOf('@media (max-width: 600px)') ||
      !css.includes(':hover'),
  )
  assert.ok(BASE_CSS.includes('overflow-wrap:anywhere'))
  for (const rule of BASE_CSS.match(/(^|})[^{}@]+\{/g) ?? [])
    if (/[a-z]\s+[a-z.]/.test(rule) && !rule.includes(':where('))
      assert.fail(`weighted rule: ${rule}`)
})

test("main carries the page background, with no weight, so the crawl's measuring code reads it", () => {
  const rule = ':where(.s-site) :where(main){background:var(--s-bg)}'
  assert.ok(BASE_CSS.includes(rule))
  assert.equal(
    rule
      .replace(/:where\([^)]*\)/g, '')
      .trim()
      .split('{')[0],
    '',
    'every selector part is inside :where()',
  )
})

const phoneOf = (css: string) =>
  css.slice(css.indexOf('@media (max-width: 600px)'))

test('a phone-only child in a derived container is placed on phones', () => {
  const t: Node = {
    ...page,
    children: [
      {
        ...txt('p', { x: 6, y: 2, w: 12, h: 4, z: 0 }),
        hide: { desktop: true },
      },
      txt('q', { x: 0, y: 8, w: 24, h: 4, z: 0 }),
    ],
  }
  const { css, classOf } = compileStyles(t, ctx())
  assert.match(
    phoneOf(css),
    new RegExp(
      `:where\\(\\.s-site--live\\) \\.${classOf.get('p')}\\{[^}]*grid-column:`,
    ),
  )
})

test('variants weigh the same, so source order decides', () => {
  const t: Node = {
    ...page,
    children: [
      txt(
        'd',
        { x: 0, y: 0, w: 4, h: 2, z: 0 },
        {
          dark: { color: '#000000' },
          phone: { color: '#ffffff' },
          hover: { color: 'brand' },
        },
      ),
    ],
  }
  const { css, classOf } = compileStyles(t, ctx('edit'))
  const k = classOf.get('d')!
  const dark = css.indexOf(`:where(.s-site.s-scheme-dark) .${k}{color:#000000}`)
  const auto = css.indexOf(
    `@media (prefers-color-scheme: dark){:where(.s-site.s-scheme-auto) .${k}{color:#000000}}`,
  )
  const phone = css.indexOf(
    `@media (max-width: 600px){:where(.s-site--live) .${k}{`,
  )
  assert.ok(css.includes(`.${k}:where(:hover){color:var(--s-brand)}`))
  assert.ok(
    dark > -1 && auto > dark && phone > auto,
    'dark, then auto dark, then phone',
  )
  assert.match(css.slice(phone), new RegExp(`\\.${k}\\{[^}]*color:#ffffff`))
  assert.ok(css.includes(`:where(.s-site--phone) .${k}{`))
})

test('list markers are counters, and none writes no counter', () => {
  const list = (marker: string): Node => ({
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props: { marker },
        style: { base: { padding: 4 } },
        children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
      },
    ],
  })
  const dec = compileStyles(list('decimal'), ctx())
  const k = dec.classOf.get('l')!
  const s = k.slice(1)
  assert.ok(
    dec.css.includes(`.${k}>*{position:relative;counter-increment:s${s}}`),
  )
  assert.ok(dec.css.includes(`content:counter(s${s},decimal) ". "`))
  assert.ok(
    dec.css.indexOf(`padding-inline-start:1.5em`) > dec.css.indexOf(`.${k}{`),
    "marker room comes after the list's own padding",
  )
  assert.ok(compileStyles(list('disc'), ctx()).css.includes('content:"\\2022"'))
  const none = compileStyles(list('none'), ctx()).css
  assert.ok(!none.includes('counter-increment') && !none.includes('counter('))
})

test('a marker outside the fixed list writes no counter rules', () => {
  const t: Node = {
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props: { marker: 'decimal) } body{display:none} .x{' },
        children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
      },
    ],
  }
  const { css } = compileStyles(t, ctx())
  assert.ok(!css.includes('counter') && !css.includes('body{'))
})

test("a grow child with no basis is Expanded; a px-width child doesn't shrink", () => {
  const r: Node = {
    id: 'r',
    kind: 'row',
    name: 'R',
    slot: {},
    children: [
      txt('g', { grow: 2 }),
      txt('b', { grow: 1, basis: { n: 100, unit: 'px' } } as never),
      txt('w', {}, { base: { width: { n: 200, unit: 'px' } } as never }),
    ],
  }
  const { css, classOf } = compileStyles(r, ctx())
  const decl = (id: string) =>
    new RegExp(`\\.${classOf.get(id)}\\{([^}]*)\\}`).exec(css)![1]
  assert.match(decl('g'), /flex:2 1 0%/)
  assert.match(decl('b'), /flex:1 1 100px/)
  assert.match(decl('w'), /width:200px/)
  assert.match(decl('w'), /flex-shrink:0/)
  assert.doesNotMatch(decl('g'), /flex-shrink/)
})

test('base css has no page frame', () => {
  assert.ok(!BASE_CSS.includes('max-width:1120px'))
  // the header may stick to the top and the page may fill the window, but neither brings a width or padding of its own
  assert.ok(!/\.s-(header|footer)\{[^}]*(max-width|padding)/.test(BASE_CSS))
  assert.ok(!/\.s-site\{[^}]*padding/.test(BASE_CSS))
})

test('header and menu links are plain, and the open page is still underlined (it comes later)', () => {
  const plain = BASE_CSS.indexOf('header a,nav a){text-decoration:none}')
  assert.ok(
    plain >= 0 &&
      plain <
        BASE_CSS.indexOf('[aria-current=page]){text-decoration:underline'),
  )
})

test("a divider's border is its top edge only", () => {
  const hr: Node = {
    id: 'hr',
    kind: 'divider',
    name: 'D',
    slot: { x: 0, y: 0, w: 24, h: 1, z: 0 },
    style: { base: { border: { width: 1, style: 'solid', color: 'ink' } } },
  }
  const { css } = compileStyles(
    { id: 'root', kind: 'free', name: 'P', slot: {}, children: [hr] },
    ctx(),
  )
  assert.match(css, /border:0;border-top:1px solid/)
  assert.doesNotMatch(css, /[{;]border:1px/)
})

test('a divider keeps its border as the top edge only, even with sides', () => {
  const div = (sides?: string[]): Node => ({
    id: 'd',
    kind: 'divider',
    name: 'D',
    slot: {},
    style: {
      base: {
        border: {
          width: 2,
          style: 'dotted',
          color: 'ink',
          ...(sides ? { sides: sides as never } : {}),
        },
      },
    },
  })
  const css = (w: Node) =>
    compileStyles(
      { id: 'root', kind: 'box', name: 'P', slot: {}, children: [w] },
      ctx(),
    ).css
  for (const w of [div(), div(['bottom', 'left'])]) {
    const out = css(w)
    assert.match(out, /border:0;border-top:2px dotted var\(--s-ink\)/)
    assert.ok(!out.includes('border-bottom') && !out.includes('border-left'))
  }
})

test("a pattern's size sets its tile, and a run gets bg, radius and strike", () => {
  const box: Node = {
    id: 'b',
    kind: 'box',
    name: 'B',
    slot: {},
    props: { pattern: { tile: 'dots', color: 'ink', strength: 20, size: 40 } },
  }
  assert.match(compileStyles(box, ctx()).css, /0 0\/40px 40px/)
  assert.match(
    compileStyles(
      {
        ...box,
        props: { pattern: { tile: 'dots', color: 'ink', strength: 20 } },
      },
      ctx(),
    ).css,
    /0 0\/18px 18px/,
  )
  const t: Node = {
    id: 't',
    kind: 'text',
    name: 'T',
    slot: {},
    props: {
      level: 'p',
      runs: [{ text: 'a', style: { bg: 'brand', radius: 4, strike: true } }],
    },
  }
  assert.match(
    compileStyles(t, ctx()).css,
    /background-color:var\(--s-brand\);border-radius:4px;text-decoration-line:line-through/,
  )
})

test('a run writes baseline, small caps and underline details', () => {
  const t: Node = {
    id: 't',
    kind: 'text',
    name: 'T',
    slot: {},
    props: {
      level: 'p',
      runs: [
        {
          text: 'a',
          style: { baseline: 'super', smallCaps: true, underlineOffset: 3 },
        },
      ],
    },
  }
  assert.match(
    compileStyles(t, ctx()).css,
    /text-underline-offset:3px;vertical-align:super;font-variant-caps:small-caps/,
  )
})

test('the site clips sideways overflow without breaking sticky', () => {
  assert.match(BASE_CSS, /\.s-site\{[^}]*overflow-x:clip/)
  assert.ok(!/overflow-x:hidden/.test(BASE_CSS))
})

test('pin in base coexists with the phone placement of a Free child', () => {
  const bar: Node = {
    id: 'bar',
    kind: 'box',
    name: 'B',
    slot: { x: 0, y: 0, w: 24, h: 2, z: 0 },
    style: { base: { pin: 'top' } },
  }
  const { css, classOf } = compileStyles(
    { id: 'root', kind: 'free', name: 'P', slot: {}, children: [bar] },
    ctx(),
  )
  const k = classOf.get('bar')!
  assert.match(
    css,
    new RegExp(
      `\\.${k}\\{[^}]*grid-column:1 / span 24[^}]*position:fixed;inset:auto;top:0;left:0;right:0;margin:0;width:auto;max-width:none;z-index:50`,
    ),
  )
  assert.match(
    css.slice(css.indexOf('@media (max-width: 600px)')),
    new RegExp(`\\.${k}\\{[^}]*grid-column:1 / span 24`),
  )
})

test('static lists: start, reversed and the list-level marker', () => {
  const list = (props: Node['props'], n = 3): Node => ({
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props,
        children: Array.from(
          { length: n },
          (_, i) => ({ id: `i${i}`, kind: 'box', name: 'I', slot: {} }) as Node,
        ),
      },
    ],
  })
  const css = (props: Node['props'], n?: number) => {
    const r = compileStyles(list(props, n), ctx())
    return { css: r.css, s: r.classOf.get('l')!.slice(1) }
  }
  const st = css({ marker: 'decimal', start: 5 })
  assert.ok(st.css.includes(`counter-reset:s${st.s} 4`))
  const rev = css({ marker: 'decimal', reversed: true })
  assert.ok(
    rev.css.includes(`counter-reset:s${rev.s} 4`) &&
      rev.css.includes(`counter-increment:s${rev.s} -1`),
    '3 items count down from 3',
  )
  const both = css({ marker: 'decimal', reversed: true, start: 10 })
  assert.ok(both.css.includes(`counter-reset:s${both.s} 11`))
  assert.ok(
    !compileStyles(list({ marker: 'decimal', start: 2 }), ctx()).css.includes(
      'counter-reset:s1 0',
    ),
    'start is part of the rule',
  )
})

test('field paint targets the control while layout and type stay on the label in every variant', () => {
  const f: Node = {
    id: 'f',
    kind: 'field',
    name: 'F',
    slot: {},
    props: { name: 'email' },
    style: {
      base: {
        bg: 'brand',
        border: { width: 2, style: 'solid', color: 'ink' },
        radius: 8,
        size: 20,
        padding: 12,
      },
      hover: { bg: 'ink', size: 21 },
      dark: { bg: 'bg', size: 22 },
      phone: { radius: 4, size: 16, padding: 6 },
    },
  }
  const tree: Node = {
    ...page,
    children: [
      {
        id: 'fm',
        kind: 'form',
        name: 'Fm',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        children: [f],
      },
    ],
  }
  for (const mode of ['live', 'edit'] as const) {
    const { css, classOf } = compileStyles(tree, ctx(mode))
    const k = classOf.get('f')!,
      c = classOf.get('f:control')!
    const rules = css.split('}').filter(r => r.includes(`.${k}`))
    assert.ok(
      rules.every(r => !/background-color|border:|border-radius/.test(r)),
      'no duplicate paint on label',
    )
    assert.ok(css.includes(`.${k}{min-width:0;padding:12px;font-size:20px}`))
    assert.ok(
      css.includes(
        `.${c}{background-color:var(--s-brand);border:2px solid var(--s-ink);border-radius:8px}`,
      ),
    )
    assert.ok(
      css.includes(`.${c}:where(:hover){background-color:var(--s-ink)}`),
    )
    assert.ok(
      css.includes(
        `:where(.s-site.s-scheme-dark) .${c}{background-color:var(--s-bg)}`,
      ),
    )
    assert.ok(
      css.includes(
        `:where(.s-site.s-scheme-auto) .${c}{background-color:var(--s-bg)}`,
      ),
    )
    assert.ok(css.includes(`:where(.s-site--live) .${c}{border-radius:4px}`))
    assert.ok(
      css.includes(`:where(.s-site--live) .${k}{padding:6px;font-size:16px}`),
    )
    if (mode === 'edit')
      assert.ok(css.includes(`:where(.s-site--phone) .${c}{border-radius:4px}`))
    assert.match(
      css,
      /box-sizing:border-box;width:100%;min-width:0;max-width:100%;min-height:44px;padding:\.6em \.8em;border:1px solid var\(--s-line\);border-radius:6px;background-color:var\(--s-bg\);color:inherit;font:inherit/,
    )
    assert.ok(
      !css.includes('outline:none') && !css.includes('outline:0'),
      'native focus outline remains',
    )
    assert.equal(compileStyles(tree, ctx(mode)).css, css)
  }
})

test('field controls retain native whitespace unless nowrap is authored', () => {
  const f: Node = {
    id: 'f',
    kind: 'field',
    name: 'Message',
    slot: {},
    props: { name: 'message' },
  }
  const tree: Node = {
    ...page,
    children: [
      {
        id: 'fm',
        kind: 'form',
        name: 'Form',
        slot: { x: 0, y: 0, w: 24, h: 1, z: 0 },
        children: [f],
      },
    ],
  }
  assert.ok(!compileStyles(tree, ctx()).css.includes('white-space:inherit'))
  f.style = { base: { nowrap: true } }
  const { css, classOf } = compileStyles(tree, ctx())
  assert.ok(css.includes(`.${classOf.get('f:control')}{white-space:nowrap}`))
})

test('a reversed repeated list counts from the expanded item total', () => {
  const list = (props: Node['props'], marker?: 'disc'): Node => ({
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props,
        repeat: { source: 'projects', ...(marker ? { marker } : {}) },
        children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
      },
    ],
  })
  const data = {
    rows: { projects: [1, 2, 3, 4].map(n => ({ title: `T${n}` })) },
  }
  const run = (t: Node) =>
    expand(t, {
      data,
      components: [],
      fonts: [],
      styles: defaultSiteStyles(look),
    }).tree
  const out = run(list({ marker: 'decimal', reversed: true }, 'disc'))
  const { css, classOf } = compileStyles(out, ctx())
  assert.equal(
    out.children![0].children!.length,
    4,
    'expanded to the data length',
  )
  assert.equal(
    out.children![0].props!.marker,
    'decimal',
    'the new marker wins over the legacy repeat marker',
  )
  assert.ok(
    css.includes(`counter-reset:s${classOf.get('l')!.slice(1)} 5`),
    '4 items count down from 4',
  )
  assert.ok(!css.includes('reversed('))
  const legacy = run(list({ reversed: true }, 'disc'))
  assert.equal(legacy.children![0].props!.marker, 'disc')
  assert.ok(compileStyles(legacy, ctx()).css.includes('content:"\\2022"'))
})

test('list markers never wrap inside their gutter', () => {
  const list: Node = {
    id: 'ls',
    kind: 'list',
    name: 'L',
    slot: { x: 0, y: 0, w: 24, h: 2, z: 0 },
    props: { marker: 'decimal' },
    children: [txt('l1'), txt('l2')],
  }
  const { css } = compileStyles(
    { id: 'root', kind: 'free', name: 'P', slot: {}, children: [list] },
    ctx(),
  )
  assert.match(css, /::before\{[^}]*white-space:nowrap/)
})

test('square and circle bullets draw their own glyphs', () => {
  const mk = (m: string): Node => ({
    id: 'l' + m,
    kind: 'list',
    name: 'L',
    slot: { x: 0, y: 0, w: 24, h: 2, z: 0 },
    props: { marker: m as never },
    children: [txt('a' + m), txt('b' + m)],
  })
  const { css } = compileStyles(
    {
      id: 'root',
      kind: 'free',
      name: 'P',
      slot: {},
      children: [mk('square'), mk('circle')],
    },
    ctx(),
  )
  assert.match(css, /content:"\\25AA"/)
  assert.match(css, /content:"\\25E6"/)
})

test("a list's own padding beats the marker gutter; float writes inline floats", () => {
  const list: Node = {
    id: 'lp',
    kind: 'list',
    name: 'L',
    slot: { x: 0, y: 0, w: 24, h: 2, z: 0 },
    props: { marker: 'disc' },
    style: { base: { padding: [0, 0, 0, 40] } },
    children: [txt('p1'), txt('p2')],
  }
  const img: Node = {
    id: 'fl',
    kind: 'image',
    name: 'I',
    slot: { x: 0, y: 2, w: 6, h: 4, z: 0 },
    props: { assetId: 'ph', alt: '' },
    style: { base: { float: 'end' } },
  }
  const { css } = compileStyles(
    { id: 'root', kind: 'free', name: 'P', slot: {}, children: [list, img] },
    ctx(),
  )
  assert.match(css, /:where\(\.c[0-9a-z]+\)\{padding-inline-start:1\.5em\}/)
  assert.doesNotMatch(
    css,
    /\.c[0-9a-z]+\{counter-reset:[^}]*padding-inline-start/,
  )
  assert.match(css, /float:inline-end/)
})

test('nowrap keeps a text or a run on one line', () => {
  const t: Node = {
    id: 'nw',
    kind: 'text',
    name: 'T',
    slot: { x: 0, y: 0, w: 24, h: 1, z: 0 },
    props: {
      level: 'p',
      runs: [{ text: 'a chip', style: { nowrap: true, bg: 'brand' } }],
    },
    style: { base: { nowrap: true } },
  }
  const { css } = compileStyles(
    { id: 'root', kind: 'free', name: 'P', slot: {}, children: [t] },
    ctx(),
  )
  assert.equal(css.match(/white-space:nowrap/g)?.length, 2)
})

test('bullet markers are scaled, counters are not', () => {
  const list = (marker: string): Node => ({
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props: { marker },
        children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
      },
    ],
  })
  for (const m of ['disc', 'circle', 'square'])
    assert.match(
      compileStyles(list(m), ctx()).css,
      /::before\{[^}]*transform:scale\(1\.45\);transform-origin:/,
      m,
    )
  for (const m of [
    'decimal',
    'decimal-leading-zero',
    'lower-roman',
    'lower-alpha',
  ])
    assert.ok(!compileStyles(list(m), ctx()).css.includes('scale(1.45)'), m)
  assert.match(
    compileStyles(list('decimal-leading-zero'), ctx()).css,
    /content:counter\(s[\w-]+,decimal-leading-zero\)\}/,
  )
  assert.match(
    compileStyles(list('decimal'), ctx()).css,
    /content:counter\(s[\w-]+,decimal\) "\. "/,
  )
})

const compileFor = (w: Partial<Node>, mode: 'edit' | 'live' = 'live') => {
  const t: Node = {
    ...page,
    children: [{ ...txt('x', { x: 0, y: 0, w: 4, h: 2, z: 0 }), ...w }],
  }
  return compileStyles(t, ctx(mode)).css
}

test('tablet block comes before the phone block', () => {
  const css = compileFor({
    style: { tablet: { padding: 8 }, phone: { padding: 4 } },
  })
  assert.ok(css.indexOf('@media (max-width: 1024px)') >= 0)
  assert.ok(
    css.indexOf('@media (max-width: 1024px)') <
      css.indexOf('@media (max-width: 600px)'),
  )
  assert.match(
    css,
    /@media \(max-width: 1024px\)\{:where\(\.s-site--live\) \.c\d+\{padding:8px\}/,
  )
})

test('phone view applies tablet then phone', () => {
  const css = compileFor(
    { style: { tablet: { padding: 8 }, phone: { padding: 4 } } },
    'edit',
  )
  assert.match(
    css,
    /:where\(\.s-site--tablet, \.s-site--phone\) \.c\d+\{padding:8px\}/,
  )
  assert.ok(
    css.indexOf('.s-site--tablet, ') < css.indexOf(':where(.s-site--phone) '),
  )
})

test('hide.tablet only hides at tablet and shows again on phone', () => {
  const css = compileFor({ kind: 'text', hide: { tablet: true } })
  assert.match(css, /max-width: 1024px\)\{[^}]*display:none/)
  assert.doesNotMatch(
    css.slice(0, css.indexOf('@media (max-width: 1024px)')),
    /display:none/,
  )
  assert.match(phoneOf(css), /\{[^}]*display:block/)
})

test('hide.tablet with hide.phone stays hidden on phone', () => {
  const css = phoneOf(
    compileFor({ kind: 'text', hide: { tablet: true, phone: true } }),
  )
  assert.ok(css.lastIndexOf('display:none') > css.lastIndexOf('display:block'))
})

test('render re-checks stored site styles: a hostile colour never reaches the CSS', () => {
  const styles = {
    ...defaultSiteStyles(look),
    colors: [
      { id: 'x', name: 'X', value: '#fff;}body{display:none}' as never },
    ],
  }
  const t: Node = {
    ...page,
    children: [
      {
        ...txt('t', { x: 0, y: 0, w: 4, h: 2, z: 0 }),
        style: { base: { bg: { style: 'x' } } },
      },
    ],
  }
  for (const mode of ['live', 'edit'] as const) {
    const { css } = compileStyles(t, { ...ctx(mode), styles })
    assert.ok(!css.includes('body{display:none}'), css)
  }
  // valid site styles are written as before
  const ok = {
    ...defaultSiteStyles(look),
    colors: [{ id: 'x', name: 'X', value: '#ff0000' as const }],
  }
  assert.match(
    compileStyles(t, { ...ctx(), styles: ok }).css,
    /--s-c-x:#ff0000/,
  )
  // a hostile text style
  const text = {
    ...defaultSiteStyles(look),
    text: [
      {
        id: 'h',
        name: 'H',
        decl: { color: '#fff;}body{display:none}' as never },
      },
    ],
  }
  const u: Node = {
    ...page,
    children: [
      {
        ...txt('u', { x: 0, y: 0, w: 4, h: 2, z: 0 }),
        props: { level: 'p', runs: [], textStyle: 'h' },
      },
    ],
  }
  assert.ok(
    !compileStyles(u, { ...ctx(), styles: text }).css.includes(
      'body{display:none}',
    ),
  )
})

test("render re-checks each block's stored style: a hostile value writes nothing", () => {
  for (const style of [
    { base: { bg: '#fff;}body{display:none}' } },
    { phone: { color: 'red;}body{display:none}' } },
    { base: { padding: '0;}body{display:none}' } },
  ] as never[]) {
    assert.ok(
      !compileFor({ kind: 'text', style }).includes('body{display:none}'),
      JSON.stringify(style),
    )
  }
  assert.match(
    compileFor({ kind: 'text', style: { base: { padding: 8 } } }),
    /padding:8px/,
  )
})

test('a tablet style that hides a block can be undone on phone', () => {
  const css = compileFor({
    kind: 'text',
    style: { tablet: { hidden: true }, phone: { hidden: false } },
  })
  assert.match(css, /max-width: 1024px\)\{[^}]*display:none/)
  assert.match(phoneOf(css), /\{[^}]*display:block/)
  // phone says nothing: it keeps following tablet
  assert.doesNotMatch(
    phoneOf(compileFor({ kind: 'text', style: { tablet: { hidden: true } } })),
    /display:block/,
  )
})

test("a form field's wrapper takes its focus layer when the control inside has focus", () => {
  const f: Node = {
    id: 'f',
    kind: 'field',
    name: 'F',
    slot: {},
    props: { name: 'email' },
    style: { focus: { padding: 4 } },
  }
  const { css, classOf } = compileStyles(
    {
      ...page,
      children: [
        {
          id: 'fm',
          kind: 'form',
          name: 'Fm',
          slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
          children: [f],
        },
      ],
    },
    ctx(),
  )
  const k = classOf.get('f')!
  assert.ok(css.includes(`.${k}:where(:focus-within){padding:4px}`))
  assert.ok(!css.includes(`.${k}:where(:focus-visible)`))
})

test('hide.desktop alone still shows on phone and does not write a tablet block', () => {
  const css = compileFor({ kind: 'text', hide: { desktop: true } })
  assert.doesNotMatch(css, /1024px/)
  assert.match(phoneOf(css), /display:block/)
})

test('no tablet values writes no 1024px block', () => {
  assert.doesNotMatch(
    compileFor({ style: { phone: { padding: 4 } } }),
    /1024px/,
  )
})

test('state layers compile in the fixed order after base', () => {
  const css = compileFor({
    kind: 'button',
    style: {
      base: { padding: 1 },
      hover: { padding: 2 },
      pressed: { padding: 3 },
      focus: { padding: 4 },
      current: { padding: 5 },
      dark: { padding: 6 },
    },
  })
  const order = [
    'padding:1px',
    ':where(:hover)',
    ':where(:active)',
    ':where(:focus-visible)',
    ':where([aria-current="page"])',
    's-scheme-dark',
  ].map(s => css.indexOf(s))
  assert.ok(
    order.every(i => i >= 0),
    JSON.stringify(order),
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  )
})

test('open, checked and invalid selectors', () => {
  assert.match(
    compileFor({ kind: 'box', style: { open: { padding: 2 } } }),
    /\.c\d+:where\(\[open\], :popover-open\)\{padding:2px\}/,
  )
  const f = compileFor({
    kind: 'field',
    style: { checked: { padding: 2 }, invalid: { padding: 3 } },
  })
  assert.match(f, /:where\(:checked\)/)
  assert.match(f, /:where\(:user-invalid\)/)
})

test("a menu's current layer lands on its current link", () => {
  assert.match(
    compileFor({
      kind: 'menu',
      props: { which: 'menu' },
      style: { current: { color: 'brand' } },
    }),
    /\.c\d+ :where\(\[aria-current="page"\]\)\{color:/,
  )
})

test('placement.tablet compiles in the tablet block and the phone falls back to it', () => {
  const css = compileFor({
    kind: 'image',
    placement: { mode: 'normal', tablet: { mode: 'front', x: 4, y: 6 } },
  })
  assert.match(
    css.slice(
      css.indexOf('@media (max-width: 1024px)'),
      css.indexOf('@media (max-width: 600px)'),
    ),
    /position:absolute[^}]*inset-inline-start:4px;top:6px/,
  )
  assert.doesNotMatch(
    css.slice(0, css.indexOf('@media (max-width: 1024px)')),
    /position:absolute/,
  )
})

test("z adds to a Free slot's z-index and to front/behind placement", () => {
  const slot = { x: 0, y: 0, w: 4, h: 2, z: 3 }
  assert.match(
    compileFor({ slot, style: { base: { z: 5 } } }),
    /grid-row:1 \/ span 2;z-index:3;[^}]*z-index:8\}/,
  )
  assert.match(
    compileFor({
      slot,
      placement: { mode: 'front' },
      style: { base: { z: 5 } },
    }),
    /z-index:20003;[^}]*z-index:20008\}/,
  )
  assert.match(
    compileFor({
      slot,
      placement: { mode: 'behind' },
      style: { base: { z: -2 } },
    }),
    /z-index:-19997;[^}]*z-index:-19999\}/,
  )
  const tablet = (css: string) =>
    css.slice(
      css.indexOf('@media (max-width: 1024px)'),
      css.indexOf('@media (max-width: 600px)'),
    )
  assert.match(
    tablet(compileFor({ slot, style: { base: { z: 5 }, tablet: { z: 1 } } })),
    /z-index:4\}/,
  )
})

test('z with no z-index to add to is the z-index, with a position', () => {
  const inBox: Node = {
    id: 'b',
    kind: 'box',
    name: 'B',
    slot: { x: 0, y: 0, w: 4, h: 2, z: 0 },
    children: [txt('t', {}, { base: { z: 7 } })],
  }
  const css = compileStyles({ ...page, children: [inBox] }, ctx()).css
  assert.match(css, /\{position:relative;z-index:7\}/)
  const own = compileStyles(
    {
      ...page,
      children: [
        {
          ...inBox,
          children: [txt('t', {}, { base: { z: 7, position: 'sticky' } })],
        },
      ],
    },
    ctx(),
  ).css
  assert.match(own, /\{position:sticky;z-index:7\}/)
  assert.doesNotMatch(own, /position:relative;z-index:7/)
})

test('a page with a transition carries the reduced-motion guard once', () => {
  const t = { what: 'all', ms: 200, ease: 'out' } as const
  const w = (id: string, style: Node['style']): Node =>
    txt(id, { x: 0, y: 0, w: 4, h: 2, z: 0 }, style)
  const css = compileStyles(
    {
      ...page,
      children: [
        w('a', { base: { transition: t } }),
        w('b', { hover: { transition: { ...t, ms: 90 } } }),
        w('c', { phone: { transition: t } }),
      ],
    },
    ctx(),
  ).css
  const guard =
    '@media (prefers-reduced-motion: reduce){:where(.s-site) *{transition:none!important}}'
  assert.ok(guard.includes('!important'))
  assert.equal(css.split(guard).length - 1, 1)
  assert.ok(css.endsWith(guard))
  assert.ok(!compileStyles(page, ctx()).css.includes('prefers-reduced-motion'))
})

test('a state or layout that sets one transform part keeps the inherited ones', () => {
  const rules = (style: Node['style']) => compileFor({ kind: 'box', style })
  assert.match(
    rules({ base: { rotate: 4 }, hover: { scale: 1.1 } }),
    /:where\(:hover\)\{transform:rotate\(4deg\) scale\(1\.1\)\}/,
  )
  assert.match(
    rules({ base: { rotate: 4 }, phone: { scale: 2 } }),
    /@media \(max-width: 600px\)\{[^]*;transform:rotate\(4deg\) scale\(2\)\}/,
  )
  assert.match(
    rules({
      base: { rotate: 4 },
      tablet: { scale: 2 },
      phone: { move: { x: { n: 1, unit: 'px' }, y: { n: 2, unit: 'px' } } },
    }),
    /;transform:translate\(1px,2px\) rotate\(4deg\) scale\(2\)\}/,
  )
  const plain = rules({ base: { rotate: 4 }, hover: { padding: 2 } })
  assert.match(plain, /:where\(:hover\)\{padding:2px\}/)
})

test('z set only in a state layer still gets a position', () => {
  const w: Node = {
    id: 'b',
    kind: 'box',
    name: 'B',
    slot: { x: 0, y: 0, w: 4, h: 2, z: 0 },
    children: [txt('t', {}, { hover: { z: 4 } })],
  }
  const css = compileStyles({ ...page, children: [w] }, ctx()).css
  assert.match(css, /\{position:relative\}/)
  assert.match(css, /:where\(:hover\)\{z-index:4\}/)
})

test('old page renders identically: no new property reaches its CSS', () => {
  const css = compileStyles(page, ctx()).css
  assert.doesNotMatch(
    css,
    /transform|transition|mix-blend|filter|object-position|cursor|clip-path|line-clamp|position:relative;z-index/,
  )
})

test('grid tabletCols compiles into the 1024px block', () => {
  const g: Node = {
    id: 'g',
    kind: 'grid',
    name: 'G',
    slot: {},
    props: { cols: 4, tabletCols: 2 },
    children: [{ id: 'k', kind: 'box', name: 'K', slot: { cols: 3 } }],
  }
  const css = compileStyles(
    {
      id: 'root',
      kind: 'free',
      name: 'P',
      slot: {},
      children: [{ ...g, slot: { x: 0, y: 0, w: 24, h: 4, z: 0 } }],
    },
    ctx(),
  ).css
  const tablet = css.slice(
    css.indexOf('@media (max-width: 1024px)'),
    css.indexOf('@media (max-width: 600px)') < 0
      ? undefined
      : css.indexOf('@media (max-width: 600px)'),
  )
  assert.match(tablet, /repeat\(2,/)
  assert.match(tablet, /grid-column:span 2/)
  assert.ok(
    !css.slice(css.indexOf('@media (max-width: 600px)')).includes('repeat(2,'),
    'phone inherits tablet columns',
  )
})

test('a Free tablet box compiles into the 1024px block only when it differs', () => {
  const kid = (id: string, tablet?: object) => ({
    ...txt(id, {
      x: 0,
      y: 0,
      w: 12,
      h: 4,
      z: 0,
      ...(tablet ? { tablet } : {}),
    }),
  })
  const css = compileStyles(
    {
      id: 'root',
      kind: 'free',
      name: 'P',
      slot: {},
      children: [kid('a', { x: 0, y: 0, w: 24, h: 4, z: 0 }), kid('b')],
    },
    ctx(),
  ).css
  const block = css.slice(
    css.indexOf('@media (max-width: 1024px)'),
    css.indexOf('@media (max-width: 600px)'),
  )
  assert.match(block, /grid-column:1 \/ span 24/)
  assert.equal(
    (block.match(/\{/g) ?? []).length,
    2,
    'media opener plus one rule',
  )
})

const holder = (kids: Node[], extra: Partial<Node> = {}): Node => ({
  id: 'tabs',
  kind: 'box',
  name: 'Tabs',
  slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
  state: [{ name: 'tab', values: ['talks', 'papers'], initial: 'talks' }],
  children: kids,
  ...extra,
})

test('when compiles to a data-attribute selector', () => {
  const t = txt(
    't',
    {},
    {
      base: { color: 'ink' },
      hover: { color: 'brand' },
      phone: { size: 12 },
      when: [{ state: 'tab', is: 'papers', decl: { color: 'brand' } }],
    },
  )
  const { css, classOf } = compileStyles(
    { ...page, children: [holder([t])] },
    ctx(),
  )
  const c = classOf.get('t')!
  assert.ok(css.includes(`:where([data-s-tab="papers"]) .${c}`), css)
  assert.ok(
    css.includes(`.${c}:where([data-s-tab="papers"])`),
    'the holder itself is covered too',
  )
  const at = css.indexOf('[data-s-tab="papers"]')
  assert.ok(css.indexOf(':where(:hover)') < at, 'after the state layers')
  assert.ok(
    at < css.indexOf('@media (max-width: 600px)'),
    'before the phone block',
  )
})

test('a state name or value that fails the grammar writes no selector', () => {
  const t = txt('t', {}, {
    when: [
      { state: 'tab"]{}', is: 'x', decl: { color: 'brand' } },
      { state: 'tab', is: 'a b', decl: { color: 'brand' } },
    ],
  } as never)
  const css = compileStyles({ ...page, children: [holder([t])] }, ctx()).css
  assert.ok(!css.includes('data-s-tab'), css)
  assert.ok(!css.includes('"]{}'))
})

test('a page with no states or entrances adds nothing', () => {
  const css = compileStyles(page, ctx()).css
  assert.doesNotMatch(css, /no-preference|keyframes|data-s-|\.s-js/)
})

test('a when layer that shows or hides follows the phone block', () => {
  const t = txt(
    't',
    {},
    {
      phone: { size: 12 },
      when: [
        { state: 'tab', is: 'talks', decl: { hidden: true } },
        { state: 'tab', is: 'papers', decl: { hidden: false } },
      ],
    },
  )
  const { css, classOf } = compileStyles(
    { ...page, children: [holder([t])] },
    ctx(),
  )
  const c = classOf.get('t')!,
    phoneAt = css.indexOf('@media (max-width: 600px)')
  const hide = css.indexOf(
    `:where([data-s-tab="talks"]) .${c},.${c}:where([data-s-tab="talks"]){display:none}`,
  )
  assert.ok(hide > phoneAt, 'hiding comes after the phone block')
  assert.ok(
    css.indexOf(
      `[data-s-tab="papers"]) .${c},.${c}:where([data-s-tab="papers"]){display:block}`,
    ) > phoneAt,
    "showing restores the kind's display",
  )
})

test('a reserved state name writes no selector', () => {
  const t = txt(
    't',
    {},
    { when: [{ state: 'open', is: 'a', decl: { color: 'brand' } }] },
  )
  assert.ok(
    !compileStyles({ ...page, children: [holder([t])] }, ctx()).css.includes(
      'data-s-open',
    ),
  )
})

test("a field's when paint reaches its control", () => {
  const f: Node = {
    id: 'f',
    kind: 'field',
    name: 'F',
    slot: {},
    props: { name: 'email' },
    style: { when: [{ state: 'tab', is: 'talks', decl: { bg: 'brand' } }] },
  }
  const { css, classOf } = compileStyles(
    { ...page, children: [holder([f])] },
    ctx(),
  )
  const control = classOf.get('f:control')!
  assert.match(
    css,
    new RegExp(
      `\\[data-s-tab="talks"\\]\\) \\.${control},[^{]*\\{[^}]*background`,
    ),
  )
})

test('a card surface under a look with edge, hard shadow and pill buttons reads the variables lookCss defines', () => {
  const tokens = {
    ...look,
    accent: '#ffcc00',
    edge: { width: 2 },
    shadow: 'hard',
    buttonShape: 'pill',
  } as Look
  const card: Node = {
    id: 'card',
    kind: 'box',
    name: 'C',
    slot: { x: 0, y: 0, w: 12, h: 4, z: 0 },
    style: { base: { surface: 'card', bg: 'accent', color: 'on-accent' } },
  }
  const btn: Node = {
    id: 'btn',
    kind: 'button',
    name: 'B',
    slot: { x: 12, y: 0, w: 6, h: 2, z: 0 },
    props: { label: 'Go', link: { url: '#' } },
    style: { base: { surface: 'button', label: true } },
  }
  const { css, classOf } = compileStyles(
    { ...page, children: [card, btn] },
    { ...ctx(), look: tokens },
  )
  const rule = (id: string) =>
    [...css.matchAll(new RegExp(`\\.${classOf.get(id)}\\{([^}]*)\\}`, 'g'))]
      .map(m => m[1])
      .join(';')
  assert.match(
    rule('card'),
    /border:var\(--s-edge-w,1px\) solid var\(--s-edge-c,var\(--s-line\)\);box-shadow:var\(--s-shadow,none\);border-radius:var\(--s-radius\)/,
  )
  assert.match(
    rule('card'),
    /background-color:var\(--s-accent,var\(--s-brand\)\);color:var\(--s-on-accent,var\(--s-bg\)\)/,
  )
  assert.match(
    rule('btn'),
    /border-radius:var\(--s-btn-radius,var\(--s-radius\)\)/,
  )
  assert.match(rule('btn'), /font-family:var\(--s-label,inherit\)/)
  const vars = lookCss(tokens)
  for (const v of [
    '--s-edge-w:2px',
    '--s-shadow:4px 4px 0 var(--s-ink)',
    '--s-btn-radius:999px',
    '--s-accent:#ffcc00',
    '--s-on-accent:#111111',
  ])
    assert.ok(vars.includes(v), v)
  assert.ok(
    !vars.includes('--s-edge-c'),
    'no edge colour set, so the line colour fallback applies',
  )
  assert.ok(
    css.startsWith(vars),
    "the look's variables are in the same stylesheet",
  )
})

test('a list aligned centre or end moves its rows as one block; a row list, or a layout back at the start, stays a flex list', () => {
  const list = (style: Node['style']): Node => ({
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    style,
    children: [{ id: 'r', kind: 'column', name: 'R', slot: {}, children: [] }],
  })
  const css = (style: Node['style']) =>
    compileStyles(
      { id: 'root', kind: 'box', name: 'P', slot: {}, children: [list(style)] },
      ctx(),
    ).css
  assert.match(
    css({ base: { align: 'center' } }),
    /display:grid;grid-template-columns:minmax\(0,max-content\);justify-content:center/,
  )
  assert.match(css({ base: { align: 'end' } }), /justify-content:end/)
  assert.doesNotMatch(
    css({ base: { align: 'center', direction: 'row' } }),
    /grid-template-columns:minmax/,
  )
  assert.doesNotMatch(
    css({ base: { align: 'start' } }),
    /grid-template-columns:minmax/,
  )
  assert.match(
    css({ base: { align: 'center' }, phone: { align: 'start' } }),
    /display:flex;align-items:start/,
  )
  // a wrapped row list that folds to a column on a phone moves as a block there, and not on desktop
  const folds = css({
    base: { align: 'center', direction: 'row', wrap: true },
    phone: { direction: 'column' },
  })
  assert.match(
    folds,
    /@media[^{]*\{[^}]*display:grid;grid-template-columns:minmax\(0,max-content\)/,
  )
})

const NEW_TILES = [
  'waves',
  'hexagons',
  'triangles',
  'zigzag',
  'scales',
  'topography',
  'circuit',
  'molecules',
  'cubes',
  'sparkles',
]
const patterned = (tile: string, color: 'brand' | 'ink' = 'brand'): Node => ({
  id: 'b',
  kind: 'box',
  name: 'B',
  slot: {},
  props: { pattern: { tile, color, strength: 20 } as never },
})

test("each new hero tile is its own SVG with the look's colour baked in", () => {
  const seen = new Set<string>()
  for (const tile of NEW_TILES) {
    const bg = /background:(url\("data:image\/svg\+xml,[^"]*"\)[^;}]*)/.exec(
      compileStyles(patterned(tile), ctx()).css,
    )?.[1]
    assert.ok(bg, tile)
    assert.ok(bg.includes('%232244aa'), `${tile} carries the brand hex`)
    seen.add(bg)
  }
  assert.equal(seen.size, NEW_TILES.length)
  assert.ok(
    /%23111111/.test(compileStyles(patterned('waves', 'ink'), ctx()).css),
    'ink pattern uses the ink hex',
  )
})

test('no pattern means no SVG data URI, no code text means no pre code rule', () => {
  assert.ok(!compileStyles(page, ctx()).css.includes('data:image/svg'))
  assert.ok(
    !compileStyles(patterned('dots'), ctx()).css.includes('data:image/svg'),
    'old tiles stay gradients',
  )
  assert.ok(!compileStyles(page, ctx()).css.includes('>code>span'))
})

test('a code text gets its box, and each colour its class with a dark rule for both schemes', () => {
  const code: Node = {
    id: 'c',
    kind: 'text',
    name: 'C',
    slot: {},
    props: {
      level: 'code',
      runs: [
        { text: 'x', style: { color: '#112233' }, dark: '#aabbcc' },
        { text: 'y', style: { color: '#112233' }, dark: '#aabbcc' },
      ],
    },
  }
  const { css, classOf } = compileStyles({ ...page, children: [code] }, ctx())
  assert.match(
    css,
    /font-family:ui-monospace[^}]*overflow-x:auto[^}]*padding:16px[^}]*border-radius:var\(--s-radius\)/,
  )
  assert.equal(classOf.get('code:#112233|#aabbcc'), 'k0')
  assert.equal(
    css.split('.k0{color:#112233}').length,
    2,
    'one rule for a colour pair used twice',
  )
  assert.match(css, /:where\(\.s-site\.s-scheme-dark\) \.k0\{color:#aabbcc\}/)
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\)\{:where\(\.s-site\.s-scheme-auto\) \.k0\{color:#aabbcc\}/,
  )
})

test('a code text adds no run classes, and the largest tile stays under 1,100 bytes', () => {
  const code: Node = {
    id: 'c',
    kind: 'text',
    name: 'C',
    slot: {},
    props: {
      level: 'code',
      runs: [{ text: 'x', style: { color: '#112233' } }],
    },
  }
  assert.ok(
    ![
      ...compileStyles({ ...page, children: [code] }, ctx()).classOf.keys(),
    ].includes('c:run0'),
  )
  const sizes = NEW_TILES.map(
    t =>
      [
        t,
        Buffer.byteLength(
          /background:([^;}]*)/.exec(
            compileStyles(patterned(t), ctx()).css,
          )![1],
        ),
      ] as const,
  )
  assert.ok(Math.max(...sizes.map(x => x[1])) < 1100)
})

test('a light/dark image pair: exactly one shows in light, dark and auto-dark, on desktop and phone', () => {
  const img = (id: string, style: Node['style']): Node => ({
    id,
    kind: 'image',
    name: id,
    slot: {},
    props: {},
    style,
  })
  const t: Node = {
    ...page,
    children: [
      img('a', { dark: { hidden: true } }),
      img('b', { base: { hidden: true }, dark: { hidden: false } }),
    ],
  }
  const { css, classOf } = compileStyles(t, ctx())
  // split the sheet into [media, selector, declarations] in source order (media is "" at top level)
  const rules: [string, string, string][] = []
  const read = (src: string, media: string) => {
    for (let i = 0; i < src.length;) {
      const o = src.indexOf('{', i)
      if (o < 0) break
      let d = 1,
        j = o + 1
      while (d && j < src.length) {
        d += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0
        j++
      }
      const head = src.slice(i, o).trim(),
        body = src.slice(o + 1, j - 1)
      if (head.startsWith('@media')) read(body, head)
      else rules.push([media, head, body])
      i = j
    }
  }
  read(css, '')
  const shown = (
    id: string,
    scheme: 'light' | 'dark' | 'auto-dark',
    phone: boolean,
  ) => {
    let display = ''
    for (const [media, sel, body] of rules) {
      if (media.includes('max-width') && !phone) continue
      if (media.includes('prefers-color-scheme') && scheme !== 'auto-dark')
        continue
      for (const one of sel.split(',')) {
        if (!one.endsWith(`.${classOf.get(id)}`)) continue
        if (one.includes('s-scheme-dark') && scheme !== 'dark') continue
        if (one.includes('s-scheme-auto') && scheme !== 'auto-dark') continue
        display = /display:([a-z-]+)/.exec(body)?.[1] ?? display
      }
    }
    return display !== 'none'
  }
  for (const scheme of ['light', 'dark', 'auto-dark'] as const)
    for (const phone of [false, true]) {
      assert.deepEqual(
        [shown('a', scheme, phone), shown('b', scheme, phone)],
        scheme === 'light' ? [true, false] : [false, true],
        `${scheme}${phone ? ' phone' : ''}`,
      )
    }
})

// Carried from look.test.ts

const cx = (styles?: SiteStyles) => ({
  ...ctx(),
  ...(styles ? { styles } : {}),
})
const ltxt = (id: string, props: Node['props'], base?: object): Node => ({
  id,
  kind: 'text',
  name: id,
  slot: {},
  props: { level: 'p', runs: [], ...props },
  ...(base ? { style: { base } } : {}),
})
const lpage = (...children: Node[]): Node => ({
  id: 'root',
  kind: 'free',
  name: 'P',
  slot: {},
  children,
})
const styles = (): SiteStyles => ({
  ...defaultSiteStyles(look),
  colors: [{ id: 'accent', name: 'Accent', value: '#ff8800' }],
})
test('a site colour compiles to one variable, used by var()', () => {
  const { css } = compileStyles(
    lpage(
      ltxt('a', {}, { color: { style: 'accent' } }),
      ltxt('b', {}, { bg: { style: 'accent' } }),
    ),
    cx(styles()),
  )
  assert.equal(css.split('--s-c-accent:#ff8800').length, 2)
  assert.match(css, /color:var\(--s-c-accent\)/)
  assert.match(css, /background-color:var\(--s-c-accent\)/)
  assert.match(css, /s-scheme-dark\{--s-c-accent:#[0-9a-f]{6}\}/)
})

test('changing Body changes every linked text', () => {
  const tree = lpage(
    ltxt('a', { textStyle: 'body' }),
    ltxt('b', { textStyle: 'body' }, { size: 30 }),
  )
  const one = compileStyles(tree, cx(styles()))
  assert.notEqual(one.classOf.get('a'), one.classOf.get('b'))
  assert.match(
    one.css,
    new RegExp(`\\.${one.classOf.get('a')}\\{[^}]*font-size:16px`),
  )
  assert.match(
    one.css,
    new RegExp(`\\.${one.classOf.get('b')}\\{[^}]*font-size:30px`),
  )
  const s = styles()
  s.text = s.text.map(t =>
    t.id === 'body' ? { ...t, decl: { ...t.decl, size: 18 } } : t,
  )
  const two = compileStyles(tree, cx(s))
  assert.match(
    two.css,
    new RegExp(`\\.${two.classOf.get('a')}\\{[^}]*font-size:18px`),
  )
  assert.match(
    two.css,
    new RegExp(`\\.${two.classOf.get('b')}\\{[^}]*font-size:30px`),
  )
})

test('a missing text style is ignored at render', () => {
  const bare = compileStyles(lpage(ltxt('a', {})), cx(styles()))
  const { css, classOf } = compileStyles(
    lpage(ltxt('a', { textStyle: 'nope' })),
    cx(styles()),
  )
  assert.equal(css, bare.css)
  assert.equal(classOf.get('a'), bare.classOf.get('a'))
})

test('gap {step:"l"} is var(--s-space-l), written once, even with no site styles', () => {
  const tree = lpage(
    ltxt('a', {}, { padding: [{ step: 's' }, 4, { step: 's' }, 4] }),
    {
      id: 'r',
      kind: 'row',
      name: 'R',
      slot: {},
      style: { base: { gap: { step: 'l' } } },
    },
  )
  for (const c of [cx(), cx(styles())]) {
    const { css } = compileStyles(tree, c)
    assert.match(css, /gap:var\(--s-space-l\)/)
    assert.match(css, /padding:var\(--s-space-s\) 4px var\(--s-space-s\) 4px/)
    assert.match(css, /--s-space-l:20px/)
    assert.match(css, /--s-space-s:8px/)
    assert.ok(!css.includes('--s-space-xl:'), 'unused steps are not written')
  }
})

test('a site shadow compiles to a variable', () => {
  const { css } = compileStyles(
    lpage(ltxt('a', {}, { shadow: { style: 'soft' } })),
    cx(styles()),
  )
  assert.match(css, /box-shadow:var\(--s-sh-soft\)/)
  assert.match(css, /--s-sh-soft:0 2px 8px rgb\(0 0 0 \/ 0\.12\)/)
})

test('old page renders identically: no styles, no new variables', () => {
  const tree = lpage(ltxt('a', {}, { padding: 8, shadow: 'soft' }))
  const { css } = compileStyles(tree, cx())
  assert.equal(css, compileStyles(tree, cx(styles())).css)
  assert.ok(!/--s-(c|space|sh)-/.test(css))
  assert.equal(lookCss(look), lookCss(look, styles(), ''))
})

// New in Culm: the class prefix, class numbering, and kinds the core does not know.
const three = (): Node => ({
  id: 'root',
  kind: 'box',
  name: 'R',
  slot: {},
  children: [
    txt('a', {}, { base: { padding: 4 } }),
    txt('b', {}, { base: { padding: 8 } }),
    txt('c', {}, { base: { padding: 4 } }),
  ],
})

test('class names are c plus a base-36 counter in first-seen order, shared by equal rule sets', () => {
  const { classOf } = compileStyles(three(), ctx())
  assert.deepEqual(
    ['a', 'b', 'c'].map(id => classOf.get(id)),
    ['c0', 'c1', 'c0'],
  )
  const many: Node = {
    id: 'root',
    kind: 'box',
    name: 'R',
    slot: {},
    children: Array.from({ length: 40 }, (_, i) =>
      txt(`t${i}`, {}, { base: { padding: i + 1 } }),
    ),
  }
  const out = compileStyles(many, ctx()).classOf
  assert.equal(out.get('t9'), 'c9')
  assert.equal(out.get('t10'), 'ca')
  assert.equal(out.get('t35'), 'cz')
  assert.equal(out.get('t36'), 'c10')
})

test('a prefix is put before every class name', () => {
  const plain = compileStyles(three(), ctx())
  const { css, classOf } = compileStyles(three(), { ...ctx(), prefix: 'abc' })
  assert.deepEqual(
    ['a', 'b', 'c'].map(id => classOf.get(id)),
    ['pabc-c0', 'pabc-c1', 'pabc-c0'],
  )
  assert.ok(css.includes('.pabc-c0{padding:4px}'))
  assert.equal(css.replaceAll('pabc-c', 'c'), plain.css)
  assert.equal(
    compileStyles(three(), { ...ctx(), prefix: '' }).css,
    plain.css,
    'an empty prefix is no prefix',
  )
})

test('a node id as prefix: . is written _ and ~ is written -; any other character throws', () => {
  const cases: [string, string][] = [
    ['abc', 'pabc-c0'],
    ['abc.title', 'pabc_title-c0'],
    ['abc.item~2', 'pabc_item-2-c0'],
    ['1x', 'p1x-c0'],
  ]
  for (const [prefix, cls] of cases) {
    const { css, classOf } = compileStyles(three(), { ...ctx(), prefix })
    assert.equal(classOf.get('a'), cls, prefix)
    assert.ok(css.includes(`.${cls}{padding:4px}`), prefix)
    assert.match(classOf.get('a')!, /^[a-zA-Z_-][a-zA-Z0-9_-]*$/, prefix)
  }
  for (const bad of ['a b', 'A', 'a-b', 'a_b', 'a"{}', 'a/b', 'é'])
    assert.throws(
      () => compileStyles(three(), { ...ctx(), prefix: bad }),
      RangeError,
      bad,
    )
})

test('prefixes that used to collide give different names', () => {
  const name = (prefix: string, id = 'a') =>
    compileStyles(three(), { ...ctx(), prefix }).classOf.get(id)
  assert.notEqual(name('a~1'), name('a.1'))
  assert.notEqual(name('1'), name('p1'))
  // a root id `c` cannot meet page class number 432, which is `cc0`
  const many: Node = {
    id: 'root',
    kind: 'box',
    name: 'R',
    slot: {},
    children: Array.from({ length: 440 }, (_, i) =>
      txt(
        `t${i}`,
        {},
        { base: { padding: (i % 20) + 1, margin: Math.floor(i / 20) + 1 } },
      ),
    ),
  }
  const names = (prefix?: string) =>
    new Set(compileStyles(many, { ...ctx(), prefix }).classOf.values())
  const unprefixed = names()
  assert.ok(unprefixed.has('cc0'))
  for (const c of names('c')) assert.ok(!unprefixed.has(c), c)
  // list counters: prefix a with item 12 and prefix a1 with item 2
  const counterOf = (prefix: string, at: number) => {
    const kids: Node[] = Array.from({ length: at }, (_, i) =>
      txt(`t${i}`, {}, { base: { padding: i + 1 } }),
    )
    const t: Node = {
      id: 'root',
      kind: 'box',
      name: 'R',
      slot: {},
      children: [
        ...kids,
        {
          id: 'l',
          kind: 'list',
          name: 'L',
          slot: {},
          props: { marker: 'decimal' },
          children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
        },
      ],
    }
    return /counter-reset:(\S+) 0/.exec(
      compileStyles(t, { ...ctx(), prefix }).css,
    )![1]
  }
  assert.notEqual(counterOf('a', 12), counterOf('a1', 2))
  assert.equal(counterOf('a', 3), 'pa-s3')
})

test('a prefix reaches code colour classes and list counters, which stay apart between prefixes', () => {
  const tree: Node = {
    ...page,
    children: [
      {
        id: 'l',
        kind: 'list',
        name: 'L',
        slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
        props: { marker: 'decimal' },
        children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
      },
      {
        id: 'c',
        kind: 'text',
        name: 'C',
        slot: {},
        props: {
          level: 'code',
          runs: [{ text: 'x', style: { color: '#112233' } }],
        },
      },
    ],
  }
  const a = compileStyles(tree, { ...ctx(), prefix: 'a.x' })
  const b = compileStyles(tree, { ...ctx(), prefix: 'b.x' })
  assert.equal(a.classOf.get('code:#112233|'), 'pa_x-k0')
  assert.ok(a.css.includes('.pa_x-k0{color:#112233}'))
  const counter = (r: typeof a) => /counter-reset:(\S+) 0/.exec(r.css)![1]
  assert.notEqual(counter(a), counter(b))
})

test('a kind the core does not know writes no rules and does not stop the walk', () => {
  const t: Node = {
    id: 'root',
    kind: 'box',
    name: 'R',
    slot: {},
    children: [
      {
        id: 'x',
        kind: 'plugin-thing',
        name: 'X',
        slot: {},
        style: { base: { padding: 4 } },
        children: [txt('inside', {}, { base: { padding: 8 } })],
      },
    ],
  }
  const { css, classOf } = compileStyles(t, ctx())
  assert.equal(classOf.has('x'), false)
  assert.ok(classOf.has('inside'))
  assert.ok(css.includes('padding:8px'))
})

test('a plug-in kind in the context is styled like any node: its class, its layers and every rule its parent gives', () => {
  const kinds = new Map([['callout', { ...KINDS.box, label: 'Callout' }]])
  const callout = (
    id: string,
    slot: Node['slot'],
    extra: Partial<Node> = {},
  ): Node => ({
    id,
    kind: 'callout',
    name: id,
    slot,
    style: { base: { padding: 4 } },
    ...extra,
  })
  const t: Node = {
    id: 'root',
    kind: 'free',
    name: 'P',
    slot: {},
    children: [
      callout('f', { x: 2, y: 1, w: 6, h: 3, z: 4 }, { hide: { phone: true } }),
      {
        id: 'r',
        kind: 'row',
        name: 'R',
        slot: { x: 0, y: 5, w: 24, h: 2, z: 0 },
        children: [callout('g', { grow: 2, align: 'end' })],
      },
    ],
  }
  const { css, classOf } = compileStyles(t, { ...ctx(), kinds })
  const rule = (id: string) =>
    new RegExp(`\\.${classOf.get(id)}\\{([^}]*)\\}`).exec(css)![1]
  assert.match(
    rule('f'),
    /grid-column:3 \/ span 6;grid-row:2 \/ span 3;z-index:4/,
  )
  assert.match(rule('f'), /padding:4px/)
  assert.match(
    phoneOf(css),
    new RegExp(`\\.${classOf.get('f')}\\{[^}]*display:none`),
  )
  assert.match(rule('g'), /flex:2 1 0%/)
  assert.match(rule('g'), /align-self:end/)
  assert.match(rule('g'), /padding:4px/)
  // in neither table: nothing
  const none = compileStyles(t, ctx())
  assert.equal(none.classOf.has('f'), false)
  assert.equal(none.classOf.has('g'), false)
})

const HOSTILE = 'cover;background:url(//x)'
const clean = (css: string, ...also: string[]) => {
  for (const bad of ['url(', 'background:url', '//x', ...also])
    assert.ok(!css.includes(bad), `${bad} in ${css.slice(0, 300)}`)
}

test('only checked values reach the stylesheet: image fit, slot align, grow and basis', () => {
  const img = (fit: unknown): Node => ({
    id: 'im',
    kind: 'image',
    name: 'I',
    slot: {},
    props: { fit: fit as never },
  })
  clean(compileStyles(img(HOSTILE), ctx()).css)
  assert.ok(compileStyles(img('cover'), ctx()).css.includes('object-fit:cover'))
  const child = (slot: object): Node => ({
    id: 'r',
    kind: 'row',
    name: 'R',
    slot: {},
    children: [txt('c', slot)],
  })
  clean(compileStyles(child({ align: 'end;background:url(//x)' }), ctx()).css)
  clean(compileStyles(child({ grow: '1;background:url(//x)' }), ctx()).css)
  clean(compileStyles(child({ grow: Number.NaN }), ctx()).css, 'NaN')
  clean(
    compileStyles(
      child({ grow: 1, basis: { n: '1;background:url(//x)', unit: 'px' } }),
      ctx(),
    ).css,
  )
  clean(
    compileStyles(
      child({ grow: 1, basis: { n: 1, unit: 'px;background:url(//x)' } }),
      ctx(),
    ).css,
  )
})

test('only checked values reach the stylesheet: grid and free slots, column counts', () => {
  const evil = '2;background:url(//x)'
  const grid = (props: object, slot: object): Node => ({
    id: 'g',
    kind: 'grid',
    name: 'G',
    slot: {},
    props: props as never,
    children: [
      {
        id: 'k',
        kind: 'box',
        name: 'K',
        slot,
        style: { base: { padding: 1 } },
      },
    ],
  })
  for (const css of [
    compileStyles(
      grid(
        { cols: evil, tabletCols: evil, phoneCols: evil },
        { cols: evil, rows: evil },
      ),
      ctx(),
    ).css,
    compileStyles(
      grid(
        { cols: 4, tabletCols: Number.NaN, phoneCols: 0.5 },
        { cols: 3, rows: -1 },
      ),
      ctx(),
    ).css,
    compileStyles(
      grid({ cols: Infinity, tabletCols: 2, phoneCols: 1 }, { cols: Infinity }),
      ctx(),
    ).css,
  ]) {
    clean(css, 'NaN', 'Infinity', 'span -', '0.5')
  }
  clean(
    compileStyles(
      {
        id: 'f',
        kind: 'free',
        name: 'F',
        slot: {},
        props: { cols: evil } as never,
      },
      ctx(),
    ).css,
  )
  const free = (slot: object, extra: Partial<Node> = {}): Node => ({
    id: 'f',
    kind: 'free',
    name: 'F',
    slot: {},
    children: [
      txt('c', slot, { base: { z: 1 } }),
      ...([extra].filter(() => false) as Node[]),
    ],
  })
  for (const slot of [
    { x: evil, y: 0, w: 4, h: 2, z: 0 },
    { x: 0, y: 0, w: 4, h: 2, z: evil },
    {
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      z: 0,
      tablet: { x: evil, y: 0, w: 4, h: 2, z: 0 },
    },
  ])
    clean(compileStyles(free(slot), ctx('edit')).css, 'Infinity')
})

test('only checked values reach the stylesheet: placement, list start, pattern keywords, run styles', () => {
  const evil = '4;background:url(//x)'
  const placed = (placement: object): Node => ({
    id: 'f',
    kind: 'free',
    name: 'F',
    slot: {},
    children: [
      {
        ...txt('c', { x: 0, y: 0, w: 4, h: 2, z: 0 }),
        placement: placement as never,
      },
    ],
  })
  for (const placement of [
    {
      mode: 'front',
      x: evil,
      y: evil,
      tablet: { x: evil },
      phone: { y: evil },
    },
    { mode: 'behind', x: Number.NaN, y: Infinity },
    { mode: 'wrap-start;background:url(//x)' },
    { mode: 42 },
  ])
    clean(compileStyles(placed(placement), ctx('edit')).css, 'NaN', 'Infinity')
  const list: Node = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    props: { marker: 'decimal', start: evil as never },
    children: [{ id: 'i', kind: 'box', name: 'I', slot: {} }],
  }
  clean(compileStyles(list, ctx()).css)
  for (const key of [
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
  ]) {
    const box: Node = {
      id: 'b',
      kind: 'box',
      name: 'B',
      slot: {},
      props: {
        pattern: {
          tile: key,
          color: 'ink',
          strength: 20,
          fade: key,
          density: key,
        },
      } as never,
    }
    for (const dir of [undefined, 'rtl'] as const) {
      const css = compileStyles(box, { ...ctx(), dir }).css
      assert.ok(!css.includes('function'), css.slice(0, 200))
      assert.ok(!css.includes('[object'), key)
    }
  }
  const text: Node = {
    id: 't',
    kind: 'text',
    name: 'T',
    slot: {},
    props: {
      level: 'p',
      runs: [
        {
          text: 'a',
          style: {
            color: 'red;background:url(//x)',
            bg: 'x}body{display:none',
            radius: evil,
            size: evil,
          },
        },
      ],
    } as never,
  }
  const css = compileStyles(text, ctx()).css
  clean(css, 'body{display:none')
})

test('a kind such as constructor or toString is not read as a default rule', () => {
  for (const kind of ['constructor', 'toString', '__proto__']) {
    const kinds = new Map([[kind, { ...KINDS.box }]])
    const t: Node = {
      id: 'n',
      kind,
      name: 'N',
      slot: {},
      style: { base: { padding: 4 } },
    }
    const { css } = compileStyles(t, { ...ctx(), kinds })
    assert.ok(css.includes('padding:4px'), kind)
    assert.ok(!css.includes('undefined'), kind)
  }
})

test('the base rules hold nothing for a kind core does not have', () => {
  assert.ok(!BASE_CSS.includes('.s-search'))
})

test('a phone layer with nowrap false undoes a base nowrap; a base nowrap false writes nothing', () => {
  const css = (style: object) =>
    compileFor({
      kind: 'text',
      props: { level: 'p', runs: [{ text: 'x' }] },
      style,
    })
  const on = css({ base: { nowrap: true }, phone: { nowrap: false, size: 28 } })
  assert.match(on, /white-space:nowrap/)
  assert.match(on, /@media \(max-width: 600px\)\{[^]*white-space:normal/)
  assert.doesNotMatch(css({ base: { nowrap: false } }), /white-space/)
})
