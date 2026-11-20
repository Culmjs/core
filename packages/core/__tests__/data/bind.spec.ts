import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_NODES,
  walk,
  type Component,
  type KindSpec,
  type Node,
  type Run,
} from '../../src/document/index.ts'
import { expand } from '../../src/data/index.ts'
import { unrollInstances } from '../../src/data/bind.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import type { Row } from '../../src/registry/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { LOOK } from '../kit.ts'
import { base, calloutPlugin, reg, site } from '../validate/helpers.ts'
import { createRegistry } from '../../src/registry/index.ts'

const project = (id: string, years: string, selected: boolean): Row => ({
  id,
  title: `T${id}`,
  years,
  selected,
  href: `https://x.org/${id}`,
  links: [{ label: `a${id}` }, { label: `b${id}` }],
})
const PROJECTS = [
  project('1', '2020', true),
  project('2', '2024', true),
  project('3', '2023', false),
]
const styles = defaultSiteStyles(LOOK)
const ctx = (
  rows: Record<string, readonly Row[]> = { projects: PROJECTS },
  more: { values?: Record<string, unknown>; components?: Component[] } = {},
) => ({
  data: { rows, values: more.values },
  components: more.components ?? [],
  fonts: [],
  styles,
})

const box = (
  id: string,
  children?: Node[],
  extra: Partial<Node> = {},
): Node => ({
  id,
  kind: 'box',
  name: id,
  slot: {},
  ...(children ? { children } : {}),
  ...extra,
})
const txt = (id: string, text: string, extra: Partial<Node> = {}): Node => ({
  id,
  kind: 'text',
  name: id,
  slot: {},
  props: { level: 'p', runs: [{ text }] },
  ...extra,
})
const bound = (id: string, field = 'title'): Node =>
  txt(id, '', {
    props: {
      level: 'p',
      runs: [
        {
          text: '',
          bind: { from: 'item', field },
          bindHref: { from: 'item', field: 'href' },
        },
      ],
    },
  })
const item: Node = box('it', [bound('t')])
const list = (repeat: object = {}, kids: Node[] = [item]): Node => ({
  id: 'l',
  kind: 'list',
  name: 'L',
  slot: {},
  repeat: {
    source: 'projects',
    filter: { field: 'selected', is: true },
    sort: { field: 'years', dir: 'desc' },
    max: 5,
    ...repeat,
  } as never,
  children: kids,
})
/** A list over `source` whose template is a box with `parts` text children, so a few rows are enough to pass the node limit. */
const listOver = (source: string, parts = 11): Node => ({
  id: 'l',
  kind: 'list',
  name: 'L',
  slot: {},
  repeat: { source },
  children: [
    box(
      'it',
      Array.from({ length: parts }, (_, i) => bound(`t${i}`)),
    ),
  ],
})
const runsOf = (w: Node) => w.props!.runs as Run[]

test('a list repeats its item over filtered, sorted rows with stable ids', () => {
  const { tree, count } = expand(list(), ctx())
  assert.deepEqual(
    tree.children!.map(c => c.id),
    ['it~0', 'it~1'],
  )
  const run = runsOf(tree.children![0].children![0])[0]
  assert.deepEqual([run.text, run.link], ['T2', { url: 'https://x.org/2' }])
  assert.equal(count, 5)
  assert.equal(tree.repeat, undefined)
})

test('a run whose words came from a field says so; your own words do not', () => {
  const mixed = box('it', [
    txt('t', '', {
      props: {
        level: 'p',
        runs: [
          { text: '', bind: { from: 'item', field: 'title' } },
          { text: ' · ' },
          { text: '' },
        ],
      },
    }),
  ])
  const { tree } = expand(list({ max: 1 }, [mixed]), ctx())
  assert.deepEqual(
    runsOf(tree.children![0].children![0]).map(r => [r.text, r.fromData]),
    [
      ['T2', true],
      [' · ', undefined],
      ['', undefined],
    ],
  )
})

test('showIf drops a node whose field is empty; so does a showIfAny whose fields are all empty', () => {
  const photo = (extra: Partial<Node>): Node => ({
    id: 'p',
    kind: 'image',
    name: 'P',
    slot: {},
    ...extra,
  })
  const kept = (n: Node, c = ctx()) =>
    expand(box('r', [n]), c).tree.children!.length
  assert.equal(kept(photo({ showIf: { from: 'site', field: 'photo' } })), 0)
  assert.equal(
    kept(
      photo({ showIf: { from: 'site', field: 'photo' } }),
      ctx(undefined, { values: { photo: 'a.png' } }),
    ),
    1,
  )
  const any = photo({
    showIf: { from: 'site', field: 'a' },
    showIfAny: [{ from: 'site', field: 'b' }],
  })
  assert.equal(kept(any), 0)
  assert.equal(kept(any, ctx(undefined, { values: { b: 'x' } })), 1)
})

