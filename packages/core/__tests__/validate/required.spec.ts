import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate, type Node } from '../../src/document/index.ts'
import { unrollInstances } from '../../src/data/bind.ts'
import { validateSite } from '../../src/validate/index.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { dv, fs, n, put, reg, text as t0 } from './helpers.ts'
import { bigPage, node as kn, siteWith, text as kt } from '../kit.ts'

const text0 = (id: string) => t0(id, { slot: fs() })

const text = (id: string, extra: object = {}) =>
  t0(id, { slot: fs(), ...extra })
const withRange = (d: ReturnType<typeof put>, min = 11, max = 96) => ({
  ...d,
  styles: { ...defaultSiteStyles(d.look), textRange: { min, max } },
})
const form = (extra: object = {}) =>
  n({
    id: 'f',
    kind: 'form',
    name: 'f',
    slot: fs(),
    props: { formId: 'f' },
    children: [
      n({
        id: 'a',
        kind: 'field',
        name: 'a',
        slot: {},
        props: { name: 'email', label: 'A' },
      }),
    ],
    ...extra,
  })

test('a required title hidden on phone: POLICY_VIOLATION, rule required, nodeId the title, path hide.phone', () => {
  const p = validateSite(
    put(text('title', { required: true, hide: { phone: true } })),
    reg,
  )
  assert.deepEqual(
    p.map(x => [x.code, x.rule, x.nodeId, x.path]),
    [['POLICY_VIOLATION', 'required', 'title', 'hide.phone']],
  )
})

test('a required text with no run that has text or a binding: rule required, path props.runs', () => {
  const empty = put(
    n({
      ...text('t', { required: true }),
      props: { level: 'p', runs: [{ text: '' }] },
    }),
  )
  const p = validateSite(empty, reg)
  assert.deepEqual(
    p.map(x => [x.code, x.rule, x.nodeId, x.path]),
    [['POLICY_VIOLATION', 'required', 't', 'props.runs']],
  )
  const bound = put(
    n({
      ...text('t', { required: true }),
      props: {
        level: 'p',
        runs: [{ text: '', bind: { from: 'site', field: 'title' } }],
      },
    }),
  )
  assert.deepEqual(validateSite(bound, reg), [])
})

test('size 8 on the phone layer with textRange 11..96: rule textRange, path style.phone.size, allowed ["11","96"]', () => {
  const d = withRange(put(text('t', { style: { phone: { size: 8 } } })))
  const p = validateSite(d, reg)
  assert.equal(p.length, 1)
  assert.equal(p[0].code, 'POLICY_VIOLATION')
  assert.equal(p[0].rule, 'textRange')
  assert.equal(p[0].nodeId, 't')
  assert.equal(p[0].path, 'style.phone.size')
  assert.deepEqual(p[0].allowed, ['11', '96'])
})

test('a form hidden on phone is refused; the same form with required: false is accepted', () => {
  const hidden = validateSite(put(form({ hide: { phone: true } })), reg)
  assert.ok(hidden.some(x => x.rule === 'required' && x.nodeId === 'f'))
  assert.ok(hidden.some(x => x.rule === 'required' && x.nodeId === 'a'))
  assert.deepEqual(
    validateSite(put(form({ hide: { phone: true }, required: false })), reg),
    [],
  )
})

test('no textRange: no size is refused', () => {
  assert.deepEqual(
    validateSite(put(text('t', { style: { phone: { size: 9 } } })), reg),
    [],
  )
})

test('a showIf on a required node is accepted', () => {
  const d = put(
    text('t', { required: true, showIf: { from: 'site', field: 'title' } }),
  )
  assert.deepEqual(validateSite(d, reg), [])
  // the same document without the condition and with no text is refused, so the check ran
  const twin = put(
    text('t', { required: true, props: { level: 'p', runs: [{ text: '' }] } }),
  )
  assert.equal(validateSite(twin, reg)[0]?.rule, 'required')
})

test('a divider needs no content and is not required without a mark', () => {
  assert.deepEqual(
    validateSite(put(dv('d', { hide: { phone: true } })), reg),
    [],
  )
})

test('a version 1 document with a form hidden on phone has no problems after migrate', () => {
  const d = { ...put(form({ hide: { phone: true } })), schemaVersion: 1 }
  const r = migrate(d)
  assert.ok(r.ok)
  assert.deepEqual(validateSite(r.doc, reg), [])
})

const empty = n({
  id: 'root',
  kind: 'box',
  name: 'root',
  slot: {},
  children: [
    n({
      id: 'title',
      kind: 'text',
      name: 'title',
      slot: {},
      required: true,
      props: { level: 'p', runs: [{ text: '' }] },
    }),
  ],
})
const withInstance = (
  inst: object,
  prop: object = {},
  used = true,
  master: Node = empty,
) => ({
  ...put(
    ...(used
      ? [
          n({
            id: 'i1',
            kind: 'instance',
            name: 'i1',
            slot: fs(),
            component: 'c1',
            ...inst,
          }),
        ]
      : []),
  ),
  components: [
    {
      id: 'c1',
      name: 'c1',
      root: master,
      props: [
        {
          key: 'title',
          label: 'Title',
          type: 'text' as const,
          part: 'title',
          field: 'text' as const,
          ...prop,
        },
      ],
      variants: [],
    },
  ],
})
const refused = (d: object) =>
  validateSite(d, reg).map(x => [x.rule, x.nodeId, x.path])

test('a required text filled by a property: unset with no default, or set to "", is refused at the instance', () => {
  for (const inst of [{}, { set: { title: '' } }])
    assert.deepEqual(refused(withInstance(inst)), [
      ['required', 'i1', 'parts.title.props.runs'],
    ])
})

test('a required text filled by a property: a set value, a binding and a default are accepted', () => {
  assert.deepEqual(
    validateSite(withInstance({ set: { title: 'Hi' } }), reg),
    [],
  )
  assert.deepEqual(
    validateSite(
      withInstance({ bind: { title: { from: 'site', field: 'title' } } }),
      reg,
    ),
    [],
  )
  assert.deepEqual(
    validateSite(withInstance({}, { default: 'Hello' }), reg),
    [],
  )
})

test('a component nobody uses raises nothing', () => {
  assert.deepEqual(validateSite(withInstance({}, {}, false), reg), [])
})

const hi = n({
  ...empty,
  children: [
    {
      ...(empty.children as Node[])[0],
      props: { level: 'p', runs: [{ text: 'Hi' }] },
    },
  ],
})
const over = { overrides: { title: { props: { runs: [{ text: 'Over' }] } } } }

