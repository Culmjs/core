import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateSite } from '../../src/validate/index.ts'
import { cyclicComponents } from '../../src/validate/components.ts'
import { node } from '../kit.ts'
import {
  codes,
  comp,
  fs,
  holder,
  ids,
  inst,
  item,
  listOver,
  master,
  messages,
  more_,
  n,
  pc,
  put,
  reacts,
  reg,
  row,
  txt,
  type Comp,
  using,
  withComps,
} from './helpers.ts'

test('an instance of a known component passes; a missing component is UNKNOWN_COMPONENT; stale parts are tolerated', () => {
  const d = (extra: object) => withComps([using(extra)], comp('card'))
  assert.deepEqual(
    validateSite(
      d({
        set: { title: 'Hi' },
        overrides: { badge: { props: { runs: [{ text: 'New' }] } } },
      }),
      reg,
    ),
    [],
  )
  assert.deepEqual(pc(validateSite(d({ component: 'nope' }), reg)), [
    ['UNKNOWN_COMPONENT', 'i1', 'component'],
  ])
  assert.deepEqual(
    pc(
      validateSite(d({ overrides: { ghost: { hide: { phone: true } } } }), reg),
    ),
    [['INVALID_NODE', 'i1', 'overrides.ghost']],
    'a part the master lacks is refused, not dropped at render',
  )
  assert.deepEqual(
    pc(validateSite(d({ set: { nope: 1, title: 'Hi' } }), reg)),
    [['INVALID_NODE', 'i1', 'set.nope']],
    'a value for a property the component lacks is refused',
  )
  assert.ok(
    ids(d({ overrides: { ghost: { hide: { phone: 'yes' } } } })).has('i1'),
    'its shape is still checked',
  )
  assert.ok(
    ids(d({ overrides: { badge: { props: { level: 'h9' } } } })).has('i1'),
  )
  assert.ok(ids(d({ props: { x: 1 } })).has('i1'))
  assert.ok(
    ids(d({ style: { base: { gap: 4 } } })).has('i1'),
    'changes go in overrides',
  )
  assert.ok(
    ids(d({ origin: { block: 'demo', version: 1, look: 'default' } })).has(
      'i1',
    ),
    'a use is not a block',
  )
  assert.deepEqual(
    codes(
      withComps([], comp('card', master([inst('x', 'ghost')]), { props: [] })),
    ),
    ['UNKNOWN_COMPONENT'],
    'inside another component',
  )
})