test('a site reference reads the caller values by its whole dotted name', () => {
  const gated = (v: unknown) =>
    expand(
      box('r', [
        box('n', [], { showIf: { from: 'site', field: 'has.projects' } }),
      ]),
      ctx(undefined, {
        values: { 'has.projects': v, has: { projects: true } },
      }),
    ).tree.children!.length
  assert.equal(
    gated(false),
    0,
    'false hides it; the nested object is not walked',
  )
  assert.equal(gated(0), 0)
  assert.equal(gated(true), 1)
})

test('a site reference cannot reach the prototype', () => {
  const r = expand(
    box('r', [
      txt('t', '', {
        props: {
          level: 'p',
          runs: [{ text: '', bind: { from: 'site', field: 'constructor' } }],
        },
      }),
    ]),
    ctx(),
  )
  assert.equal(runsOf(r.tree.children![0])[0].text, '')
})

test('nested repeats are counted after expansion', () => {
  const inner: Node = { ...list({ filter: undefined, max: 200 }), id: 'in' }
  const outer: Node = {
    ...list({ filter: undefined, max: 200 }),
    id: 'out',
    children: [box('cell', [inner])],
  }
  const r = expand(outer, ctx())
  assert.equal(r.count, 1 + 3 * (2 + 3 * 2))
  assert.equal(r.depth, 5)
})

test('bound props, missing values last, and a table keeps its header rows and repeats its last', () => {
  const img: Node = {
    id: 'i',
    kind: 'image',
    name: 'I',
    slot: {},
    bind: { src: { from: 'item', field: 'title' } },
  }
  const row: Node = {
    id: 'r',
    kind: 'table-row',
    name: 'R',
    slot: {},
    children: [img],
  }
  const head: Node = {
    id: 'h',
    kind: 'table-row',
    name: 'H',
    slot: {},
    children: [],
  }
  const t: Node = {
    id: 'tb',
    kind: 'table',
    name: 'T',
    slot: {},
    repeat: { source: 'projects', sort: { field: 'years', dir: 'asc' } },
    children: [head, row],
  }
  const { tree } = expand(
    t,
    ctx({ projects: [...PROJECTS, { title: 'none' }] }),
  )
  assert.deepEqual(
    tree.children!.map(c => c.id),
    ['h', 'r~0', 'r~1', 'r~2', 'r~3'],
  )
  assert.deepEqual(
    tree.children!.slice(1).map(r => r.children![0].props!.src),
    ['T1', 'T3', 'T2', 'none'],
  )
})

test('a list that fits is not over the limit', () => {
  assert.equal(expand(list(), ctx()).over, false)
})

test('deeply nested repeats stop at the node limit', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ title: `P${i}` }))
  let w = box('leaf')
  for (const id of ['d', 'c', 'b', 'a'])
    w = {
      id,
      kind: 'list',
      name: id,
      slot: {},
      repeat: { source: 'projects', max: 200 },
      children: [w],
    }
  const r = expand(w, ctx({ projects: many }))
  assert.equal(r.over, true)
  assert.ok(r.count <= MAX_NODES)
})

test('10,000 rows stop at the node limit, quickly', () => {
  const big = Array.from({ length: 10_000 }, (_, i) => ({ title: String(i) }))
  const t0 = performance.now()
  const r = expand(listOver('projects'), ctx({ projects: big }))
  assert.equal(r.over, true)
  assert.ok(r.count <= MAX_NODES)
  assert.ok(performance.now() - t0 < 2000)
})

test('a list that ends exactly at the limit is not over', () => {
  const fits = Math.floor((MAX_NODES - 1) / 12)
  const rows = Array.from({ length: fits }, (_, i) => ({ title: String(i) }))
  const r = expand(listOver('projects'), ctx({ projects: rows }))
  assert.equal(r.over, false)
  assert.equal(r.count, 1 + fits * 12)
})

test('a bound field that is missing, null, an object, an array or not a finite number writes an empty text', () => {
  for (const title of [undefined, null, {}, [1], NaN, Infinity, -Infinity]) {
    const { tree } = expand(
      list({ filter: undefined }),
      ctx({ projects: [{ title }] }),
    )
    const run = runsOf(tree.children![0].children![0])[0]
    assert.equal(run.text, '', String(title))
    assert.equal(run.link, undefined)
    const s = JSON.stringify(tree)
    for (const word of [
      'undefined',
      'null',
      '[object Object]',
      'NaN',
      'Infinity',
    ])
      assert.ok(!s.includes(word), `${String(title)} wrote ${word}`)
  }
  const ok = expand(
    list({ filter: undefined }),
    ctx({ projects: [{ title: 0 }, { title: false }] }),
  )
  assert.deepEqual(
    ok.tree.children!.map(c => runsOf(c.children![0])[0].text),
    ['0', 'false'],
  )
})

