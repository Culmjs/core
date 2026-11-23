import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  apply,
  applySetting,
  catalogue,
  compilePage,
  createRegistry,
  emptySite,
  insertBlock,
  memoryStore,
  readSettings,
  validateSite,
  walk,
  type BlockDef,
  type Node,
  type Plugin,
  type PropValue,
  type Setting,
} from '@culmjs/core'
import starter, { LOOK, STYLES } from '../src/index.ts'

const BLOCKS = starter.blocks!
const data: Plugin = {
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
    { name: 'links', fields: { name: 'text', link: 'text' }, sample: [] },
    {
      name: 'menu2',
      fields: { name: 'text', text: 'text', price: 'text', image: 'text' },
      sample: [],
    },
    { name: 'links2', fields: { name: 'text', link: 'text' }, sample: [] },
  ],
}
const reg = createRegistry()
reg.use(starter)
reg.use(data)
const cases = BLOCKS.flatMap(b => b.looks.map(l => [b, l.id] as const))

const MENU = [
  { name: 'Rye loaf', text: 'Slow dough.', price: '6', image: '/a.svg' },
  { name: 'Bun', text: 'Soft.', price: '3', image: '/b.svg' },
  { name: 'Tart', text: 'Lemon.', price: '5', image: '/c.svg' },
  { name: 'Roll', text: 'Seeded.', price: '2', image: '/d.svg' },
]
const LINKS = [
  { name: 'Menu', link: 'https://example.com/menu' },
  { name: 'Visit', link: 'https://example.com/visit' },
]

const siteWith = (root: Node) => {
  const doc = emptySite('Test', LOOK)
  doc.styles = STYLES
  doc.pages[0].root = { ...doc.pages[0].root, children: [root] }
  return doc
}
const insert = (b: BlockDef, look: string, id = 'abc'): Node => {
  const r = insertBlock(reg, b.id, look, id)
  assert.ok(r.ok, `${b.id}/${look}`)
  return r.root
}
const set = (root: Node, key: string, v: PropValue): Node => {
  const r = applySetting(reg, root, key, v)
  assert.ok(r.ok, `${root.origin?.block}/${key}=${String(v)}`)
  return r.root
}
const page = (root: Node, rows: Record<string, readonly object[]> = {}) =>
  compilePage(siteWith(root), 'home', {
    registry: reg,
    data: { rows: { menu: MENU, links: LINKS, ...rows } as never },
  })
const body = (root: Node, rows?: Record<string, readonly object[]>) => {
  const r = page(root, rows)
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r.html.slice(r.html.indexOf('<body'))
}
const wordsOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const valuesFor = (s: Setting, block: string): PropValue[] =>
  s.key === 'source'
    ? [block === 'card-grid' ? 'menu2' : 'links2']
    : s.type === 'number'
      ? [s.min!, Math.round((s.min! + s.max!) / 2)]
      : s.type === 'switch'
        ? [true, false]
        : s.type === 'select'
          ? s.options!.map(o => o.value)
          : s.type === 'asset'
            ? ['file1']
            : s.type === 'link'
              ? [{ url: 'https://example.com/zq' }]
              : ['Zq']

const touches = (b: BlockDef, look: string, s: Setting) => {
  const root = insert(b, look)
  const ids = new Set<string>()
  walk(root, n => void ids.add(n.id))
  return (s.actions ?? []).some(a => {
    const targets =
      a.do === 'set'
        ? [a.path].flat()
        : a.do === 'choose'
          ? Object.values(a.options).flatMap(o => Object.keys(o.write ?? {}))
          : []
    return targets.some(t => ids.has(`${root.id}.${t.split('.')[0]}`))
  })
}