test('a component that uses itself, or two that use each other, is reported once each and does not overflow', () => {
  const a = comp('a', master([inst('x', 'b')]), { props: [] })
  const b = comp('b', master([inst('y', 'a')]), { props: [] })
  const both = validateSite({ ...put(), components: [a, b] }, reg)
  assert.deepEqual(pc(both), [
    ['INVALID_NODE', 'x', 'component'],
    ['INVALID_NODE', 'y', 'component'],
  ])
  assert.match(both[0].message, /can't contain itself/)
  const own = comp('a', master([inst('x', 'a')]), { props: [] })
  assert.deepEqual(pc(validateSite({ ...put(), components: [own] }, reg)), [
    ['INVALID_NODE', 'x', 'component'],
  ])
  const used = validateSite(withComps([using({ component: 'a' })], a, b), reg)
  assert.ok(
    used.some(p => p.nodeId === 'i1' && /can't contain itself/.test(p.message)),
    'a page use of one of them',
  )
  assert.deepEqual(cyclicComponents([a, b]), new Set(['a', 'b']))
  assert.deepEqual(
    cyclicComponents([a, comp('c')]),
    new Set(),
    'b is not in the list, so nothing closes the loop',
  )
  assert.deepEqual(cyclicComponents([comp('c')]), new Set())
})

test('cycle search is linear: a 24-level doubling doc checks fast', () => {
  const N = 24
  const use = (id: string, to: number) => inst(id, `c${to}`)
  const comps = Array.from({ length: N }, (_, i) =>
    comp(
      `c${i}`,
      i + 1 < N
        ? master([use('a', i + 1), use('b', i + 1)])
        : master([txt('t')]),
      { props: [] },
    ),
  )
  const t0 = Date.now()
  assert.deepEqual(
    validateSite(withComps([using({ component: 'c0' })], ...comps), reg),
    [],
  )
  const inList = put(
    listOver('projects', [item([{ ...using({ component: 'c0' }), slot: {} }])]),
  )
  assert.deepEqual(
    validateSite({ ...inList, components: comps }, reg),
    [],
    'and in a list, where layers are searched too',
  )
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`)
})

test('a component is checked as a tree, with its properties and looks', () => {
  const good = comp('card', master(), {
    props: [
      {
        key: 'look',
        label: 'Look',
        type: 'choice',
        options: ['default', 'big'],
      },
      {
        key: 'title',
        label: 'Title',
        type: 'text',
        part: 'title',
        field: 'text',
      },
    ],
    variants: [
      {
        when: { look: 'big' },
        patch: { title: { style: { base: { size: 30 } } } },
      },
    ],
  })
  const v = (more: object) =>
    validateSite({ ...put(), components: [{ ...good, ...more }] }, reg)
  assert.deepEqual(v({}), [])
  const lookProp = {
    key: 'look',
    label: 'Look',
    type: 'choice' as const,
    options: ['default', 'big'],
  }
  const title = (more: object) => ({
    key: 'title',
    label: 'T',
    type: 'text',
    part: 'title',
    field: 'text',
    ...more,
  })
  for (const more of [
    { variants: [{ when: { look: 'gone' }, patch: {} }] },
    {
      variants: [
        { when: { look: 'big' }, patch: { ghost: { hide: { phone: true } } } },
      ],
    },
    { props: [lookProp, title({ part: 'ghost' })] },
    { props: [lookProp, title({ type: 'image' })] },
    { props: [lookProp, title({ key: 'Bad Key' })] },
    {
      props: [
        lookProp,
        title({ key: 'a' }),
        title({ key: 'a', part: 'badge' }),
      ],
    },
    { props: [{ ...lookProp, options: [] }], variants: [] },
    { props: [lookProp, title({ run: 5 })] },
  ])
    assert.deepEqual(
      v(more).map(p => p.code),
      ['INVALID_NODE'],
      JSON.stringify(more),
    )
  assert.deepEqual(
    v(more_()).map(p => [p.code, p.nodeId]),
    [['INVALID_NODE', 'title']],
    'part ids are unique',
  )
  const twice = validateSite({ ...put(), components: [good, good] }, reg)
  assert.ok(
    twice.some(p => p.code === 'INVALID_DOCUMENT'),
    'component ids are unique',
  )
  assert.ok(
    codes({ ...put(), components: [{ ...good, id: 'Bad Id' }] }).includes(
      'INVALID_DOCUMENT',
    ),
  )
  assert.ok(
    codes({ ...put(), components: [{ ...good, extra: 1 }] }).includes(
      'INVALID_DOCUMENT',
    ),
  )
  assert.ok(
    codes({ ...put(), components: [{ ...good, props: 'x' }] }).includes(
      'INVALID_DOCUMENT',
    ),
  )
})

test("overrides reach a nested component's part, however deep", () => {
  const inner = comp('card')
  const outer = comp('wrap', node('root', 'box', [inst('in', 'card')]), {
    props: [],
  })
  const on = (overrides: object) =>
    withComps(
      [
        {
          id: 'w1',
          kind: 'instance',
          name: 'W',
          slot: fs(),
          component: 'wrap',
          overrides,
        },
      ],
      inner,
      outer,
    )
  assert.deepEqual(
    validateSite(on({ 'in.badge': { hide: { phone: true } } }), reg),
    [],
  )
  assert.deepEqual(
    codes(on({ 'in.badge': { props: { level: 'h9' } } })),
    ['INVALID_NODE'],
    'a part that resolves is checked in full',
  )
  assert.deepEqual(
    pc(validateSite(on({ 'in.gone': { hide: { phone: true } } }), reg)),
    [['INVALID_NODE', 'w1', 'overrides.in.gone']],
  )
  const D = 12
  const evil = {
    style: { base: { rotate: '1deg);background:url(https://evil.example/x)' } },
  }
  const comps = Array.from({ length: D }, (_, i) =>
    comp(
      `c${i}`,
      i + 1 < D
        ? node('root', 'box', [inst('n', `c${i + 1}`)])
        : master([txt('t')]),
      { props: [] },
    ),
  )
  const key = 'n.'.repeat(D - 1) + 't'
  const deep = (o: object) =>
    withComps(
      [
        {
          id: 'i1',
          kind: 'instance',
          name: 'I',
          slot: fs(),
          component: 'c0',
          overrides: { [key]: o },
        },
      ],
      ...comps,
    )
  assert.ok(ids(deep(evil)).has('i1'), 'refused however deep')
  assert.deepEqual(validateSite(deep({ hide: { phone: true } }), reg), [])
})

test('slot children are checked against the slot part', () => {
  const slotted = (kind: string) =>
    comp(
      'card',
      node('root', 'box', [
        n({
          id: 'body',
          kind,
          name: 'Body',
          slot: {},
          ...(kind === 'button' ? { props: { label: 'Go' } } : {}),
        }),
      ]),
      {
        props: [
          { key: 'content', label: 'Content', type: 'slot', part: 'body' },
        ],
      },
    )
  const withKid = (kid: unknown, kind: string) =>
    withComps([using({ children: [kid] })], slotted(kind))
  assert.deepEqual(
    validateSite(withKid(txt('k'), 'column'), reg),
    [],
    'a text in a stack slot',
  )
  const box = { id: 's', kind: 'box', name: 'Section', slot: {}, children: [] }
  assert.ok(ids(withKid(box, 'button')).has('i1'), 'a box in a button slot')
  assert.ok(
    codes({ ...put(), components: [slotted('button')] }).includes(
      'INVALID_NODE',
    ),
    'a slot must be a container',
  )
  assert.ok(
    ids(withComps([using({ children: [txt('k')] })], comp('card'))).has('i1'),
    'a component with no slot has no place for children',
  )
})

test('component properties: one slot, nothing inside a repeat, binds only to bindable parts', () => {
  const slotProp = (key: string, part: string) => ({
    key,
    label: key,
    type: 'slot' as const,
    part,
  })
  const two = comp(
    'card',
    master([
      n({ id: 'a', kind: 'column', name: 'A', slot: {} }),
      n({ id: 'b', kind: 'column', name: 'B', slot: {} }),
    ]),
    { props: [slotProp('one', 'a'), slotProp('two', 'b')] },
  )
  assert.ok(
    messages({ ...put(), components: [two] }).some(m =>
      /only one slot/.test(m),
    ),
  )
  const list = n({
    id: 'l',
    kind: 'list',
    name: 'L',
    slot: {},
    repeat: { source: 'projects' },
    children: [
      { id: 'it', kind: 'box', name: 'I', slot: {}, children: [txt('title')] },
    ],
  })
  const inside = comp('card', master([list]), {
    props: [
      { key: 'title', label: 'T', type: 'text', part: 'title', field: 'text' },
    ],
  })
  assert.ok(
    messages({ ...put(), components: [inside] }).some(m =>
      /inside a repeating list/.test(m),
    ),
  )
  const img = comp(
    'card',
    master([
      n({
        id: 'pic',
        kind: 'image',
        name: 'P',
        slot: {},
        props: { assetId: 'img1' },
      }),
    ]),
    {
      props: [
        { key: 'x', label: 'X', type: 'text', part: 'pic', field: 'label' },
      ],
    },
  )
  const bound = (c: Comp, bind: object) =>
    ({
      ...put(
        listOver('projects', [
          item([
            {
              id: 'i1',
              kind: 'instance',
              name: 'C',
              slot: {},
              component: 'card',
              bind,
            },
          ]),
        ]),
      ),
      components: [c],
    }) as unknown
  assert.ok(
    ids(bound(img, { x: row('title') })).has('i1'),
    'an image cannot bind a label',
  )
  const c = comp('card')
  assert.deepEqual(
    validateSite(bound(c, { title: row('title') }), reg),
    [],
    'a bind goes to a property of the component',
  )
  assert.ok(
    ids(bound(c, { other: row('title') })).has('i1'),
    'not to a property it lacks',
  )
  assert.ok(
    ids(withComps([using({ bind: { title: row('title') } })], c)).has('i1'),
    'and needs a list around it',
  )
})

test('layers through a component in a list: no open layer, no dialog directly under the list', () => {
  const layer = (props: object, wrap = false) =>
    comp(
      'lay',
      wrap
        ? node('root', 'box', [
            n({
              id: 'd',
              kind: 'box',
              name: 'D',
              slot: {},
              props,
              children: [txt('m')],
            }),
          ])
        : n({
            id: 'root',
            kind: 'box',
            name: 'R',
            slot: {},
            props,
            children: [txt('m')],
          }),
      { props: [] },
    )
  const inList = (component = 'lay', inItem = false) => {
    const instance = {
      id: 'c1',
      kind: 'instance',
      name: 'C',
      slot: {},
      component,
    }
    return put(listOver('projects', [inItem ? item([instance]) : instance]))
  }
  const run = (cs: Comp[], d: ReturnType<typeof put>) =>
    messages({ ...d, components: cs })
  assert.ok(
    run(
      [layer({ layer: 'popover-manual', open: true })],
      inList('lay', true),
    ).some(m => /can't start open/.test(m)),
  )
  assert.ok(
    run([layer({ layer: 'dialog' })], inList('lay', false)).some(m =>
      /Nest the dialog/.test(m),
    ),
    'a dialog root straight under the list',
  )
  assert.deepEqual(
    run([layer({ layer: 'dialog' })], inList('lay', true)),
    [],
    'nested in the item it is fine',
  )
  assert.deepEqual(
    run([layer({ layer: 'popover-auto' })], inList('lay', true)),
    [],
  )
  assert.ok(
    !run(
      [layer({ layer: 'popover-manual', open: true })],
      put({
        id: 'c1',
        kind: 'instance',
        name: 'C',
        slot: fs(),
        component: 'lay',
      }),
    ).some(m => /start open/.test(m)),
    'outside a list nothing changes',
  )
  const wrap = comp('wrap', node('root', 'box', [inst('in', 'lay')]), {
    props: [],
  })
  assert.ok(
    run(
      [layer({ layer: 'popover-manual', open: true }), wrap],
      inList('wrap', true),
    ).some(m => /can't start open/.test(m)),
    'through a nested component',
  )
})

test("an instance's values are held to the target part's own limits", () => {
  const parts = node('root', 'box', [
    n({
      id: 'go',
      kind: 'button',
      name: 'Go',
      slot: {},
      props: { label: 'Go' },
    }),
    n({ id: 'pic', kind: 'image', name: 'Pic', slot: {}, props: { alt: 'x' } }),
  ])
  const c = comp('card', parts, {
    props: [
      {
        key: 'label',
        label: 'Label',
        type: 'text',
        part: 'go',
        field: 'label',
      },
      { key: 'alt', label: 'Alt', type: 'text', part: 'pic', field: 'alt' },
    ],
  })
  const set = (s: object) => messages(withComps([using({ set: s })], c))
  assert.deepEqual(set({ label: 'a'.repeat(120), alt: 'b'.repeat(300) }), [])
  assert.ok(
    set({ label: 'a'.repeat(121) }).some(m => m.includes('"label"')),
    'label over 120',
  )
  assert.ok(
    set({ alt: 'b'.repeat(301) }).some(m => m.includes('"alt"')),
    'alt over 300',
  )
  assert.deepEqual(codes(withComps([using({ set: { label: 5 } })], c)), [
    'INVALID_NODE',
  ])
})

test("a run-link property is held to the run's own link rules", () => {
  const line = node('root', 'box', [
    n({
      id: 'meta',
      kind: 'text',
      name: 'Meta',
      slot: {},
      props: { level: 'p', runs: [{ text: 'a' }, { text: 'b' }] },
    }),
  ])
  const c = comp('card', line, {
    props: [
      {
        key: 'see',
        label: 'See',
        type: 'link',
        part: 'meta',
        field: 'link',
        run: 1,
      },
    ],
  })
  const set = (v: unknown) => codes(withComps([using({ set: { see: v } })], c))
  assert.deepEqual(set({ url: 'https://x.org' }), [])
  assert.deepEqual(set({ url: 'javascript:alert(1)' }), ['INVALID_NODE'])
})

test('a state across a component boundary is refused when the page already has it', () => {
  const m = n({
    id: 'm',
    kind: 'box',
    name: 'M',
    slot: {},
    state: [{ name: 'tab', values: ['a', 'b'], initial: 'a' }],
    children: [],
  })
  const stateful = comp('card', m, { props: [] })
  const use = (extra = {}) => ({
    id: 'u',
    kind: 'instance',
    name: 'U',
    slot: {},
    component: 'card',
    ...extra,
  })
  assert.deepEqual(
    validateSite(withComps([{ ...use(), slot: fs() }], stateful), reg),
    [],
    'alone it is fine',
  )
  const inside = validateSite(withComps([holder({}, [use()])], stateful), reg)
  assert.ok(
    inside.some(
      p =>
        p.message ===
        'card has a state called tab, which this part of the page already has.',
    ),
    messages(inside).join('|'),
  )
  const own = validateSite(
    withComps(
      [
        {
          ...use({
            state: [{ name: 'tab', values: ['x', 'y'], initial: 'x' }],
          }),
          slot: fs(),
        },
      ],
      stateful,
    ),
    reg,
  )
  assert.ok(
    own.some(p => /already held by its component/.test(p.message)),
    messages(own).join('|'),
  )
  const slotted = {
    ...stateful,
    props: [{ key: 'body', label: 'Body', type: 'slot' as const, part: 'm' }],
  }
  assert.deepEqual(
    validateSite(
      withComps(
        [{ ...use({ children: [reacts('k', 'tab', 'b')] }), slot: fs() }],
        slotted,
      ),
      reg,
    ),
    [],
    'slot children see the master state',
  )
})

test('a wide chain of components is checked in bounded time', () => {
  const N = 50
  const W = 1000
  const comps = Array.from({ length: N }, (_, i) =>
    comp(
      `c${i}`,
      i + 1 < N
        ? node(
            'root',
            'column',
            Array.from({ length: W }, (_, k) => inst(`k${k}`, `c${i + 1}`)),
          )
        : master([txt('t')]),
      { props: [] },
    ),
  )
  const t0 = performance.now()
  const ps = validateSite(
    withComps([using({ component: 'c0' })], ...comps),
    reg,
  )
  assert.deepEqual(ps, [])
  assert.ok(performance.now() - t0 < 2000, `took ${performance.now() - t0}ms`)
})

test("an instance's list limit stops at the rows a list can show", () => {
  const parts = node('root', 'box', [
    n({
      id: 'lst',
      kind: 'list',
      name: 'Rows',
      slot: {},
      repeat: { source: 'projects', max: 3 },
      children: [node('it', 'column')],
    }),
  ])
  const c = comp('card', parts, {
    props: [
      {
        key: 'rows',
        label: 'Rows',
        type: 'number',
        part: 'lst',
        field: 'limit',
      },
    ],
  })
  const set = (rows: number) => codes(withComps([using({ set: { rows } })], c))
  assert.deepEqual(set(200), [])
  assert.deepEqual(set(201), ['INVALID_NODE'])
})

test("an instance's look must be one the component has", () => {
  const c = comp('card', node('root', 'box'), {
    props: [
      {
        key: 'look',
        label: 'Look',
        type: 'choice',
        options: ['default', 'big'],
      },
    ],
  })
  const set = (look: string) => codes(withComps([using({ set: { look } })], c))
  assert.deepEqual(set('big'), [])
  assert.deepEqual(set('gone'), ['INVALID_NODE'])
})
