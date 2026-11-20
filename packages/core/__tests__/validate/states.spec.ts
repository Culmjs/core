import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Node, type SiteDocument } from '../../src/document/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import {} from '../kit.ts'
import {
  base,
  btn,
  codes,
  col,
  fs,
  holder,
  messages,
  n,
  okFooter,
  okPage,
  put,
  reacts,
  reg,
  site,
} from './helpers.ts'

test('a valid state, a when layer and a trigger pass', () => {
  const t = holder({}, [
    btn('b1', [{ on: 'click', do: { set: 'tab', to: 'papers' } }]),
    reacts('t1'),
  ])
  assert.deepEqual(validateSite(put(t), reg), [])
})

test('a state name with a quote is refused', () => {
  for (const name of ['a"b', 'A', 'x'.repeat(33), '', 'a b', 'a]b'])
    assert.ok(
      !okPage(holder({ state: [{ name, values: ['a', 'b'], initial: 'a' }] })),
      name,
    )
  assert.ok(
    !okPage(
      holder({ state: [{ name: 'tab', values: ['a"]'], initial: 'a"]' }] }),
    ),
  )
  assert.ok(!okPage(holder({}, [reacts('t1', 'tab"]{}', 'x')])))
  const p = validateSite(
    put({
      id: 'st',
      kind: 'text',
      name: 'S',
      slot: fs(),
      state: [{ name: 'Bad', values: 'on-off', initial: 'on' }],
    }),
    reg,
  )
  assert.deepEqual(
    p.map(x => [x.code, x.nodeId, x.path]),
    [['INVALID_NODE', 'st', 'state']],
  )
})

test("a state's initial value must be one of its values, and on-off states are on or off", () => {
  assert.ok(
    !okPage(
      holder({ state: [{ name: 'tab', values: ['a', 'b'], initial: 'c' }] }),
    ),
  )
  assert.ok(
    okPage(
      holder({ state: [{ name: 'menu', values: 'on-off', initial: 'off' }] }),
    ),
  )
  assert.ok(
    !okPage(
      holder({ state: [{ name: 'menu', values: 'on-off', initial: 'yes' }] }),
    ),
  )
})

test('click on a text block is refused; a button takes it', () => {
  const t = {
    id: 't',
    kind: 'text',
    name: 'T',
    slot: {},
    props: { level: 'p', runs: [] },
    on: [{ on: 'click', do: { set: 'tab', to: 'papers' } }],
  }
  const p = validateSite(put(holder({}, [t])), reg)
  assert.ok(p.some(x => x.nodeId === 't' && /button/i.test(x.message)))
  assert.ok(
    okPage(
      holder({}, [
        btn('b', [{ on: 'click', do: { set: 'tab', to: 'papers' } }]),
      ]),
    ),
  )
})

test('open, close and goTo are refused on events they do not run on, with a plain message', () => {
  const dlg = {
    id: 'dlg',
    kind: 'box',
    name: 'D',
    slot: fs(),
    props: { layer: 'dialog' },
  }
  const say = (on: unknown) =>
    messages(put(dlg, { ...btn('b', [on]), slot: fs() })).join('|')
  assert.match(
    say({ on: 'hover', do: { open: 'dlg' } }),
    /Open and close work on a click\./,
  )
  assert.match(
    say({ on: 'hover', do: { goTo: { page: '/talks' } } }),
    /Going to another page works on a click or when a form is sent\./,
  )
})

test('a when naming a state no ancestor holds is refused', () => {
  assert.ok(!okPage(holder({}, [reacts('t1', 'other')])))
  assert.ok(!okPage(reacts('t1', 'tab', 'papers', fs())), 'outside the holder')
  assert.ok(
    !okPage(holder({}, [reacts('t1', 'tab', 'nope')])),
    'a value the state lacks',
  )
  const page = site(
    n({
      id: 'r',
      kind: 'free',
      name: 'P',
      slot: {},
      state: [{ name: 'skin', values: ['light', 'dark'], initial: 'light' }],
      children: [reacts('t1', 'skin', 'dark', fs())],
    }),
  )
  assert.deepEqual(
    validateSite(page, reg),
    [],
    'a state on the page reaches everything',
  )
})