test('judged by the runs the page shows: set and default can blank a text, an override and a default can fill one', () => {
  const one = (d: object) => refused(d).map(x => x[2])
  assert.deepEqual(validateSite(withInstance(over), reg), [])
  assert.deepEqual(one(withInstance({ set: { title: '' } }, {}, true, hi)), [
    'parts.title.props.runs',
  ])
  assert.deepEqual(one(withInstance({}, { default: '' }, true, hi)), [
    'parts.title.props.runs',
  ])
  assert.deepEqual(validateSite(withInstance({}, { default: 'D' }), reg), [])
  assert.deepEqual(
    validateSite(withInstance({ set: { title: '' }, ...over }), reg),
    [],
  )
  assert.deepEqual(validateSite(withInstance({}, {}, true, hi), reg), [])
  assert.deepEqual(one(withInstance({})), ['parts.title.props.runs'])
})

test('a part with no text property is judged at parts.<part>.props.runs', () => {
  const d = withInstance({}, {})
  d.components[0].props = []
  assert.deepEqual(refused(d), [['required', 'i1', 'parts.title.props.runs']])
})

test('a variant patch can supply the text', () => {
  const d = withInstance({ set: { look: 'b' } })
  d.components[0].props.push({
    key: 'look',
    label: 'L',
    type: 'choice',
    options: ['a', 'b'],
  } as never)
  ;(d.components[0] as { variants: unknown[] }).variants = [
    {
      when: { look: 'b' },
      patch: { title: { props: { runs: [{ text: 'V' }] } } },
    },
  ]
  assert.deepEqual(validateSite(d, reg), [])
  d.components[0].variants = [] as never
  assert.equal(refused(d).length, 1)
})

// ---- the part as the page shows it (final fix wave, group A) ----

/** A component `c1` with a required, two-run title, used once as `i1`. `props` and `variants` are the component's; `inst` is the use. */
const shownDoc = (
  props: object[],
  variants: object[],
  inst: object = {},
  titleExtra: object = {},
) => ({
  ...put(
    n({
      id: 'i1',
      kind: 'instance',
      name: 'i1',
      slot: fs(),
      component: 'c1',
      ...inst,
    }),
  ),
  components: [
    {
      id: 'c1',
      name: 'c1',
      root: n({
        id: 'root',
        kind: 'box',
        name: 'root',
        slot: {},
        children: [
          n({
            id: 'title',
            kind: 'text',
            name: 'title',
            slot: {},
            required: true,
            props: {
              level: 'p',
              runs: [{ text: 'Hello' }, { text: 'World' }],
            },
            ...titleExtra,
          }),
        ],
      }),
      props,
      variants,
    },
  ],
})
const toggle = (extra: object = {}) => ({
  key: 'show',
  label: 'Show',
  type: 'toggle',
  part: 'title',
  field: 'hidden',
  ...extra,
})
const size = (extra: object = {}) => ({
  key: 'sz',
  label: 'Size',
  type: 'number',
  part: 'title',
  field: 'fontSize',
  ...extra,
})
const look = {
  key: 'look',
  label: 'Look',
  type: 'choice',
  options: ['a', 'b'],
}
const ranged = (d: ReturnType<typeof shownDoc>) => withRange(d as never)
const probs = (d: object) =>
  validateSite(d, reg).map(x => [x.rule, x.nodeId, x.path])

test('hiding through a toggle property: a default of false and a set value of false are refused', () => {
  assert.deepEqual(probs(shownDoc([toggle({ default: false })], [])), [
    ['required', 'i1', 'parts.title.style.base.hidden'],
  ])
  assert.deepEqual(
    probs(shownDoc([toggle({ default: true })], [], { set: { show: false } })),
    [['required', 'i1', 'parts.title.style.base.hidden']],
  )
  assert.deepEqual(
    probs(shownDoc([toggle({ default: false })], [], { set: { show: true } })),
    [],
  )
  assert.deepEqual(probs(shownDoc([toggle({ default: true })], [])), [])
})

test('a toggle bound to data is a condition and out of reach', () => {
  const bound = shownDoc([toggle({ default: true })], [], {
    bind: { show: { from: 'site', field: 'title' } },
  })
  assert.deepEqual(probs(bound), [])
})

test('a required part hidden by a variant patch or an override style is refused whichever way it is written', () => {
  const variant = shownDoc(
    [look],
    [
      {
        when: { look: 'b' },
        patch: { title: { style: { base: { hidden: true } } } },
      },
    ],
    { set: { look: 'b' } },
  )
  assert.equal(probs(variant).length, 1)
  assert.equal(probs(variant)[0][0], 'required')
  const over = shownDoc([], [], {
    overrides: { title: { style: { phone: { hidden: true } } } },
  })
  assert.equal(probs(over)[0]?.[0], 'required')
})

test('sizes written through an instance or a component are held to the text range', () => {
  const at = (d: object) => probs(ranged(d as never))
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: { title: { style: { base: { size: 8 } } } },
      }),
    ),
    [['textRange', 'i1', 'parts.title.style.base.size']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: {
          title: { props: { runs: [{ text: 'x', style: { size: 8 } }] } },
        },
      }),
    ),
    [['textRange', 'i1', 'parts.title.props.runs.0.style.size']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: {
          title: {
            style: {
              when: [{ state: 'tab', is: 'papers', decl: { size: 8 } }],
            },
          },
        },
      }),
    ),
    [['textRange', 'i1', 'parts.title.style.when.0.decl.size']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: {
          title: { style: { base: { fluidSize: { min: 8, max: 20 } } } },
        },
      }),
    ),
    [['textRange', 'i1', 'parts.title.style.base.fluidSize.min']],
  )
  assert.deepEqual(
    at(
      shownDoc(
        [look],
        [
          {
            when: { look: 'b' },
            patch: { title: { style: { phone: { size: 8 } } } },
          },
        ],
        { set: { look: 'b' } },
      ),
    ),
    [['textRange', 'i1', 'parts.title.style.phone.size']],
  )
  assert.deepEqual(at(shownDoc([size()], [], { set: { sz: 8 } })), [
    ['textRange', 'i1', 'parts.title.style.base.size'],
  ])
  assert.deepEqual(at(shownDoc([size({ default: 8 })], [])), [
    ['textRange', 'i1', 'parts.title.style.base.size'],
  ])
  assert.deepEqual(at(shownDoc([size()], [], { set: { sz: 20 } })), [])
})

test('the text range reaches a component part that is not required', () => {
  const d = shownDoc([], [], {
    overrides: { title: { style: { base: { size: 8 } } } },
  })
  delete d.components[0].root.children![0].required
  assert.equal(probs(ranged(d))[0]?.[0], 'textRange')
})

test('a whitespace-only run is not content', () => {
  const ws = (text: string) =>
    put(
      n({
        ...text0('t'),
        required: true,
        props: { level: 'p', runs: [{ text }] },
      }),
    )
  assert.deepEqual(probs(ws('   ')), [['required', 't', 'props.runs']])
  assert.deepEqual(probs(ws(' \n\t')), [['required', 't', 'props.runs']])
  assert.deepEqual(probs(ws(' a ')), [])
  const c = shownDoc(
    [{ key: 'title', label: 'T', type: 'text', part: 'title', field: 'text' }],
    [],
    { set: { title: '  ' } },
  )
  assert.deepEqual(probs(c), [['required', 'i1', 'parts.title.props.runs']])
})