test('a bound prop keeps a string, a finite number or a boolean; a link takes a url; anything else is empty', () => {
  const at = (v: unknown) =>
    expand(
      box('r', [
        {
          id: 'b',
          kind: 'button',
          name: 'B',
          slot: {},
          props: { label: 'x' },
          bind: {
            label: { from: 'site', field: 'v' },
            link: { from: 'site', field: 'v' },
          },
        },
      ]),
      ctx(undefined, { values: { v } }),
    ).tree.children![0].props!
  assert.deepEqual(at('https://x.org'), {
    label: 'https://x.org',
    link: { url: 'https://x.org' },
  })
  assert.equal(at(5).label, 5)
  assert.equal(at(false).label, false)
  for (const v of [undefined, null, {}, [1], NaN, Infinity]) {
    const props = at(v)
    assert.deepEqual([props.label, props.link], ['', { url: '' }], String(v))
  }
})

test('a list of plain values repeats the strings and numbers in it as { value } and skips the rest', () => {
  const val: Node = box('v', [bound('t', 'value')])
  const inner: Node = {
    id: 'in',
    kind: 'list',
    name: 'In',
    slot: {},
    repeat: { source: { from: 'item', field: 'tags' } },
    children: [val],
  }
  const out = (tags: unknown) =>
    expand(
      list({ filter: undefined, max: 1 }, [box('it', [inner])]),
      ctx({ projects: [{ tags }] }),
    ).tree.children![0].children![0].children!.map(
      c => runsOf(c.children![0])[0].text,
    )
  assert.deepEqual(out(['a', 1, null, ['x'], 'b', NaN, true]), ['a', '1', 'b'])
  assert.deepEqual(out('abc'), [])
  assert.deepEqual(out(undefined), [])
})

test('a bind to a key that could reach the prototype writes nothing', () => {
  const evil: Node = box('e', [], {
    bind: { ['__proto__']: { from: 'site', field: 'v' } },
  })
  const { tree } = expand(
    box('r', [evil]),
    ctx(undefined, { values: { v: 'x' } }),
  )
  assert.equal(
    Object.getPrototypeOf(tree.children![0].props ?? {}),
    Object.prototype,
  )
  assert.equal(({} as Record<string, unknown>).x, undefined)
})

test('a list over a source with no rows keeps the list node and has no items', () => {
  const r = expand(list(), ctx({}))
  assert.equal(r.tree.id, 'l')
  assert.deepEqual(r.tree.children, [])
  assert.equal(r.count, 1)
  assert.equal(
    expand(list({ source: 'constructor' }), ctx({})).tree.children!.length,
    0,
  )
})

test('a nested list repeats over the item own collection, and outer: 1 reads the enclosing row', () => {
  const link: Node = box('lk', [
    txt('who', '', {
      props: {
        level: 'p',
        runs: [
          { text: '', bind: { from: 'item', field: 'label' } },
          { text: '', bind: { from: 'item', field: 'title', outer: 1 } },
        ],
      },
    }),
  ])
  const inner: Node = {
    id: 'in',
    kind: 'list',
    name: 'In',
    slot: {},
    repeat: { source: { from: 'item', field: 'links' } },
    children: [link],
  }
  const { tree } = expand(list({ max: 1 }, [box('it', [inner])]), ctx())
  const cells = tree.children![0].children![0].children!
  assert.deepEqual(
    cells.map(c => c.id),
    ['lk~0~0', 'lk~1~0'],
  )
  assert.deepEqual(
    cells.map(c => runsOf(c.children![0]).map(r => r.text)),
    [
      ['a2', 'T2'],
      ['b2', 'T2'],
    ],
  )
  const none = expand(
    list({ filter: undefined, max: 1 }, [box('it', [inner])]),
    ctx({ projects: [{ title: 'x' }, { title: 'y', links: 7 }] }),
  )
  assert.deepEqual(none.tree.children![0].children![0].children, [])
})

test('a marker on the repeat is written to the list; a list with its own marker keeps it', () => {
  assert.equal(
    expand(list({ marker: 'disc' }), ctx()).tree.props!.marker,
    'disc',
  )
  const own = { ...list({ marker: 'disc' }), props: { marker: 'none' } }
  assert.equal(expand(own, ctx()).tree.props!.marker, 'none')
})