test('a state may not repeat the name an ancestor holds', () => {
  assert.ok(!okPage(holder({}, [holder({ id: 'in', slot: {} })])))
})

test('trigger targets must exist and fit the action; toggle needs an on-off state', () => {
  const states = [
    { name: 'tab', values: ['a', 'b'], initial: 'a' },
    { name: 'menu', values: 'on-off', initial: 'off' },
  ]
  const ok = (on: unknown, extra: unknown[] = []) =>
    okPage(holder({ state: states }, [btn('b1', on), ...extra]))
  assert.ok(ok([{ on: 'click', do: { scrollTo: 'b1' } }]))
  assert.ok(!ok([{ on: 'click', do: { scrollTo: 'ghost' } }]), 'missing target')
  assert.ok(ok([{ on: 'click', do: { toggle: 'menu' } }]))
  assert.ok(
    !ok([{ on: 'click', do: { toggle: 'tab' } }]),
    'toggle of a list state',
  )
  assert.ok(
    !ok([{ on: 'click', do: { set: 'tab', to: 'zzz' } }]),
    'set to a value the state lacks',
  )
  assert.ok(
    !ok([{ on: 'click', do: { set: 'nope', to: 'a' } }]),
    'set of a state nobody holds',
  )
  assert.ok(!ok([{ on: 'click', do: { play: 'b1' } }]), 'play on a non-video')
  assert.ok(
    ok(
      [{ on: 'click', do: { play: 'v' } }],
      [
        {
          id: 'v',
          kind: 'video',
          name: 'V',
          slot: {},
          props: { assetId: 'img1' },
        },
      ],
    ),
  )
  assert.ok(
    !ok([{ on: 'click', do: { open: 'b1' } }]),
    'open on a node that is not a layer',
  )
  const dlg = [
    { id: 'dlg', kind: 'box', name: 'D', slot: {}, props: { layer: 'dialog' } },
  ]
  assert.ok(
    !ok([{ on: 'click', do: { open: 'dlg' } }], dlg),
    'a link button cannot also open',
  )
  assert.ok(
    !ok([{ on: 'hover', do: { open: 'dlg' } }], dlg),
    'open works on a click only',
  )
  assert.ok(
    !ok([{ on: 'enter-view', do: { close: 'dlg' } }], dlg),
    'close works on a click only',
  )
  assert.ok(
    !ok([{ on: 'hover', do: { goTo: { page: '/talks' } } }]),
    'goTo works on a click or a submit only',
  )
  assert.ok(
    !ok([{ on: 'enter-view', do: { goTo: { page: '/talks' } } }]),
    'goTo does not run on scroll',
  )
  assert.ok(ok([{ on: 'click', do: { goTo: { page: '/talks' } } }]))
  assert.ok(
    !ok([{ on: 'click', do: { goTo: { url: 'javascript:alert(1)' } } }]),
    'goTo is held to the link check',
  )
  assert.ok(
    !ok([{ on: 'click', do: { scrollTo: 'b1', extra: 1 } }]),
    'unknown fields',
  )
  assert.ok(!ok([{ on: 'tap', do: { scrollTo: 'b1' } }]), 'unknown event')
  assert.ok(
    !ok(
      Array.from({ length: 9 }, () => ({
        on: 'click',
        do: { scrollTo: 'b1' },
      })),
    ),
    'at most 8 triggers',
  )
})

test('submit goes on a form only; a button that opens has no link', () => {
  assert.ok(
    !okPage({
      id: 'b',
      kind: 'box',
      name: 'B',
      slot: fs(),
      on: [{ on: 'submit', do: { scrollTo: 'b' } }],
    }),
  )
  const dlg = {
    id: 'dlg',
    kind: 'box',
    name: 'D',
    slot: fs(),
    props: { layer: 'dialog' },
  }
  assert.ok(
    okPage(dlg, {
      ...btn('o', [{ on: 'click', do: { open: 'dlg' } }], { label: 'Open' }),
      slot: fs(),
    }),
  )
})