// A component inside a component: the instance of the outer one can reach the inner part as `<inner>.<part>`.
const nested = (overrides: object, innerText = 'Hello') => {
  const d = shownDoc(
    [],
    [],
    {},
    { props: { level: 'p', runs: [{ text: innerText }] } },
  )
  d.components.push({
    id: 'c2',
    name: 'c2',
    root: n({
      id: 'root2',
      kind: 'box',
      name: 'root2',
      slot: {},
      children: [
        n({ id: 'k', kind: 'instance', name: 'k', slot: {}, component: 'c1' }),
      ],
    }),
    props: [],
    variants: [],
  })
  d.pages[0].root.children = [
    n({
      id: 'o',
      kind: 'instance',
      name: 'o',
      slot: fs(),
      component: 'c2',
      overrides,
    }),
  ]
  return d
}

test('an override an outer instance gives a nested part is judged: sizes, content and hiding', () => {
  assert.deepEqual(
    probs(
      ranged(nested({ 'k.title': { style: { base: { size: 8 } } } }) as never),
    ),
    [['textRange', 'o', 'parts.k.title.style.base.size']],
  )
  assert.deepEqual(
    probs(nested({ 'k.title': { props: { runs: [{ text: '' }] } } })),
    [['required', 'o', 'parts.k.title.props.runs']],
  )
  assert.deepEqual(
    probs(nested({ 'k.title': { props: { runs: [{ text: 'Filled' }] } } }, '')),
    [],
  )
  assert.equal(
    probs(nested({ 'k.title': { hide: { phone: true } } }))[0]?.[0],
    'required',
  )
})

// ---- second fix round, H1: nested overrides are judged for every use ----

/**
 * `count` uses `o0 ... o<count-1>` of an outer component that holds a nested component with a required title.
 * `over` maps a use's index to its overrides. With `levels` 3 an outermost component holds the outer one as `o`.
 */
const many = (
  count: number,
  over: Record<number, object> = {},
  levels = 2,
  innerText = 'Hello',
) => {
  const d = nested({}, innerText)
  const outer = levels === 3 ? 'c3' : 'c2'
  if (levels === 3)
    d.components.push({
      id: 'c3',
      name: 'c3',
      root: n({
        id: 'root3',
        kind: 'box',
        name: 'root3',
        slot: {},
        children: [
          n({
            id: 'o',
            kind: 'instance',
            name: 'o',
            slot: {},
            component: 'c2',
          }),
        ],
      }),
      props: [],
      variants: [],
    })
  d.pages[0].root.children = Array.from({ length: count }, (_, i) =>
    n({
      id: `u${i}`,
      kind: 'instance',
      name: `u${i}`,
      slot: fs(),
      component: outer,
      ...(over[i] ? { overrides: over[i] } : {}),
    }),
  )
  return d
}
const empties = { 'k.title': { props: { runs: [{ text: '' }] } } }
const small = { 'k.title': { style: { base: { size: 8 } } } }
const codes = (d: object) =>
  validateSite(d, reg).map(x => [x.code, x.nodeId, x.path])

test('H1: an outer override past the ninth use is judged: emptied runs and size 8', () => {
  for (const total of [9, 20])
    for (const at of [total - 1, 3]) {
      assert.deepEqual(
        probs(many(total, { [at]: empties })),
        [['required', `u${at}`, 'parts.k.title.props.runs']],
        `empty, ${total} uses, at ${at}`,
      )
      assert.deepEqual(
        probs(ranged(many(total, { [at]: small }) as never)),
        [['textRange', `u${at}`, 'parts.k.title.style.base.size']],
        `size, ${total} uses, at ${at}`,
      )
    }
})

test('H1: three levels, the override given by the outermost instance, past the ninth use', () => {
  const key = (o: object) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [`o.${k}`, v]))
  assert.deepEqual(probs(many(12, { 11: key(empties) }, 3)), [
    ['required', 'u11', 'parts.o.k.title.props.runs'],
  ])
  assert.deepEqual(probs(ranged(many(12, { 11: key(small) }, 3) as never)), [
    ['textRange', 'u11', 'parts.o.k.title.style.base.size'],
  ])
})

test('H1: hiding past the ninth use is refused through each shape', () => {
  for (const o of [
    { 'k.title': { hide: { phone: true } } },
    { 'k.title': { style: { base: { hidden: true } } } },
    { 'k.title': { style: { phone: { hidden: true } } } },
    { k: { hide: { desktop: true } } },
  ])
    assert.equal(
      probs(many(15, { 14: o }))[0]?.[0],
      'required',
      JSON.stringify(o),
    )
})

test('H1: 200 uses with no overrides are valid, quickly, and do not hit the bound', () => {
  const d = ranged(many(200) as never)
  const t0 = performance.now()
  assert.deepEqual(codes(d), [])
  assert.ok(performance.now() - t0 < 2000)
})

test('H1: harmless overrides on many uses are valid', () => {
  const colour = { 'k.title': { style: { base: { color: 'brand' } } } }
  const over = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [i, colour]),
  )
  assert.deepEqual(codes(ranged(many(30, over) as never)), [])
})

test('H1: 300 uses, each with a harmless override, are valid: there is no bound on the ways left to reach', () => {
  const colour = { 'k.title': { style: { base: { color: 'brand' } } } }
  const over = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [i, colour]),
  )
  const d = many(300, over)
  d.pages[0].root.kind = 'column'
  for (const c of d.pages[0].root.children!) c.slot = {}
  assert.deepEqual(validateSite(d, reg), [])
  // and a bad override on the last of them is still found
  d.pages[0].root.children![299].overrides = empties
  assert.deepEqual(probs(d), [['required', 'u299', 'parts.k.title.props.runs']])
})

// ---- second fix round, H2: a required instance, or content in its slot, hidden from inside the component ----

/** A component `c1` whose root `croot` holds a slot host `body`; a required instance `i1` of it, holding a required text `rt` in its slot. */
const hosted = (inst: object = {}, props: object[] = [], withText = true) => {
  const d = put(
    n({
      id: 'i1',
      kind: 'instance',
      name: 'i1',
      slot: fs(),
      component: 'c1',
      required: true,
      ...(withText
        ? {
            children: [
              n({
                id: 'rt',
                kind: 'text',
                name: 'rt',
                slot: {},
                required: true,
                props: { level: 'p', runs: [{ text: 'In the slot' }] },
              }),
            ],
          }
        : {}),
      ...inst,
    }),
  )
  return {
    ...d,
    components: [
      {
        id: 'c1',
        name: 'c1',
        root: n({
          id: 'croot',
          kind: 'box',
          name: 'croot',
          slot: {},
          children: [
            n({
              id: 'body',
              kind: 'box',
              name: 'body',
              slot: {},
              children: [],
            }),
          ],
        }),
        props: [
          { key: 'content', label: 'Content', type: 'slot', part: 'body' },
          ...props,
        ],
        variants: [],
      },
    ],
  }
}
const showing = (part: string, extra: object = {}) => ({
  key: 'show',
  label: 'Show',
  type: 'toggle',
  part,
  field: 'hidden',
  ...extra,
})