// ---- components ----
const card: Component = {
  id: 'project-card',
  name: 'Project card',
  root: box(
    'root',
    [
      txt('title', 'Title'),
      txt('badge', 'Old'),
      { id: 'body', kind: 'column', name: 'Body', slot: {} },
    ],
    { style: { base: { padding: 8 } } },
  ),
  props: [
    {
      key: 'look',
      label: 'Look',
      type: 'choice',
      options: ['default', 'featured'],
      default: 'default',
    },
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      part: 'title',
      field: 'text',
    },
    { key: 'content', label: 'Content', type: 'slot', part: 'body' },
  ],
  variants: [
    {
      when: { look: 'featured' },
      patch: {
        root: { style: { base: { bg: 'brand' } } },
        badge: { hide: { phone: true } },
      },
    },
  ],
}
const wrap: Component = {
  id: 'wrap',
  name: 'Wrap',
  root: box('root', [
    {
      id: 'in',
      kind: 'instance',
      name: 'In',
      slot: {},
      component: 'project-card',
    },
  ]),
  props: [],
  variants: [],
}
const inst = (extra: Partial<Node> = {}): Node => ({
  id: 'c1',
  kind: 'instance',
  name: 'Card',
  slot: { grow: 1 },
  component: 'project-card',
  ...extra,
})
const page = (...kids: Node[]) => box('pg', kids)
const withC = (...components: Component[]) => ctx(undefined, { components })

test('an instance unrolls to the master tree', () => {
  const { tree, count } = expand(
    page(inst({ set: { title: 'Hello' }, hide: { tablet: true } })),
    withC(card),
  )
  const c = tree.children![0]
  assert.deepEqual(
    [c.id, c.kind, c.slot, c.hide, c.component],
    ['c1', 'box', { grow: 1 }, { tablet: true }, undefined],
  )
  assert.deepEqual(
    c.children!.map(k => k.id),
    ['c1.title', 'c1.badge', 'c1.body'],
  )
  assert.deepEqual(runsOf(c.children![0]), [{ text: 'Hello' }])
  assert.equal(count, 5)
})

test('the featured look applies only its patch, and an unknown look falls back to the default', () => {
  const plain = expand(page(inst()), withC(card)).tree.children![0]
  const featured = expand(
    page(
      inst({
        set: { look: 'featured' },
        overrides: { badge: { props: { runs: [{ text: 'New' }] } } },
      }),
    ),
    withC(card),
  ).tree.children![0]
  assert.equal(plain.style!.base!.bg, undefined)
  assert.deepEqual(
    [
      featured.style!.base,
      featured.children![1].hide,
      runsOf(featured.children![1]),
    ],
    [{ padding: 8, bg: 'brand' }, { phone: true }, [{ text: 'New' }]],
  )
  assert.equal(plain.children![1].hide, undefined)
  const unknown = expand(page(inst({ set: { look: 'gone' } })), withC(card))
    .tree.children![0]
  assert.equal(unknown.style!.base!.bg, undefined)
})

test('an override on a removed part is dropped', () => {
  const { tree } = expand(
    page(
      inst({
        overrides: {
          ghost: { props: { runs: [{ text: 'X' }] } },
          badge: { props: { runs: [{ text: 'Kept' }] } },
        },
      }),
    ),
    withC(card),
  )
  assert.deepEqual(
    tree.children![0].children!.map(k => k.id),
    ['c1.title', 'c1.badge', 'c1.body'],
  )
  assert.deepEqual(runsOf(tree.children![0].children![1]), [{ text: 'Kept' }])
})

test('slot children fill the slot part, and components nest', () => {
  const { tree } = expand(
    page(inst({ children: [txt('extra', 'Hi')] }), {
      ...inst({ id: 'w1' }),
      component: 'wrap',
    }),
    withC(card, wrap),
  )
  assert.deepEqual(
    tree.children![0].children![2].children!.map(k => k.id),
    ['extra'],
  )
  assert.deepEqual(
    tree.children![1].children![0].children!.map(k => k.id),
    ['w1.in.title', 'w1.in.badge', 'w1.in.body'],
  )
})

test('an override reaches a part in a nested component by its unrolled id', () => {
  const { tree } = expand(
    page({
      ...inst({ id: 'w1' }),
      component: 'wrap',
      overrides: {
        'in.badge': { props: { runs: [{ text: 'Deep' }] } },
        'in.gone': { hide: { phone: true } },
      },
    }),
    withC(card, wrap),
  )
  const badge = tree.children![0].children![0].children![1]
  assert.deepEqual(
    [badge.id, badge.props!.runs],
    ['w1.in.badge', [{ text: 'Deep' }]],
  )
})