test('each block has a guide and two looks with the ids of the plan', () => {
  const plan: Record<string, [string, string[], string]> = {
    'page-header': ['navigation', ['bar', 'centered'], ''],
    'page-footer': ['navigation', ['simple', 'columns'], ''],
    hero: ['content', ['plain', 'image'], ''],
    'text-section': ['content', ['narrow', 'wide'], ''],
    'image-text': ['content', ['image-left', 'image-right'], ''],
    'card-grid': ['lists', ['cards', 'rows'], ''],
    'link-list': ['lists', ['plain', 'boxed'], ''],
    'call-to-action': ['content', ['band', 'card'], ''],
  }
  assert.deepEqual(
    BLOCKS.map(b => b.id),
    Object.keys(plan),
  )
  for (const b of BLOCKS) {
    assert.equal(b.category, plan[b.id][0], b.id)
    assert.deepEqual(
      b.looks.map(l => l.id),
      plan[b.id][1],
      b.id,
    )
    assert.ok(b.guide && b.guide.length <= 500, b.id)
  }
  assert.deepEqual(
    {
      name: starter.name,
      version: starter.version,
      api: starter.api,
      runs: starter.runs,
      trust: starter.trust,
    },
    {
      name: 'starter',
      version: 1,
      api: [1],
      runs: ['build'],
      trust: 'declarative',
    },
  )
})

test('setting keys, types and actions are the plan table', () => {
  const sig = (b: BlockDef) =>
    b.settings.map(
      s =>
        `${s.key}:${s.type}:${s
          .actions!.map(a =>
            a.do === 'set' ? `set ${[a.path].flat().join('+')}` : a.do,
          )
          .join(',')}`,
    )
  const hide = (n: string) => `set ${n}.style.base.hidden`
  const plan: Record<string, string[]> = {
    'page-header': [
      'siteName:text:set name.props.runs',
      `showButton:switch:${hide('button')}`,
      'buttonLabel:text:set button.props.label',
      'buttonLink:link:set button.props.link',
    ],
    'page-footer': [
      'note:text:set note.props.runs',
      `showMenu:switch:${hide('nav')}`,
    ],
    hero: [
      'title:text:set title.props.runs',
      'lead:textarea:set lead.props.runs',
      'buttonLabel:text:set button.props.label',
      'buttonLink:link:set button.props.link',
      'image:asset:set image.props.assetId',
      'align:select:choose',
    ],
    'text-section': [
      'heading:text:set heading.props.runs',
      'body:textarea:set body.props.runs',
    ],
    'image-text': [
      'heading:text:set heading.props.runs',
      'body:textarea:set body.props.runs',
      'image:asset:set image.props.assetId',
    ],
    'card-grid': [
      'heading:text:set heading.props.runs',
      'source:text:set list.repeat.source',
      'limit:number:set list.repeat.max',
      'columns:select:choose',
    ],
    'link-list': [
      'heading:text:set heading.props.runs',
      'source:text:set list.repeat.source',
    ],
    'call-to-action': [
      'heading:text:set heading.props.runs',
      'buttonLabel:text:set button.props.label',
      'buttonLink:link:set button.props.link',
    ],
  }
  assert.deepEqual(Object.fromEntries(BLOCKS.map(b => [b.id, sig(b)])), plan)
})

test('every look inserts and the page validates', () => {
  for (const [b, look] of cases)
    assert.deepEqual(
      validateSite(siteWith(insert(b, look)), reg),
      [],
      `${b.id}/${look}`,
    )
})

// A setting may have no node in a look only where the look leaves the part out by design.
const NO_TARGET = new Set(['hero/plain/image'])

test('every setting touches a node in every look, bar the listed ones, and reads back the value just applied', () => {
  for (const b of BLOCKS)
    for (const s of b.settings)
      assert.ok(
        b.looks.some(l => touches(b, l.id, s)),
        `${b.id}/${s.key} touches no node in any look`,
      )
  for (const [b, look] of cases)
    for (const s of b.settings) {
      const root = insert(b, look)
      const hit = touches(b, look, s)
      assert.equal(
        hit,
        !NO_TARGET.has(`${b.id}/${look}/${s.key}`),
        `${b.id}/${look}/${s.key}`,
      )
      for (const v of valuesFor(s, b.id)) {
        const next = set(root, s.key, v)
        if (hit)
          assert.deepEqual(
            readSettings(reg, next)[s.key],
            v,
            `${b.id}/${look}/${s.key}=${String(v)}`,
          )
        assert.deepEqual(
          validateSite(siteWith(next), reg),
          [],
          `${b.id}/${look}/${s.key}=${String(v)}`,
        )
      }
    }
})