test('H2: a required instance hidden through its component root is refused, with the instance and where it is written', () => {
  assert.deepEqual(
    probs(
      hosted(
        { overrides: { croot: { style: { base: { hidden: true } } } } },
        [],
        false,
      ),
    ),
    [['required', 'i1', 'style.base.hidden']],
  )
  // a hide an override gives the component root is dropped by the unroll (m1): the instance is shown
  assert.deepEqual(
    probs(
      hosted({ overrides: { croot: { hide: { phone: true } } } }, [], false),
    ),
    [],
  )
  assert.deepEqual(
    probs(
      hosted(
        { set: { show: false } },
        [showing('croot', { default: true })],
        false,
      ),
    ),
    [['required', 'i1', 'style.base.hidden']],
  )
  // the visible twins
  assert.deepEqual(
    probs(hosted({}, [showing('croot', { default: true })], false)),
    [],
  )
  assert.deepEqual(
    probs(
      hosted(
        { set: { show: true } },
        [showing('croot', { default: false })],
        false,
      ),
    ),
    [],
  )
  assert.deepEqual(
    probs(
      hosted(
        { overrides: { croot: { style: { base: { color: 'brand' } } } } },
        [],
        false,
      ),
    ),
    [],
  )
})

test('H2: content in an instance slot is refused when the slot host, or a part above it, is hidden by the use', () => {
  // the content is a page node: it is reported at its own id with no path (the hiding is on the host), and the message names the host
  const refused = (d: object, how: string) => {
    const p = validateSite(d, reg)
    assert.deepEqual(
      p.map(x => [x.rule, x.nodeId, x.path]),
      [['required', 'rt', undefined]],
      how,
    )
    assert.match(p[0].message, /i1\.body/)
  }
  refused(
    hosted({ overrides: { body: { hide: { phone: true } } } }),
    'hide.phone',
  )
  refused(
    hosted({ overrides: { body: { style: { base: { hidden: true } } } } }),
    'style.base.hidden',
  )
  refused(
    hosted({ set: { show: false } }, [showing('body', { default: true })]),
    'style.base.hidden',
  )
  // the instance and its content hidden through the root's style: one problem each
  assert.deepEqual(
    probs(
      hosted({ overrides: { croot: { style: { phone: { hidden: true } } } } }),
    ),
    [
      ['required', 'i1', 'style.phone.hidden'],
      ['required', 'rt', undefined],
    ],
  )
  // a hide an override gives the root is dropped by the unroll (m1)
  assert.deepEqual(
    probs(hosted({ overrides: { croot: { hide: { desktop: true } } } })),
    [],
  )
  // the visible twins
  assert.deepEqual(probs(hosted()), [])
  assert.deepEqual(probs(hosted({}, [showing('body', { default: true })])), [])
  assert.deepEqual(
    probs(
      hosted({ set: { show: true } }, [showing('body', { default: false })]),
    ),
    [],
  )
  assert.deepEqual(
    probs(
      hosted({ overrides: { body: { style: { base: { color: 'brand' } } } } }),
    ),
    [],
  )
})

// ---- second fix round, F1 and M-c: only a look in use hides; a part shown by its use is visible ----

const hidingLook = [
  { when: { look: 'b' }, patch: { title: { hide: { phone: true } } } },
]
test('F1: a look that hides a required part is fine while no use selects it', () => {
  assert.deepEqual(probs(shownDoc([look], hidingLook, {})), [])
  assert.deepEqual(
    probs(shownDoc([look], hidingLook, { set: { look: 'a' } })),
    [],
  )
})

test('F1: the same look selected by one of two uses is refused', () => {
  const d = shownDoc([look], hidingLook, { set: { look: 'b' } })
  d.pages[0].root.children!.push(
    n({ id: 'i2', kind: 'instance', name: 'i2', slot: fs(), component: 'c1' }),
  )
  const p = probs(d)
  assert.equal(p.length, 1)
  assert.equal(p[0][0], 'required')
  assert.equal(p[0][1], 'i1', 'names the use that selects the look')
})

test('M-c: a master part hidden for good is shown by a use that turns it on, and refused for a use that does not', () => {
  const hiddenMaster = { style: { base: { hidden: true } } }
  const tog = toggle({ default: false })
  // shown for the use that sets the toggle on
  assert.deepEqual(
    probs(shownDoc([tog], [], { set: { show: true } }, hiddenMaster)),
    [],
  )
  // not turned on: still hidden
  assert.equal(probs(shownDoc([tog], [], {}, hiddenMaster))[0]?.[0], 'required')
  assert.equal(probs(shownDoc([], [], {}, hiddenMaster))[0]?.[0], 'required')
  // two uses: only the one that does not turn it on is refused
  const d = shownDoc([tog], [], { set: { show: true } }, hiddenMaster)
  d.pages[0].root.children!.push(
    n({ id: 'i2', kind: 'instance', name: 'i2', slot: fs(), component: 'c1' }),
  )
  assert.equal(probs(d).length, 1)
})

// ---- second fix round, M-a and M-b ----

test('M-a: an emptied part is reported at the instance and the part, however it was emptied', () => {
  const textProp = {
    key: 'words',
    label: 'W',
    type: 'text',
    part: 'title',
    field: 'text',
  }
  const emptied = { props: { runs: [{ text: '' }] } }
  // an override did it, although the component has a text property for the part
  assert.deepEqual(
    probs(
      shownDoc([textProp], [], {
        set: { words: 'Hi' },
        overrides: { title: emptied },
      }),
    ),
    [['required', 'i1', 'parts.title.props.runs']],
  )
  // the set did it
  assert.deepEqual(probs(shownDoc([textProp], [], { set: { words: '' } })), [
    ['required', 'i1', 'parts.title.props.runs'],
  ])
  // an override from an instance further out
  assert.deepEqual(probs(nested({ 'k.title': emptied })), [
    ['required', 'o', 'parts.k.title.props.runs'],
  ])
})