test('loose data: an unknown part kind, a bad look patch and a mis-aimed prop never reach the output', () => {
  const evil = '1deg);background:url(https://evil.example/x)'
  const one = (c: Component, extra: Partial<Node>) =>
    expand(page(inst({ component: c.id, ...extra })), withC(c)).tree
      .children![0]
  const odd: Component = {
    id: 'odd',
    name: 'Odd',
    root: box('root', [
      { id: 'x', kind: 'carousel' as never, name: 'X', slot: {} },
    ]),
    props: [],
    variants: [],
  }
  assert.equal(
    one(odd, { overrides: { x: { props: { level: 'h1' } } } }).children![0]
      .props,
    undefined,
    'the override on an unknown kind is dropped, nothing throws',
  )
  const looks: Component = {
    ...card,
    id: 'lk',
    variants: [
      {
        when: { look: 'featured' },
        patch: { root: { style: { base: { rotate: evil as never } } } },
      },
    ],
  }
  assert.ok(
    !JSON.stringify(one(looks, { set: { look: 'featured' } })).includes('evil'),
    'a bad look patch',
  )
  const aimed: Component = {
    ...card,
    id: 'aim',
    props: [
      {
        key: 'tint',
        label: 'Tint',
        type: 'text',
        part: 'title',
        field: 'color',
      },
    ],
  }
  const bad = one(aimed, {
    set: { tint: 'red;background:url(https://evil.example/x)' },
  })
  assert.ok(!JSON.stringify(bad).includes('evil'), 'a text prop aimed at color')
  assert.equal(bad.children![0].style?.base?.color, undefined)
  assert.equal(
    one(aimed, { set: { tint: '#112233' } }).children![0].style?.base?.color,
    '#112233',
  )
})

test('an instance of a missing component, and a component cycle, expand to nothing and do not overflow', () => {
  const self: Component = {
    id: 'a',
    name: 'A',
    root: box('root', [
      { id: 'x', kind: 'instance', name: 'x', slot: {}, component: 'a' },
    ]),
    props: [],
    variants: [],
  }
  const one = expand(page({ ...inst(), component: 'a' }), withC(self))
  assert.equal(one.tree.children![0].children!.length, 0)
  assert.equal(one.over, false)
  const ping: Component = {
    id: 'ping',
    name: 'P',
    root: box('root', [
      { id: 'x', kind: 'instance', name: 'x', slot: {}, component: 'pong' },
    ]),
    props: [],
    variants: [],
  }
  const pong: Component = {
    ...ping,
    id: 'pong',
    root: box('root', [
      { id: 'y', kind: 'instance', name: 'y', slot: {}, component: 'ping' },
    ]),
  }
  const two = expand(
    page({ ...inst(), component: 'ping' }, inst({ id: 'c2' })),
    withC(ping, pong, card),
  )
  assert.deepEqual(
    two.tree.children![0].children!.map(k => [k.id, k.children]),
    [['c1.x', []]],
    'ping holds pong, whose use of ping is dropped',
  )
  assert.equal(
    two.tree.children![1].children!.length,
    3,
    'a sound use beside it still unrolls',
  )
  assert.equal(two.over, false)
  const missing = expand(
    page({ ...inst(), component: 'nope' }, txt('after', 'x')),
    withC(card),
  )
  assert.deepEqual(
    missing.tree.children!.map(c => c.id),
    ['after'],
  )
  assert.equal(missing.over, false)
  const nowhere = expand(
    page(inst({ component: undefined }), inst({ component: 'constructor' })),
    withC(card),
  )
  assert.deepEqual(nowhere.tree.children, [])
})

test('an instance inside a repeat binds each item', () => {
  const row = box('it', [
    inst({ bind: { title: { from: 'item', field: 'title' } } }),
  ])
  const l: Node = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    repeat: {
      source: 'projects',
      filter: { field: 'selected', is: true },
      sort: { field: 'years', dir: 'asc' },
    },
    children: [row],
  }
  const { tree } = expand(l, withC(card))
  const titles = tree.children!.map(
    r => runsOf(r.children![0].children![0])[0].text,
  )
  assert.deepEqual(titles, ['T1', 'T2'])
  assert.deepEqual(
    tree.children!.map(r => r.children![0].id),
    ['c1~0', 'c1~1'],
  )
  assert.equal(tree.children![1].children![0].children![0].id, 'c1.title~1')
})

test('the node limit counts unrolled parts', () => {
  const many = Array.from({ length: 700 }, (_, i) => inst({ id: `c${i}` }))
  const r = expand(page(...many), withC(card))
  assert.equal(r.over, true)
  assert.ok(r.count <= MAX_NODES)
})

test('a page without instances comes out the same whatever components the site holds', () => {
  const before = expand(list(), ctx())
  const after = expand(list(), withC(card))
  assert.deepEqual(after.tree, before.tree)
  assert.equal(after.count, before.count)
})