test('a header state is site-wide: the page and footer see it, and the page may not repeat it', () => {
  const header = (state: unknown, kids: unknown[] = []) =>
    n({ id: 'hd', kind: 'row', name: 'H', slot: {}, state, children: kids })
  const mode = [{ name: 'mode', values: ['light', 'dark'], initial: 'light' }]
  const withHeader = (root: Node, more: Partial<SiteDocument> = {}) => ({
    ...site(root),
    header: header(mode),
    ...more,
  })
  const page = n({
    id: 'r',
    kind: 'free',
    name: 'P',
    slot: {},
    children: [reacts('t1', 'mode', 'dark', fs())],
  })
  assert.deepEqual(
    validateSite(withHeader(page), reg),
    [],
    'page reacts to the header state',
  )
  const foot = n({
    id: 'ft',
    kind: 'row',
    name: 'F',
    slot: {},
    children: [reacts('t2', 'mode', 'dark')],
  })
  assert.deepEqual(
    validateSite(withHeader(col(), { footer: foot }), reg),
    [],
    'footer too',
  )
  assert.ok(!okFooter(foot), 'not without a header that holds it')
  const dup = validateSite(
    withHeader(
      n({
        id: 'r',
        kind: 'free',
        name: 'P',
        slot: {},
        state: [{ name: 'mode', values: ['a', 'b'], initial: 'a' }],
      }),
    ),
    reg,
  )
  assert.ok(
    dup.some(p => p.message === 'The header already has a state called mode.'),
    messages(dup).join('|'),
  )
  const sets = {
    ...btn('b1', [{ on: 'click', do: { set: 'mode', to: 'dark' } }]),
    slot: fs(),
  }
  const free = n({
    id: 'r',
    kind: 'free',
    name: 'P',
    slot: {},
    children: [sets],
  })
  assert.deepEqual(validateSite(withHeader(free), reg), [], 'and may set it')
})

test('a page state is not seen by the header or footer', () => {
  const pg = [{ name: 'pg', values: ['a', 'b'], initial: 'a' }]
  const page = n({ id: 'r', kind: 'free', name: 'P', slot: {}, state: pg })
  assert.deepEqual(validateSite(site(page), reg), [])
  const footer = n({
    id: 'ft',
    kind: 'row',
    name: 'F',
    slot: {},
    children: [reacts('t2', 'pg', 'a')],
  })
  assert.ok(validateSite({ ...site(page), footer }, reg).length > 0)
})

test('reserved state names are refused', () => {
  for (const name of [
    'on',
    'enter',
    'in',
    'open',
    'theme',
    'scope',
    'pattern',
  ]) {
    const p = validateSite(
      put(holder({ state: [{ name, values: ['a', 'b'], initial: 'a' }] })),
      reg,
    )
    assert.ok(
      p.some(
        x =>
          x.message ===
          `${name} is a word the site uses itself; pick another name.`,
      ),
      name,
    )
  }
})

test('header-root state names are site-wide: no other holder may reuse one, whichever is checked', () => {
  const mode = [{ name: 'mode', values: ['light', 'dark'], initial: 'light' }]
  const hdr = (state: unknown, kids: unknown[] = []) =>
    n({ id: 'hd', kind: 'row', name: 'H', slot: {}, state, children: kids })
  const hold = (id: string, slot: object) => ({
    id,
    kind: 'box',
    name: 'B',
    slot,
    state: mode,
    children: [],
  })
  const d = (over: object) =>
    ({ ...base(), ...over }) as unknown as SiteDocument
  assert.ok(
    codes(
      d({
        header: hdr(mode),
        pages: [
          {
            ...base().pages[0],
            root: n({
              id: 'r',
              kind: 'free',
              name: 'P',
              slot: {},
              children: [hold('n1', fs())],
            }),
          },
        ],
      }),
    ).length > 0,
    'a page-nested holder',
  )
  assert.ok(
    codes(
      d({
        header: hdr(mode),
        footer: n({
          id: 'ft',
          kind: 'row',
          name: 'F',
          slot: {},
          children: [hold('n2', {})],
        }),
      }),
    ).length > 0,
    'a footer-nested holder',
  )
  assert.ok(
    codes(
      d({
        header: hdr(mode),
        pages: [
          {
            ...base().pages[0],
            root: n({
              id: 'r',
              kind: 'free',
              name: 'P',
              slot: {},
              state: mode,
            }),
          },
        ],
      }),
    ).length > 0,
    'a page root',
  )
  assert.deepEqual(codes(d({ header: hdr(mode) })), [], 'nothing else holds it')
  const x = [{ name: 'x', values: ['a', 'b'], initial: 'a' }]
  assert.ok(
    codes(
      d({
        header: hdr(
          x,
          [hold('n3', {})].map(h => ({ ...h, state: x })),
        ),
      }),
    ).length > 0,
    'nested inside the header root',
  )
})