test('M-b: a required part hidden for a use is reported on the use, one shape for every way', () => {
  const at = (d: object) =>
    validateSite(d, reg).map(x => [x.code, x.rule, x.nodeId, x.path])
  const POLICY = 'POLICY_VIOLATION'
  // a property default
  assert.deepEqual(at(shownDoc([toggle({ default: false })], [])), [
    [POLICY, 'required', 'i1', 'parts.title.style.base.hidden'],
  ])
  // a set value
  assert.deepEqual(
    at(shownDoc([toggle({ default: true })], [], { set: { show: false } })),
    [[POLICY, 'required', 'i1', 'parts.title.style.base.hidden']],
  )
  // overrides
  assert.deepEqual(
    at(shownDoc([], [], { overrides: { title: { hide: { phone: true } } } })),
    [[POLICY, 'required', 'i1', 'parts.title.hide.phone']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: { title: { style: { base: { hidden: true } } } },
      }),
    ),
    [[POLICY, 'required', 'i1', 'parts.title.style.base.hidden']],
  )
  // a look in use, with a message that names the part and the instance
  const d = shownDoc([look], hidingLook, { set: { look: 'b' } })
  assert.deepEqual(at(d), [
    [POLICY, 'required', 'i1', 'parts.title.hide.phone'],
  ])
  const msg = validateSite(d, reg)[0].message
  assert.match(msg, /"title"/)
  assert.match(msg, /"i1"/)
  // the use itself hidden, and an ancestor of the use: the node that carries the hiding
  assert.deepEqual(at(shownDoc([], [], { hide: { phone: true } })), [
    [POLICY, 'required', 'i1', 'parts.title'],
  ])
  const wrapped = shownDoc([], [])
  wrapped.pages[0].root.children = [
    n({
      id: 'wrap',
      kind: 'box',
      name: 'wrap',
      slot: fs(),
      style: { base: { hidden: true } },
      children: wrapped.pages[0].root.children,
    }),
  ]
  wrapped.pages[0].root.children[0].children![0].slot = {}
  assert.deepEqual(at(wrapped), [[POLICY, 'required', 'i1', 'parts.title']])
  assert.match(validateSite(wrapped, reg)[0].message, /"wrap"/)
  // hidden in the component's own tree: the same shape
  assert.deepEqual(at(shownDoc([], [], {}, { hide: { phone: true } })), [
    [POLICY, 'required', 'i1', 'parts.title.hide.phone'],
  ])
})

// ---- third fix round: judged on the tree the page is built from ----

/**
 * K: `kroot` > `kbox` > `title` (required). Level i > 1: `r<i>` > `b<i>` > `n<i>` (an instance of level i - 1). The page (or
 * the header) holds `u0`, an instance of the top level. `more` adds props and variants to a level by its number.
 */
const lv = (i: number) => `lv${i}`
const ninst = (id: string, component: string, more: object = {}) =>
  n({ id, kind: 'instance', name: id, slot: {}, component, ...more })
const levels = (
  depth: number,
  use: object = {},
  more: Record<
    number,
    { props?: object[]; variants?: object[]; inner?: object }
  > = {},
  where: 'page' | 'header' = 'page',
) => {
  const comps = Array.from({ length: depth }, (_, k) => {
    const i = k + 1
    const root =
      i === 1
        ? kn('kroot', 'box', [
            kn('kbox', 'box', [kt('title', 'Hi', { required: true })]),
          ])
        : kn(`r${i}`, 'box', [
            kn(`b${i}`, 'box', [
              ninst(`n${i}`, lv(i - 1), more[i - 1]?.inner ?? {}),
            ]),
          ])
    return {
      id: lv(i),
      name: lv(i),
      root,
      props: more[i]?.props ?? [],
      variants: more[i]?.variants ?? [],
    }
  })
  const top = ninst(where === 'page' ? 'u0' : 'h0', lv(depth), use)
  const d = siteWith(where === 'page' ? [top] : [])
  if (where === 'header') d.header = { ...d.header, children: [top] }
  ;(where === 'page' ? d.pages[0].root : d.header).state = [
    { name: 'tab', values: ['a', 'b'], initial: 'a' },
  ]
  d.components = comps as never
  return d
}
const toggleOn = (part: string, extra: object = {}) => ({
  key: 'show',
  label: 'show',
  type: 'toggle',
  part,
  field: 'hidden',
  ...extra,
})
const choice = {
  key: 'look',
  label: 'look',
  type: 'choice',
  options: ['a', 'b'],
}
const lookOn = (part: string, o: object, when: object = { look: 'b' }) => ({
  props: [choice],
  variants: [{ when, patch: { [part]: o } }],
})
const hidePhone = { hide: { phone: true } }
const baseHidden = { style: { base: { hidden: true } } }
const whenHidden = {
  style: { when: [{ state: 'tab', is: 'b', decl: { hidden: true } }] },
}
const req3 = (d: object) =>
  validateSite(d, reg)
    .filter(x => x.rule === 'required')
    .map(x => [x.rule, x.nodeId, x.path])

test('N1: an outer override hiding the box around the nested use, or the outer root, is refused at the outer instance and the part', () => {
  // the hiding is on an ancestor: the path is the part's, and the message names the ancestor
  const cases: [object, string][] = [
    [{ b2: hidePhone }, 'u0.b2'],
    [{ b2: baseHidden }, 'u0.b2'],
    [{ b2: whenHidden }, 'u0.b2'],
    [{ r2: baseHidden }, 'u0'],
  ]
  for (const [overrides, by] of cases) {
    const p = validateSite(levels(2, { overrides }), reg)
    assert.deepEqual(
      p.map(x => [x.rule, x.nodeId, x.path]),
      [['required', 'u0', 'parts.n2.title']],
      JSON.stringify(overrides),
    )
    assert.match(p[0].message, /n2\.title/)
    assert.match(p[0].message, new RegExp(`by "${by.replace('.', '\\.')}"`))
  }
  assert.deepEqual(
    validateSite(
      levels(2, { overrides: { b2: { style: { base: { hidden: false } } } } }),
      reg,
    ),
    [],
  )
})

test('N1: a look in use of the outer component that hides the box or the nested instance is refused; unused, it is not', () => {
  for (const part of ['b2', 'n2']) {
    const more = { 2: lookOn(part, hidePhone) }
    assert.deepEqual(req3(levels(2, { set: { look: 'b' } }, more)), [
      ['required', 'u0', 'parts.n2.title'],
    ])
    assert.deepEqual(validateSite(levels(2, {}, more), reg), [])
    assert.deepEqual(
      validateSite(levels(2, { set: { look: 'a' } }, more), reg),
      [],
    )
  }
  const style = { 2: lookOn('b2', baseHidden) }
  assert.deepEqual(req3(levels(2, { set: { look: 'b' } }, style)), [
    ['required', 'u0', 'parts.n2.title'],
  ])
})

test('N2: the outer toggle on the box around the nested use is refused when it is off', () => {
  const more = { 2: { props: [toggleOn('b2', { default: true })] } }
  assert.deepEqual(req3(levels(2, { set: { show: false } }, more)), [
    ['required', 'u0', 'parts.n2.title'],
  ])
  assert.deepEqual(
    validateSite(levels(2, { set: { show: true } }, more), reg),
    [],
  )
  assert.deepEqual(validateSite(levels(2, {}, more), reg), [])
})