test('nested instances whose expansion passes the limit stop at it, without building the rest', () => {
  // 20 uses of the next level at each of 5 levels: 20^5 leaves if it were built.
  const level = (i: number): Component => ({
    id: `l${i}`,
    name: `L${i}`,
    root: box(
      'root',
      i === 4
        ? [txt('leaf', 'x')]
        : Array.from({ length: 20 }, (_, k) => ({
            id: `u${k}`,
            kind: 'instance' as const,
            name: 'u',
            slot: {},
            component: `l${i + 1}`,
          })),
    ),
    props: [],
    variants: [],
  })
  const components = [0, 1, 2, 3, 4].map(level)
  const doc = site(
    page({
      id: 'top',
      kind: 'instance',
      name: 'Top',
      slot: {},
      component: 'l0',
    }),
    {
      components,
    },
  )
  assert.deepEqual(
    validateSite(
      { ...doc, pages: [{ ...base().pages[0], root: doc.pages[0].root }] },
      reg,
    ),
    [],
    'the document is legal',
  )
  const t0 = performance.now()
  const r = expand(doc.pages[0].root, ctx(undefined, { components }))
  assert.equal(r.over, true)
  assert.ok(r.count <= MAX_NODES)
  assert.ok(performance.now() - t0 < 2000)
  const raw = unrollInstances(doc.pages[0].root, components, {
    fonts: [],
    styles,
  })
  let n = 0
  walk(raw, () => n++)
  assert.ok(n <= MAX_NODES + 3, `the unrolled tree has ${n} nodes`)
})

test('instances whose masters hold nothing but instances are bounded too', () => {
  const hollow = (i: number): Component => ({
    id: `h${i}`,
    name: 'H',
    root: {
      id: 'root',
      kind: 'instance',
      name: 'r',
      slot: {},
      component: `h${i + 1}`,
      children: Array.from({ length: 20 }, (_, k) => ({
        id: `k${k}`,
        kind: 'instance' as const,
        name: 'k',
        slot: {},
        component: `h${i + 1}`,
      })),
    },
    props: [],
    variants: [],
  })
  const components = [
    ...[0, 1, 2, 3, 4, 5].map(hollow),
    { id: 'h6', name: 'E', root: box('root'), props: [], variants: [] },
  ]
  const t0 = performance.now()
  const r = expand(
    page({ id: 'top', kind: 'instance', name: 'T', slot: {}, component: 'h0' }),
    ctx(undefined, { components }),
  )
  assert.equal(r.over, true)
  assert.ok(performance.now() - t0 < 2000)
})

test('a property of one run binds or sets only that run, and an on/off property binds the show condition', () => {
  const line: Component = {
    id: 'line',
    name: 'Line',
    root: box('root', [
      {
        id: 'meta',
        kind: 'text',
        name: 'Meta',
        slot: {},
        props: {
          level: 'p',
          runs: [
            { text: '', style: { weight: 700 } },
            { text: ' · ' },
            { text: '' },
          ],
        },
      },
      txt('count', 'n'),
    ]),
    props: [
      {
        key: 'venue',
        label: 'Venue',
        type: 'text',
        part: 'meta',
        field: 'text',
        run: 2,
      },
      {
        key: 'first',
        label: 'First',
        type: 'text',
        part: 'meta',
        field: 'text',
        run: 0,
      },
      {
        key: 'count-shown',
        label: 'Count shown',
        type: 'toggle',
        part: 'count',
        field: 'hidden',
      },
    ],
    variants: [],
  }
  const row: Node = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    repeat: {
      source: 'projects',
      filter: { field: 'selected', is: true },
      sort: { field: 'years', dir: 'desc' },
    },
    children: [
      {
        id: 'c1',
        kind: 'instance',
        name: 'C',
        slot: {},
        component: 'line',
        set: { first: 'Hi' },
        bind: {
          venue: { from: 'item', field: 'title' },
          'count-shown': { from: 'item', field: 'title' },
        },
      },
    ],
  }
  const { tree } = expand(row, withC(line))
  const first = tree.children![0]
  assert.deepEqual(runsOf(first.children![0]), [
    { text: 'Hi', style: { weight: 700 } },
    { text: ' · ' },
    { text: 'T2', fromData: true },
  ])
  assert.equal(
    first.children!.length,
    2,
    'the value is set, so the count shows',
  )
  const empty = expand(
    row,
    ctx({ projects: [{ selected: true }] }, { components: [line] }),
  )
  assert.equal(
    empty.tree.children![0].children!.length,
    1,
    'no value hides the count',
  )
})