// ---- tabs ----

const tabBtn = (
  id: string,
  v: string,
  extra: Record<string, unknown> = {},
) => ({
  ...btn(id, [{ on: 'click', do: { set: 'tab', to: v } }], {
    label: v,
    tabs: 'tab',
  }),
  ...extra,
})
const tabPanel = (
  id: string,
  v: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'box',
  name: id,
  slot: {},
  props: { tabs: 'panel' },
  style: {
    base: { hidden: true },
    when: [{ state: 'tab', is: v, decl: { hidden: false } }],
  },
  ...extra,
})
const tabList = (kids: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'tl',
  kind: 'row',
  name: 'L',
  slot: {},
  props: { tabs: 'list' },
  children: kids,
  ...extra,
})
const tabsOk = (kids: unknown[]) => messages(put(holder({}, kids)))

test('tabs: a list of tab buttons with their panels passes', () => {
  assert.deepEqual(
    tabsOk([
      tabList([tabBtn('b1', 'papers'), tabBtn('b2', 'talks')]),
      tabPanel('p1', 'papers'),
      tabPanel('p2', 'talks'),
    ]),
    [],
  )
})

test("tabs: a tab outside a list, a tab with no set, and a tab that sets a second list's state are refused in plain words", () => {
  assert.match(
    tabsOk([tabBtn('b1', 'papers')]).join(),
    /A tab needs to sit inside a tab list/,
  )
  assert.match(
    tabsOk([
      tabList([
        {
          ...tabBtn('b1', 'papers'),
          on: [{ on: 'click', do: { toggle: 'tab' } }],
        },
      ]),
    ]).join(),
    /A tab needs to set the list's state/,
  )
  assert.match(
    tabsOk([tabList([{ ...tabBtn('b1', 'papers'), on: [] }])]).join(),
    /A tab needs to set the list's state/,
  )
  assert.match(
    tabsOk([
      tabList([tabBtn('b1', 'papers')]),
      { ...tabList([tabBtn('b2', 'talks')]), id: 'tl2' },
    ]).join(),
    /one tab list/i,
  )
})

test("tabs: a panel must hide at first and show on one value of the list's state", () => {
  const list = tabList([tabBtn('b1', 'papers')])
  assert.match(
    tabsOk([
      list,
      tabPanel('p1', 'papers', {
        style: {
          when: [{ state: 'tab', is: 'papers', decl: { hidden: false } }],
        },
      }),
    ]).join(),
    /A tab panel needs to be hidden/,
  )
  assert.match(
    tabsOk([
      list,
      tabPanel('p1', 'papers', { style: { base: { hidden: true } } }),
    ]).join(),
    /A tab panel needs to be hidden/,
  )
  assert.match(
    tabsOk([tabPanel('p1', 'papers')]).join(),
    /A tab panel needs a tab list/,
  )
})

test('tabs: the setting only goes on the right kinds and values', () => {
  assert.ok(
    !okPage({
      id: 't1',
      kind: 'text',
      name: 'T',
      slot: fs(),
      props: { level: 'p', runs: [], tabs: 'list' },
    }),
  )
  assert.ok(!okPage(holder({}, [tabList([], { props: { tabs: 'tab' } })])))
  assert.ok(!okPage(holder({}, [tabList([], { props: { tabs: 'x' } })])))
})

test('tabs: a tab or panel that relies on a header state is refused', () => {
  const header = n({
    id: 'hd',
    kind: 'row',
    name: 'H',
    slot: {},
    state: [{ name: 'tab', values: ['talks', 'papers'], initial: 'talks' }],
    children: [],
  })
  const free = n({
    id: 'r',
    kind: 'free',
    name: 'P',
    slot: {},
    children: [
      { ...tabList([tabBtn('b1', 'papers')]), slot: fs() },
      { ...tabPanel('p1', 'papers'), slot: fs() },
    ],
  })
  const got = messages({ ...site(free), header }).join()
  assert.match(
    got,
    /A tab and its panel need to be in the same part of the page\./,
  )
})