test('N1: three and four levels, hiding a middle nested use or a box inside it', () => {
  for (const key of ['n3', 'n3.b2', 'n3.n2']) {
    const p = validateSite(levels(3, { overrides: { [key]: hidePhone } }), reg)
    assert.deepEqual(
      p.map(x => [x.rule, x.nodeId, x.path]),
      [['required', 'u0', 'parts.n3.n2.title']],
    )
    assert.ok(p[0].message.includes(`by "u0.${key}"`), p[0].message)
  }
  for (const key of ['n4', 'n4.n3', 'n4.n3.b2', 'n4.n3.n2']) {
    const p = validateSite(levels(4, { overrides: { [key]: hidePhone } }), reg)
    assert.deepEqual(
      p.map(x => [x.rule, x.nodeId, x.path]),
      [['required', 'u0', 'parts.n4.n3.n2.title']],
    )
    assert.ok(p[0].message.includes(`by "u0.${key}"`), p[0].message)
  }
  assert.deepEqual(validateSite(levels(4), reg), [])
})

test('N1: from a header instance', () => {
  assert.deepEqual(
    req3(levels(2, { overrides: { b2: hidePhone } }, {}, 'header')),
    [['required', 'h0', 'parts.n2.title']],
  )
  assert.deepEqual(validateSite(levels(2, {}, {}, 'header'), reg), [])
})

/** The title of K in a document built by `levels`. */
const titleOf = (d: { components: unknown[] }) =>
  (d.components[0] as { root: Node }).root.children![0].children![0]
const okSite = (d: object) => assert.deepEqual(validateSite(d, reg), [])

test('accepted: a look that hides a required part while no use selects it, and one whose default does not select it', () => {
  okSite(levels(1, {}, { 1: lookOn('title', hidePhone) }))
  okSite(levels(1, { set: { look: 'a' } }, { 1: lookOn('title', hidePhone) }))
  const byDefault = (v: string) => ({
    1: { ...lookOn('title', hidePhone), props: [{ ...choice, default: v }] },
  })
  okSite(levels(1, {}, byDefault('a')))
  // its twin: the default selects the look, so every use shows the title hidden
  assert.deepEqual(req3(levels(1, {}, byDefault('b'))), [
    ['required', 'u0', 'parts.title.hide.phone'],
  ])
})

test('accepted: a look whose when has two conditions of which the use meets one; refused when it meets both (m3)', () => {
  const size = {
    key: 'size',
    label: 'size',
    type: 'choice',
    options: ['s', 'l'],
  }
  const more = {
    1: {
      props: [choice, size],
      variants: [
        { when: { look: 'b', size: 'l' }, patch: { title: hidePhone } },
      ],
    },
  }
  okSite(levels(1, { set: { look: 'b' } }, more))
  okSite(levels(1, { set: { size: 'l' } }, more))
  assert.deepEqual(req3(levels(1, { set: { look: 'b', size: 'l' } }, more)), [
    ['required', 'u0', 'parts.title.hide.phone'],
  ])
})

test('accepted: a part hidden in the master and shown by the use’s toggle, by set and by default', () => {
  const hiddenTitle = (d: ReturnType<typeof levels>) => {
    titleOf(d).style = { base: { hidden: true } }
    return d
  }
  okSite(
    hiddenTitle(
      levels(1, { set: { show: true } }, { 1: { props: [toggleOn('title')] } }),
    ),
  )
  okSite(
    hiddenTitle(
      levels(1, {}, { 1: { props: [toggleOn('title', { default: true })] } }),
    ),
  )
  assert.deepEqual(
    req3(hiddenTitle(levels(1, {}, { 1: { props: [toggleOn('title')] } }))),
    [['required', 'u0', 'parts.title.style.base.hidden']],
  )
})

test('accepted: a part hidden on phone in the master and shown on phone by an override', () => {
  const d = levels(1, {
    overrides: { title: { style: { phone: { hidden: false } } } },
  })
  titleOf(d).style = { phone: { hidden: true } }
  okSite(d)
})

test('two uses, one shows the part and one does not: only the second is reported', () => {
  const d = levels(1, {
    overrides: { title: { style: { phone: { hidden: false } } } },
  })
  titleOf(d).style = { phone: { hidden: true } }
  d.pages[0].root.children!.push(ninst('u1', lv(1)))
  assert.deepEqual(req3(d), [
    ['required', 'u1', 'parts.title.style.phone.hidden'],
  ])
})

test('accepted: a component nobody uses, whose required part is hidden and empty', () => {
  const d = levels(2)
  d.pages[0].root.children = []
  titleOf(d).hide = { phone: true }
  titleOf(d).props = { level: 'p', runs: [{ text: '' }] }
  okSite(d)
})

test('accepted: 300 instances of one card with no overrides', () => {
  const d = levels(1)
  d.pages[0].root.children = Array.from({ length: 300 }, (_, i) =>
    ninst(`u${i}`, lv(1)),
  )
  okSite(d)
})

const unrolledPage = (d: ReturnType<typeof levels>) =>
  unrollInstances(d.pages[0].root, d.components as never, {
    fonts: d.fonts,
    styles: defaultSiteStyles(d.look),
  })
const findIn = (root: Node, id: string) => {
  let hit: Node | undefined
  const go = (x: Node) => {
    if (x.id === id) hit ??= x
    for (const c of x.children ?? []) go(c)
  }
  go(root)
  return hit
}

test('m1: a hide an override puts on the component root is dropped by the unroll, and the guard agrees', () => {
  const d = levels(1, { required: true, overrides: { kroot: hidePhone } })
  assert.equal(findIn(unrolledPage(d), 'u0')?.hide, undefined)
  okSite(d)
  // the instance's own hide is kept, and refused
  const own = levels(1, { required: true, hide: { phone: true } })
  assert.deepEqual(findIn(unrolledPage(own), 'u0')?.hide, { phone: true })
  // the instance (on itself) and its required title (through the instance)
  assert.deepEqual(req3(own), [
    ['required', 'u0', 'hide.phone'],
    ['required', 'u0', 'parts.title'],
  ])
})

test('m2: one problem per required node under a hidden ancestor, each at its own place, none twice', () => {
  const d = levels(2, { overrides: { b2: hidePhone } })
  const k = d.components[0] as { root: Node }
  k.root.children![0].children!.push(
    n({
      id: 'f',
      kind: 'form',
      name: 'f',
      slot: {},
      props: { formId: 'f' },
      children: [
        n({
          id: 'a',
          kind: 'field',
          name: 'a',
          slot: {},
          props: { name: 'email', label: 'A' },
        }),
      ],
    }),
  )
  d.components[1] = {
    ...d.components[1],
    root: { ...(d.components[1] as { root: Node }).root },
  } as never
  ;(
    (d.components[1] as { root: Node }).root.children![0].children![0] as Node
  ).required = true
  const p = req3(d)
  assert.deepEqual(p, [
    ['required', 'u0', 'parts.n2'],
    ['required', 'u0', 'parts.n2.title'],
    ['required', 'u0', 'parts.n2.f'],
    ['required', 'u0', 'parts.n2.a'],
  ])
  assert.equal(new Set(p.map(x => JSON.stringify(x))).size, p.length)
})