test('no setting names a function and no block has onInsert', () => {
  for (const b of BLOCKS) {
    assert.equal(b.onInsert, undefined, b.id)
    for (const s of b.settings) {
      assert.equal(s.fn, undefined, `${b.id}/${s.key}`)
      assert.ok(s.actions?.length, `${b.id}/${s.key}`)
    }
  }
  for (const k of ['settingFns', 'kinds', 'rules'])
    assert.equal((starter as Record<string, unknown>)[k], undefined, k)
})

test('every look compiles within every ceiling and ships the base script only', () => {
  for (const [b, look] of cases)
    for (const full of [true, false]) {
      const r = page(insert(b, look), full ? {} : { menu: [], links: [] })
      assert.ok(r.ok, `${b.id}/${look}`)
      assert.deepEqual(r.problems, [])
      assert.deepEqual(
        r.scripts.map(s => s.name),
        ['base'],
      )
    }
})

test('every heading is required', () => {
  let seen = 0
  for (const [b, look] of cases)
    walk(insert(b, look), n => {
      if (n.kind === 'text' && /^h[1-6]$/.test(String(n.props?.level))) {
        seen++
        assert.equal(n.required, true, `${b.id}/${look}/${n.id}`)
      }
    })
  assert.ok(seen >= 7)
})

test('no look of page-header hides nav on any layout, and the nav is not required', () => {
  const header = BLOCKS.find(b => b.id === 'page-header')!
  for (const l of header.looks) {
    const root = insert(header, l.id)
    let found = false
    const visit = (n: Node, up: Node[]) => {
      if (n.id === `${root.id}.nav`) {
        found = true
        assert.equal(n.required, undefined) // the owner ruled it may be removed
        for (const a of [...up, n]) {
          assert.equal(a.hide, undefined, `${l.id}/${a.id} has hide`)
          const layers = Object.values(a.style ?? {}).flatMap(v =>
            Array.isArray(v) ? v.map(w => w.decl) : [v],
          )
          for (const d of layers)
            assert.notEqual(d?.hidden, true, `${l.id}/${a.id} hidden`)
        }
      }
      n.children?.forEach(c => visit(c, [...up, n]))
    }
    visit(root, [])
    assert.ok(found, l.id)
  }
})

test('every text size in every look is inside 11..96, and no look sets nowrap', () => {
  const range = STYLES.textRange!
  for (const t of STYLES.text)
    assert.ok(t.decl.size! >= range.min && t.decl.size! <= range.max)
  for (const [b, look] of cases)
    walk(insert(b, look), n => {
      const style = n.style ?? {}
      const decls = Object.values(style).flatMap(v =>
        Array.isArray(v) ? v.map(w => w.decl) : [v],
      )
      for (const d of decls) {
        if (!d) continue
        assert.equal(d.nowrap, undefined, `${b.id}/${look}/${n.id}`)
        if (d.size !== undefined)
          assert.ok(d.size >= range.min && d.size <= range.max)
      }
      const ts = n.props?.textStyle
      if (ts !== undefined)
        assert.ok(
          STYLES.text.some(t => t.id === ts),
          `${b.id}/${look}/${n.id} textStyle ${String(ts)}`,
        )
    })
})

test('card-grid bound to a source repeats one card per row and limit caps it', () => {
  const grid = BLOCKS.find(b => b.id === 'card-grid')!
  for (const l of grid.looks) {
    const out = body(insert(grid, l.id))
    for (const r of MENU) assert.match(out, new RegExp(r.name), l.id)
    const capped = body(set(insert(grid, l.id), 'limit', 2))
    assert.match(capped, /Rye loaf/)
    assert.match(capped, /Bun/)
    assert.doesNotMatch(capped, /Tart|Roll/)
    const other = body(set(insert(grid, l.id), 'source', 'menu2'), {
      menu2: [{ name: 'Elsewhere' }],
    })
    assert.match(other, /Elsewhere/)
    assert.doesNotMatch(other, /Rye loaf/)
  }
})