test('tabs: a whole set of ARIA or no save', () => {
  const both = [tabPanel('p1', 'papers'), tabPanel('p2', 'talks')]
  const say = (kids: unknown[]) => tabsOk(kids).join('|')
  assert.match(
    say([tabList([]), ...both]),
    /A tab list needs at least one tab\./,
  )
  assert.match(
    say([
      tabList([
        tabBtn('b1', 'papers'),
        tabBtn('b2', 'talks'),
        btn('x', [], { label: 'Go', link: { url: 'https://x.org' } }),
      ]),
      ...both,
    ]),
    /can only hold tabs, with no other buttons or links/,
  )
  assert.match(
    say([tabList([tabBtn('b1', 'papers'), tabBtn('b2', 'papers')]), ...both]),
    /Two tabs set the same value\./,
  )
  assert.match(
    say([tabList([tabBtn('b1', 'papers')]), ...both]),
    /Each panel needs exactly one tab\./,
  )
  assert.match(
    say([
      tabList([tabBtn('b1', 'papers'), tabBtn('b2', 'talks')]),
      tabPanel('p1', 'papers'),
    ]),
    /Each tab needs exactly one panel\./,
  )
  assert.match(
    say([
      tabList([tabBtn('b1', 'papers'), tabBtn('b2', 'talks')]),
      ...both,
      tabPanel('p3', 'talks'),
    ]),
    /Each (tab|panel) needs exactly one/,
  )
  assert.deepEqual(
    tabsOk([tabList([tabBtn('b1', 'papers'), tabBtn('b2', 'talks')]), ...both]),
    [],
  )
})

test('tabs: every tab in a list sets the same state', () => {
  const odd = {
    ...tabBtn('b2', 'a'),
    on: [{ on: 'click', do: { set: 'other', to: 'a' } }],
  }
  const kids = [
    tabList([tabBtn('b1', 'papers'), odd]),
    tabPanel('p1', 'papers'),
  ]
  const h = {
    ...holder({}, kids),
    state: [
      { name: 'tab', values: ['talks', 'papers'], initial: 'talks' },
      { name: 'other', values: ['a', 'b'], initial: 'a' },
    ],
  }
  assert.match(
    messages(put(h)).join('|'),
    /Every tab in a list needs to set the same state\./,
  )
})

test('tabs: a tab is only a tab, and a list is not a menu or a list item', () => {
  const withProps = (props: object) =>
    tabsOk([
      tabList([
        {
          ...tabBtn('b1', 'papers'),
          props: { label: 'x', tabs: 'tab', ...props },
        },
      ]),
      tabPanel('p1', 'papers'),
    ]).join('|')
  for (const p of [
    { link: { url: 'https://x.org' } },
    { command: 'toggle-popover', opens: 'p1' },
  ])
    assert.match(withProps(p), /A tab only switches its panel\./)
  const nav = tabsOk([
    tabList([tabBtn('b1', 'papers')], { props: { tabs: 'list', as: 'nav' } }),
    tabPanel('p1', 'papers'),
  ]).join('|')
  assert.match(nav, /A tab list can't also be a menu or a list item\./)
})

test('actions and events whose scripts stage 1 does not carry are refused', () => {
  const ok = (trigger: unknown) =>
    okPage(holder({}, [btn('b1', [trigger]), btn('b2', undefined)]))
  assert.ok(ok({ on: 'click', do: { scrollTo: 'b2' } }), 'control')
  for (const [verb, value] of [
    ['copy', 'address'],
    ['progress', 'page'],
    ['outline', 'page'],
    ['filter', 'b2'],
    ['more', 'b2'],
    ['turn', 'b2'],
    ['scheme', 'dark'],
  ] as const)
    assert.ok(
      !ok({
        on: 'click',
        do: { [verb]: value, ...(verb === 'turn' ? { by: 1 } : {}) },
      }),
      verb,
    )
  for (const event of ['scroll', 'load'])
    assert.ok(!ok({ on: event, do: { scrollTo: 'b2' } }), event)
})