test('m4: slot content is judged in the host the unroll puts it in; a second slot host cannot be written', () => {
  const build = (two: boolean) => {
    const d = siteWith([
      ninst('u0', 'aa', { children: [kt('s', 'Hi', { required: true })] }),
    ])
    d.components = [
      {
        id: 'aa',
        name: 'A',
        root: kn('aroot', 'box', [kn('h1', 'box', []), kn('h2', 'box', [])]),
        props: [
          { key: 'one', label: 'one', type: 'slot', part: 'h1' },
          ...(two
            ? [{ key: 'two', label: 'two', type: 'slot', part: 'h2' }]
            : []),
        ],
        variants: [],
      },
    ] as never
    return d
  }
  // the case m4 describes is not a valid document, so the required checks never meet it
  assert.deepEqual(
    validateSite(build(true), reg).map(x => [x.code, x.nodeId, x.path]),
    [['INVALID_NODE', 'aroot', 'props']],
  )
  const d = build(false)
  const host = (d.components[0] as { root: Node }).root.children![0]
  assert.equal(
    findIn(unrolledPage(d as never), 'u0.h1')?.children?.[0]?.id,
    's',
  )
  okSite(d)
  // the other box is hidden: it does not hold the content
  ;(d.components[0] as { root: Node }).root.children![1].hide = { phone: true }
  okSite(d)
  host.hide = { phone: true }
  const p = validateSite(d, reg)
  assert.deepEqual(
    p.map(x => [x.rule, x.nodeId, x.path]),
    [['required', 's', undefined]],
  )
  assert.match(p[0].message, /u0\.h1/)
})

test('m5: an ancestor of a nested use hidden in the middle master and shown by that use’s toggle', () => {
  const build = (use: object) => {
    const d = levels(2, use, { 2: { props: [toggleOn('b2')] } })
    const b2 = (d.components[1] as { root: Node }).root.children![0]
    b2.style = { base: { hidden: true } }
    return d
  }
  okSite(build({ set: { show: true } }))
  const p = validateSite(build({}), reg)
  assert.deepEqual(
    p.map(x => [x.rule, x.nodeId, x.path]),
    [['required', 'u0', 'parts.n2.title']],
  )
  assert.match(p[0].message, /components\.lv2/)
})

/** Ten lines, independent of the code under test: is a required node, or an ancestor of it, hidden in the unrolled tree? */
const isHid = (x: Node): boolean =>
  Object.values(x.hide ?? {}).includes(true) ||
  Object.entries(x.style ?? {}).some(([k, v]) =>
    k === 'when'
      ? (v as { decl: { hidden?: boolean } }[]).some(
          w => w.decl.hidden === true,
        )
      : (v as { hidden?: boolean }).hidden === true,
  )
const oracle = (x: Node, above = false): boolean =>
  (x.required === true && (above || isHid(x))) ||
  (x.children ?? []).some(c => oracle(c, above || isHid(x)))

test('property: rule required is reported exactly when the unroll shows a required node hidden', t => {
  const ways = [
    'hide',
    'base',
    'state',
    'when',
    'toggleSet',
    'toggleDefault',
    'look',
  ] as const
  const places = ['part', 'ancestor', 'nested', 'outerRoot'] as const
  const style = (layer: string, on: boolean) => ({
    style: { [layer]: { hidden: on } },
  })
  let built = 0
  let hiddenSeen = 0
  for (let depth = 1; depth <= 4; depth++)
    for (const way of ways)
      for (const place of places)
        for (const on of [true, false]) {
          if (place === 'nested' && depth === 1) continue
          // an instance takes no style, and a toggle writes a style
          if (place === 'nested' && !['hide', 'look'].includes(way)) continue
          // the master id of the target, and the key an outer override names it by
          const via = Array.from(
            { length: depth - 1 },
            (_, k) => `n${depth - k}`,
          )
          const target =
            place === 'part'
              ? 'title'
              : place === 'ancestor'
                ? 'kbox'
                : place === 'nested'
                  ? `n${depth}`
                  : depth === 1
                    ? 'kroot'
                    : `r${depth}`
          const deep = place === 'part' || place === 'ancestor'
          const key = deep ? [...via, target].join('.') : target
          // the level that holds the target, and whether its instance is the page's `u0`
          const holder = deep ? 1 : depth
          const o =
            way === 'hide'
              ? on
                ? hidePhone
                : {}
              : way === 'base'
                ? style('base', on)
                : way === 'state'
                  ? style('dark', on)
                  : {
                      style: {
                        when: [{ state: 'tab', is: 'b', decl: { hidden: on } }],
                      },
                    }
          const use: Record<string, unknown> = {}
          const more: Record<
            number,
            { props?: object[]; variants?: object[]; inner?: object }
          > = {}
          const at = (v: object) => {
            if (holder === depth) Object.assign(use, v)
            else more[holder] = { ...more[holder], inner: v }
          }
          if (['hide', 'base', 'state', 'when'].includes(way)) {
            if (way !== 'hide' || on) use.overrides = { [key]: o }
          } else if (way === 'toggleSet') {
            more[holder] = {
              ...more[holder],
              props: [toggleOn(target, { default: true })],
            }
            at({ set: { show: !on } })
          } else if (way === 'toggleDefault') {
            more[holder] = {
              ...more[holder],
              props: [toggleOn(target, { default: !on })],
            }
          } else {
            more[holder] = { ...more[holder], ...lookOn(target, hidePhone) }
            at({ set: { look: on ? 'b' : 'a' } })
          }
          const d = levels(depth, use, more)
          const p = validateSite(d, reg)
          const label = JSON.stringify({ depth, way, place, on })
          assert.ok(
            p.every(x => x.code === 'POLICY_VIOLATION'),
            `${label} is a valid document: ${JSON.stringify(p)}`,
          )
          const expect = oracle(unrolledPage(d))
          assert.equal(
            p.some(x => x.rule === 'required'),
            expect,
            label,
          )
          built++
          if (expect) hiddenSeen++
        }
  t.diagnostic(`${built} documents, ${hiddenSeen} hidden`)
  assert.ok(built >= 30, `${built} documents`)
  assert.ok(hiddenSeen >= 15, `${hiddenSeen} hidden`)
})

test('performance: validateSite on bigPage(2000) and on a page of 300 four-part cards', t => {
  const time = (d: object) => {
    validateSite(d, reg)
    const runs: number[] = []
    for (let i = 0; i < 5; i++) {
      const s = performance.now()
      validateSite(d, reg)
      runs.push(performance.now() - s)
    }
    return runs.sort((a, b) => a - b)[2]
  }
  const big = bigPage(2000)
  assert.deepEqual(validateSite(big, reg), [])
  const cards = siteWith(
    Array.from({ length: 300 }, (_, i) => ninst(`u${i}`, 'card4')),
  )
  cards.components = [
    {
      id: 'card4',
      name: 'Card',
      root: kn('croot', 'box', [
        kt('ctitle', 'Title', { required: true }),
        kt('cbody', 'Body'),
        kn('cline', 'divider'),
      ]),
      props: [],
      variants: [],
    },
  ] as never
  assert.deepEqual(validateSite(cards, reg), [])
  t.diagnostic(`bigPage(2000): ${time(big).toFixed(1)} ms (median of 5)`)
  t.diagnostic(
    `300 four-part cards: ${time(cards).toFixed(1)} ms (median of 5)`,
  )
})