test('card-grid and link-list with zero rows compile to their heading alone', () => {
  for (const id of ['card-grid', 'link-list']) {
    const b = BLOCKS.find(x => x.id === id)!
    for (const l of b.looks) {
      const root = set(insert(b, l.id), 'heading', 'Our things')
      const out = body(root, { menu: [], links: [] })
      assert.equal(wordsOf(out), 'Our things', `${id}/${l.id}`)
      assert.equal((out.match(/<img/g) ?? []).length, 0)
      assert.equal((out.match(/<li/g) ?? []).length, 0)
    }
  }
})

test('a row with a missing field writes no "undefined" and no empty link', () => {
  const gaps = [
    { name: 'Only name' },
    { name: 'No link' },
    { link: 'https://example.com/x' },
    {},
    { name: 'Full', link: 'https://example.com/full' },
  ]
  const sparse = [
    { name: 'Bare' },
    { text: 'Only text' },
    { price: '9' },
    { image: '/z.svg' },
    {},
  ]
  for (const b of BLOCKS.filter(x => ['card-grid', 'link-list'].includes(x.id)))
    for (const l of b.looks) {
      const out = body(insert(b, l.id), { menu: sparse, links: gaps })
      for (const bad of ['undefined', 'null', 'NaN', '[object'])
        assert.ok(!out.includes(bad), `${b.id}/${l.id} wrote ${bad}`)
      assert.doesNotMatch(out, /href=""/, `${b.id}/${l.id}`)
      assert.doesNotMatch(out, /src=""/, `${b.id}/${l.id}`)
      assert.doesNotMatch(out, /<a[^>]*><\/a>/, `${b.id}/${l.id}`)
      assert.doesNotMatch(out, /<a(?![^>]*href="[^"])/, `${b.id}/${l.id}`)
      assert.doesNotMatch(out, /<li[^>]*><\/li>/, `${b.id}/${l.id} empty li`)
      // card-grid: only the row with a name; link-list: the three rows with a name
      const rows = b.id === 'card-grid' ? 1 : 3
      assert.equal(
        (out.match(/<li[ >]/g) ?? []).length,
        rows,
        `${b.id}/${l.id} li count`,
      )
    }
  const links = BLOCKS.find(b => b.id === 'link-list')!
  const out = body(insert(links, 'plain'), { links: gaps })
  assert.match(out, /Full/)
  assert.match(out, /href="https:\/\/example.com\/full"/)
  // a name without a link stays as plain words
  assert.match(out, /Only name/)
  assert.doesNotMatch(out, /href="[^"]*"[^>]*>(Only name|No link)/)
})

test('for each block, a batch of only its catalogue insert operation is accepted', async () => {
  for (const b of BLOCKS) {
    const store = memoryStore({ s: siteWith({ ...insert(b, b.looks[0].id) }) })
    const head = await store.head('s')
    assert.ok('doc' in head)
    const row = catalogue(reg, {
      what: 'blocks',
      id: b.id,
      site: head as never,
    })
    assert.ok(row.ok, b.id)
    const op = (row as unknown as { insert: never }).insert
    const r = await apply(store, reg, {
      site: 's',
      key: `k-${b.id}`,
      baseRevision: 0,
      ops: [op],
    })
    assert.ok(r.ok, `${b.id}: ${JSON.stringify(!r.ok && r.problems)}`)
  }
})

test('page-header and page-footer are version 2 and hold bar in a centred column of max width 1100, like section()', () => {
  for (const id of ['page-header', 'page-footer']) {
    const b = BLOCKS.find(x => x.id === id)!
    assert.equal(b.version, 2)
    for (const l of b.looks) {
      assert.equal(l.tree.style?.base?.align, 'center')
      const bar = l.tree.children!.find(c => c.id === 'bar')!
      assert.equal(bar.style?.base?.width, 'fill')
      assert.deepEqual(bar.style?.base?.maxWidth, { n: 1100, unit: 'px' })
    }
  }
})