test('an on/off property means shown; a show condition bound onto the top part stays', () => {
  const c: Component = {
    id: 'tog',
    name: 'Tog',
    root: box('root', [txt('note', 'n')]),
    props: [
      {
        key: 'note-shown',
        label: 'Note shown',
        type: 'toggle',
        part: 'note',
        field: 'hidden',
      },
      {
        key: 'top-shown',
        label: 'Top shown',
        type: 'toggle',
        part: 'root',
        field: 'hidden',
      },
    ],
    variants: [],
  }
  const use = (extra: Partial<Node>): Node => ({
    id: 't1',
    kind: 'instance',
    name: 'T',
    slot: {},
    component: 'tog',
    ...extra,
  })
  const hiddenOf = (set: object) =>
    expand(page(use({ set: set as never })), withC(c)).tree.children![0]
      .children![0].style?.base?.hidden
  assert.equal(hiddenOf({ 'note-shown': true }), false)
  assert.equal(hiddenOf({ 'note-shown': false }), true)
  const dropped = expand(
    page(use({ bind: { 'top-shown': { from: 'site', field: 'photo' } } })),
    withC(c),
  )
  assert.equal(
    dropped.tree.children!.length,
    0,
    'an empty value hides the top part',
  )
  const shown = expand(
    page(use({ bind: { 'top-shown': { from: 'site', field: 'photo' } } })),
    ctx(undefined, { components: [c], values: { photo: 'a.png' } }),
  )
  assert.equal(shown.tree.children!.length, 1)
})

test('a run link can be set as well as bound', () => {
  const c: Component = {
    id: 'lnk',
    name: 'Lnk',
    root: box('root', [txt('note', 'n')]),
    props: [
      {
        key: 'see',
        label: 'Link',
        type: 'link',
        part: 'note',
        field: 'link',
        run: 0,
      },
    ],
    variants: [],
  }
  const at = (extra: Partial<Node>, values = {}) =>
    runsOf(
      expand(
        page({
          id: 't1',
          kind: 'instance',
          name: 'T',
          slot: {},
          component: 'lnk',
          ...extra,
        }),
        ctx(undefined, { components: [c], values }),
      ).tree.children![0].children![0],
    )[0]
  assert.deepEqual(at({ set: { see: { url: 'https://x.org' } } }).link, {
    url: 'https://x.org',
  })
  assert.deepEqual(
    at({ bind: { see: { from: 'site', field: 'u' } } }, { u: 'https://y.org' })
      .link,
    { url: 'https://y.org' },
  )
})

test('a use carries its state and triggers; the master own stay', () => {
  const btn = (on: unknown): Node =>
    ({
      id: 'b',
      kind: 'button',
      name: 'b',
      slot: {},
      props: { label: 'x' },
      on,
    }) as Node
  const master = box('m', [btn([{ on: 'hover', do: { toggle: 'open' } }])], {
    state: [{ name: 'open', values: 'on-off', initial: 'off' }],
  })
  const comp: Component = {
    id: 'card',
    name: 'Card',
    root: master,
    props: [],
    variants: [],
  }
  const use = (extra: Partial<Node>): Node => ({
    id: 'u',
    kind: 'instance',
    name: 'U',
    slot: {},
    component: 'card',
    ...extra,
  })
  const c = withC(comp)
  const plain = expand(page(use({})), c).tree.children![0]
  assert.deepEqual(plain.state, master.state)
  assert.deepEqual(plain.children![0].on, [
    { on: 'hover', do: { toggle: 'open' } },
  ])
  const own = expand(
    page(
      use({
        state: [
          { name: 'tab', values: ['a', 'b'], initial: 'a' },
          { name: 'open', values: 'on-off', initial: 'on' },
        ],
        on: [{ on: 'enter-view', do: { scrollTo: 'u' } }],
      } as never),
    ),
    c,
  ).tree.children![0]
  assert.deepEqual(
    own.state!.map(s => s.name),
    ['open', 'tab'],
    'the master keeps a name it holds',
  )
  assert.equal(own.state![0].initial, 'off')
  assert.deepEqual(own.on, [{ on: 'enter-view', do: { scrollTo: 'u' } }])
})

test('a trigger inside a repeated item follows its own copy', () => {
  const it = box('it', [
    box('dlg', undefined, { props: { layer: 'popover-auto' } }),
    {
      id: 'go',
      kind: 'button',
      name: 'go',
      slot: {},
      props: { label: 'x' },
      on: [{ on: 'hover', do: { open: 'dlg' } }],
    } as Node,
  ])
  const l: Node = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    repeat: { source: 'projects', max: 2 },
    children: [it],
  }
  const { tree } = expand(l, ctx())
  assert.deepEqual(
    tree.children!.map(
      c => (c.children![1].on![0].do as { open: string }).open,
    ),
    ['dlg~0', 'dlg~1'],
  )
})