test('the text range is judged on the unrolled tree: a component nobody uses is not judged, and a master size every use replaces is fine', () => {
  const small = (d: ReturnType<typeof levels>) => {
    titleOf(d).style = { base: { size: 8 } }
    return withRange(d as never)
  }
  const unused = small(levels(1))
  unused.pages[0].root.children = []
  okSite(unused)
  okSite(
    small(
      levels(1, { overrides: { title: { style: { base: { size: 20 } } } } }),
    ),
  )
  assert.deepEqual(
    validateSite(small(levels(1)), reg).map(x => [x.rule, x.nodeId, x.path]),
    [['textRange', 'u0', 'parts.title.style.base.size']],
  )
})

test('a tree the unroll cuts at the node limit: one problem when it holds required content, none when it does not, and the built part is not listed', () => {
  // 20 uses of the next level at each of 4 levels: far past MAX_NODES once unrolled
  const d = siteWith([ninst('u0', 'w0')])
  d.components = [0, 1, 2, 3].map(i => ({
    id: `w${i}`,
    name: `w${i}`,
    root: kn(
      'root',
      'box',
      i === 3
        ? [kt('leaf', 'x', { required: true, hide: { phone: true } })]
        : Array.from({ length: 20 }, (_, k) => ninst(`v${k}`, `w${i + 1}`)),
    ),
    props: [],
    variants: [],
  })) as never
  const state = { n: 0, over: false }
  unrollInstances(
    d.pages[0].root,
    d.components as never,
    { fonts: d.fonts, styles: defaultSiteStyles(d.look) },
    state,
  )
  assert.equal(state.over, true)
  // one problem for the page, not one per built copy, hidden or not
  const cut = [['RESOURCE_LIMIT_EXCEEDED', 'required', 'pages.home']]
  const shape = () => validateSite(d, reg).map(x => [x.code, x.rule, x.path])
  assert.deepEqual(shape(), cut)
  const leaf = (d.components[3] as { root: Node }).root.children![0]
  delete leaf.hide
  assert.deepEqual(shape(), cut)
  // with no required content the cut page stays valid
  delete leaf.required
  okSite(d)
})

// ---- fourth round: problem paths, the master pointer, invisible characters ----

const shapes = (d: object) =>
  validateSite(d, reg)
    .filter(x => x.rule === 'required')
    .map(x => [x.nodeId, x.path])

test('minor 1: a path is always on the node named; a hiding on an ancestor gives no path, and the message names the ancestor', () => {
  // slot content hidden by a part of the instance
  const slot = hosted({ overrides: { body: { hide: { phone: true } } } })
  const p = validateSite(slot, reg)
  assert.deepEqual(
    p.map(x => [x.nodeId, x.path]),
    [['rt', undefined]],
  )
  assert.match(p[0].message, /"i1\.body"/)
  // a page node hidden by a page ancestor
  const wrapped = put(
    n({
      id: 'wrap',
      kind: 'box',
      name: 'wrap',
      slot: fs(),
      hide: { phone: true },
      children: [text('t', { slot: {}, required: true })],
    }),
  )
  const q = validateSite(wrapped, reg)
  assert.deepEqual(
    q.map(x => [x.nodeId, x.path]),
    [['t', undefined]],
  )
  assert.match(q[0].message, /"wrap"/)
  // a part hidden by an ancestor part: the part's own path, no field
  assert.deepEqual(shapes(levels(2, { overrides: { b2: hidePhone } })), [
    ['u0', 'parts.n2.title'],
  ])
  // a part hidden by the outer root
  assert.deepEqual(shapes(levels(2, { overrides: { r2: baseHidden } })), [
    ['u0', 'parts.n2.title'],
  ])
  // a part hidden on itself keeps the field
  assert.deepEqual(
    shapes(levels(2, { overrides: { 'n2.title': hidePhone } })),
    [['u0', 'parts.n2.title.hide.phone']],
  )
})

test('minor 2: when paths keep .decl, as the document writes them', () => {
  const d = put(
    n({
      ...text0('t'),
      required: true,
      style: {
        when: [{ state: 'tab', is: 'b', decl: { hidden: true, size: 8 } }],
      },
    }),
  )
  d.pages[0].root.state = [{ name: 'tab', values: ['a', 'b'], initial: 'a' }]
  assert.deepEqual(
    validateSite(withRange(d), reg).map(x => [x.rule, x.nodeId, x.path]),
    [
      ['required', 't', 'style.when.0.decl.hidden'],
      ['textRange', 't', 'style.when.0.decl.size'],
    ],
  )
})

test('minor 3: a part hidden in the master is reported once per use, and each message points at the master', () => {
  const d = levels(1)
  titleOf(d).hide = { phone: true }
  d.pages[0].root.children!.push(ninst('u1', lv(1)))
  const p = validateSite(d, reg)
  assert.deepEqual(
    p.map(x => [x.nodeId, x.path]),
    [
      ['u0', 'parts.title.hide.phone'],
      ['u1', 'parts.title.hide.phone'],
    ],
  )
  for (const x of p) {
    assert.match(x.message, /components\.lv1/)
    assert.match(x.message, /"title"/)
  }
  // hidden by the use, not the master: no pointer
  const o = validateSite(levels(1, { overrides: { title: hidePhone } }), reg)
  assert.equal(o.length, 1)
  assert.doesNotMatch(o[0].message, /components\./)
})

test('minor 4: an invisible character alone is not content; text in any script is', () => {
  const one = (s: string) =>
    validateSite(
      put(
        n({
          ...text0('t'),
          required: true,
          props: { level: 'p', runs: [{ text: s }] },
        }),
      ),
      reg,
    ).map(x => [x.rule, x.nodeId, x.path])
  for (const s of ['​', '⁠', '­', '​⁠ ­', '﻿'])
    assert.deepEqual(
      one(s),
      [['required', 't', 'props.runs']],
      JSON.stringify(s),
    )
  for (const s of ['Hello', 'مرحبا', '你好', 'Привет', 'नमस्ते', '​x'])
    assert.deepEqual(one(s), [], s)
})

test('fifth round, minor 2: Hangul fillers, the Braille blank, combining marks alone and private-use characters are not content', () => {
  const one = (s: string) =>
    validateSite(
      put(
        n({
          ...text0('t'),
          required: true,
          props: { level: 'p', runs: [{ text: s }] },
        }),
      ),
      reg,
    ).map(x => [x.rule, x.nodeId, x.path])
  for (const s of ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀', '́', '͏', '️', '', 'ㅤ⠀ ́'])
    assert.deepEqual(
      one(s),
      [['required', 't', 'props.runs']],
      JSON.stringify(s),
    )
  for (const s of ['Hello', 'مرحبا', 'سلام', '你好', '🙂', '7', 'ㅤa'])
    assert.deepEqual(one(s), [], s)
})