test('the input is never changed', () => {
  const root = page(inst({ set: { title: 'Hi' } }), list())
  const before = JSON.stringify(root)
  const c = withC(card)
  const comps = JSON.stringify(c.components)
  expand(root, c)
  assert.equal(JSON.stringify(root), before)
  assert.equal(JSON.stringify(c.components), comps)
})

test('render holds a deep override and a set value to the part limits, and a popover in a repeated component keeps its target', () => {
  // a deep override is checked again before it lands
  const deep = expand(
    page({
      ...inst({ id: 'w1' }),
      component: 'wrap',
      overrides: {
        'in.badge': {
          style: {
            base: {
              color: 'red;background:url(https://evil.example/x)' as never,
            },
          },
        },
      },
    }),
    withC(card, wrap),
  )
  assert.ok(!JSON.stringify(deep.tree).includes('evil'))
  // a value is held to the limits of the part it is aimed at
  const sized: Component = {
    ...card,
    id: 'sized',
    props: [
      {
        key: 'pad',
        label: 'Pad',
        type: 'number',
        part: 'root',
        field: 'padding',
      },
    ],
  }
  const padOf = (v: number) =>
    expand(page(inst({ component: 'sized', set: { pad: v } })), withC(sized))
      .tree.children![0].style?.base?.padding
  assert.equal(padOf(12), 12)
  assert.equal(padOf(10 ** 9), 8, 'the master keeps its own')
  // a popover and the button that opens it follow their own copy
  const pop: Component = {
    id: 'pop',
    name: 'Pop',
    root: box('root', [
      box('dlg', undefined, { props: { layer: 'popover-auto' } }),
      {
        id: 'go',
        kind: 'button',
        name: 'go',
        slot: {},
        props: { label: 'x' },
        on: [{ on: 'hover', do: { open: 'dlg' } }],
      } as Node,
    ]),
    props: [],
    variants: [],
  }
  const l: Node = {
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    repeat: { source: 'projects', max: 2 },
    children: [box('it', [inst({ component: 'pop' })])],
  }
  const { tree } = expand(l, withC(pop))
  assert.deepEqual(
    tree.children!.map(r => {
      const c = r.children![0]
      return [
        c.children![0].id,
        (c.children![1].on![0].do as { open: string }).open,
      ]
    }),
    [
      ['c1.dlg~0', 'c1.dlg~0'],
      ['c1.dlg~1', 'c1.dlg~1'],
    ],
  )
})

test('recursion is bounded: deep plain nesting and a long chain of components stop with over, never throw', () => {
  let deep = box('leaf')
  for (let i = 0; i < 2000; i++) deep = box(`d${i}`, [deep])
  const plain = expand(deep, ctx())
  assert.equal(plain.over, true)
  assert.ok(plain.depth <= 70)
  const chain = Array.from({ length: 1000 }, (_, i): Component => ({
    id: `k${i}`,
    name: 'K',
    root: box('root', [
      {
        id: 'n',
        kind: 'instance',
        name: 'n',
        slot: {},
        component: `k${i + 1}`,
      },
    ]),
    props: [],
    variants: [],
  }))
  const r = expand(
    page({ id: 'top', kind: 'instance', name: 'T', slot: {}, component: 'k0' }),
    ctx(undefined, { components: chain }),
  )
  assert.equal(r.over, true)
  assert.ok(r.depth <= 70)
  // an instance nested 2,000 deep in plain boxes
  let wrapped: Node = {
    id: 'u',
    kind: 'instance',
    name: 'u',
    slot: {},
    component: 'project-card',
  }
  for (let i = 0; i < 2000; i++) wrapped = box(`w${i}`, [wrapped])
  assert.equal(expand(wrapped, withC(card)).over, true)
})

test('an override on a part of a plug-in kind is applied when the kinds are given, and dropped when they are not', () => {
  const plug: Component = {
    id: 'plug',
    name: 'Plug',
    root: box('root', [
      { id: 'note', kind: 'callout' as never, name: 'N', slot: {} },
    ]),
    props: [],
    variants: [],
  }
  const doc = (kinds?: ReadonlyMap<string, KindSpec>) =>
    expand(
      page(
        inst({
          component: 'plug',
          overrides: { note: { hide: { phone: true } } },
        }),
      ),
      { ...withC(plug), kinds },
    ).tree.children![0].children![0].hide
  const reg = createRegistry()
  reg.use(calloutPlugin())
  assert.deepEqual(doc(reg.kinds()), { phone: true })
  assert.equal(doc(), undefined)
})
