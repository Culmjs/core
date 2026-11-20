import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate, type Node } from '../../src/document/index.ts'
import { unrollInstances } from '../../src/data/bind.ts'
import { validateSite } from '../../src/validate/index.ts'
import { shownPart } from '../../src/validate/required.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { dv, fs, n, put, reg, text as t0 } from './helpers.ts'

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
      ['required', 'i1', 'set.title'],
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
    'set.title',
  ])
  assert.deepEqual(one(withInstance({}, { default: '' }, true, hi)), [
    'set.title',
  ])
  assert.deepEqual(validateSite(withInstance({}, { default: 'D' }), reg), [])
  assert.deepEqual(
    validateSite(withInstance({ set: { title: '' }, ...over }), reg),
    [],
  )
  assert.deepEqual(validateSite(withInstance({}, {}, true, hi), reg), [])
  assert.deepEqual(one(withInstance({})), ['set.title'])
})

test('a part with no text property is judged at overrides.<part>.props.runs', () => {
  const d = withInstance({}, {})
  d.components[0].props = []
  assert.deepEqual(refused(d), [
    ['required', 'i1', 'overrides.title.props.runs'],
  ])
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

test('shownPart agrees with unrollInstances on whether the unrolled part has text', () => {
  const cases: [object, object, Node][] = [
    [{}, {}, empty],
    [{ set: { title: '' } }, {}, hi],
    [{}, { default: '' }, hi],
    [{}, { default: 'D' }, empty],
    [{ set: { title: '' }, ...over }, {}, empty],
    [over, {}, empty],
    [{ bind: { title: { from: 'site', field: 'title' } } }, {}, empty],
    [{ set: { title: 'S' } }, {}, empty],
  ]
  for (const [inst, prop, master] of cases) {
    const d = withInstance(inst, prop, true, master)
    const root = unrollInstances(d.pages[0].root, d.components as never, {
      fonts: [],
      styles: defaultSiteStyles(d.look),
    })
    let shown = false
    const go = (w: Node) => {
      if (w.id === 'i1.title')
        shown = (
          (w.props?.runs ?? []) as { text?: string; bind?: object }[]
        ).some(r => r.text || r.bind)
      w.children?.forEach(go)
    }
    go(root)
    assert.equal(
      validateSite(d, reg).length === 0,
      shown,
      JSON.stringify([inst, prop]),
    )
  }
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
    ['required', undefined, 'components.c1.props.0.default'],
  ])
  assert.deepEqual(
    probs(shownDoc([toggle({ default: true })], [], { set: { show: false } })),
    [['required', 'i1', 'set.show']],
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
    [['textRange', 'i1', 'overrides.title.style.base.size']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: {
          title: { props: { runs: [{ text: 'x', style: { size: 8 } }] } },
        },
      }),
    ),
    [['textRange', 'i1', 'overrides.title.props.runs.0.style.size']],
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
    [['textRange', 'i1', 'overrides.title.style.when.0.decl.size']],
  )
  assert.deepEqual(
    at(
      shownDoc([], [], {
        overrides: {
          title: { style: { base: { fluidSize: { min: 8, max: 20 } } } },
        },
      }),
    ),
    [['textRange', 'i1', 'overrides.title.style.base.fluidSize.min']],
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
    [
      [
        'textRange',
        undefined,
        'components.c1.variants.0.patch.title.style.phone.size',
      ],
    ],
  )
  assert.deepEqual(at(shownDoc([size()], [], { set: { sz: 8 } })), [
    ['textRange', 'i1', 'set.sz'],
  ])
  assert.deepEqual(at(shownDoc([size({ default: 8 })], [])), [
    ['textRange', undefined, 'components.c1.props.0.default'],
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
  assert.deepEqual(probs(c), [['required', 'i1', 'set.title']])
})

test('shownPart agrees with unrollInstances on hide, style and runs, for every control field that can affect them', () => {
  const textP = (extra: object = {}) => ({
    key: 'title',
    label: 'T',
    type: 'text',
    part: 'title',
    field: 'text',
    ...extra,
  })
  const hit = (look: string, patch: object) => [
    { when: { look }, patch: { title: patch } },
  ]
  const cases: [string, object[], object[], object][] = [
    ['text default', [textP({ default: 'D' })], [], {}],
    ['text set', [textP()], [], { set: { title: 'S' } }],
    [
      'text set empty over default',
      [textP({ default: 'D' })],
      [],
      { set: { title: '' } },
    ],
    [
      'text variant',
      [look],
      hit('b', { props: { runs: [{ text: 'V' }] } }),
      { set: { look: 'b' } },
    ],
    [
      'text variant not matching',
      [look],
      hit('b', { props: { runs: [{ text: 'V' }] } }),
      { set: { look: 'a' } },
    ],
    [
      'text variant, set choice not an option',
      [look],
      hit('a', { props: { runs: [{ text: 'V' }] } }),
      { set: { look: 'zzz' } },
    ],
    [
      'text override',
      [],
      [],
      { overrides: { title: { props: { runs: [{ text: 'O' }] } } } },
    ],
    [
      'text set then override',
      [textP()],
      [],
      {
        set: { title: 'S' },
        overrides: { title: { props: { runs: [{ text: 'O' }] } } },
      },
    ],
    [
      'text variant then set',
      [look, textP()],
      hit('b', { props: { runs: [{ text: 'V' }] } }),
      { set: { look: 'b', title: 'S' } },
    ],
    [
      'text bind',
      [textP()],
      [],
      { bind: { title: { from: 'site', field: 'title' } } },
    ],
    ['run default', [textP({ run: 1, default: 'R' })], [], {}],
    ['run set', [textP({ run: 1 })], [], { set: { title: 'R' } }],
    ['run set empty', [textP({ run: 0 })], [], { set: { title: '' } }],
    [
      'run bind',
      [textP({ run: 1 })],
      [],
      { bind: { title: { from: 'site', field: 'title' } } },
    ],
    ['run out of range', [textP({ run: 5 })], [], { set: { title: 'R' } }],
    ['hidden default off', [toggle({ default: false })], [], {}],
    ['hidden default on', [toggle({ default: true })], [], {}],
    [
      'hidden set off',
      [toggle({ default: true })],
      [],
      { set: { show: false } },
    ],
    [
      'hidden set on over default off',
      [toggle({ default: false })],
      [],
      { set: { show: true } },
    ],
    [
      'hidden bind',
      [toggle({ default: true })],
      [],
      { bind: { show: { from: 'site', field: 'title' } } },
    ],
    [
      'hidden variant hide',
      [look],
      hit('b', { hide: { phone: true } }),
      { set: { look: 'b' } },
    ],
    [
      'hidden variant style',
      [look],
      hit('b', { style: { base: { hidden: true } } }),
      { set: { look: 'b' } },
    ],
    [
      'hidden override hide',
      [],
      [],
      { overrides: { title: { hide: { desktop: true } } } },
    ],
    [
      'hidden override when',
      [],
      [],
      {
        overrides: {
          title: {
            style: {
              when: [{ state: 'tab', is: 'papers', decl: { hidden: true } }],
            },
          },
        },
      },
    ],
    [
      'hidden property then override un-hides',
      [toggle({ default: false })],
      [],
      { overrides: { title: { style: { base: { hidden: false } } } } },
    ],
    ['size default', [size({ default: 8 })], [], {}],
    ['size set', [size()], [], { set: { sz: 8 } }],
    ['size set over default', [size({ default: 8 })], [], { set: { sz: 40 } }],
    [
      'size variant',
      [look],
      hit('b', { style: { phone: { size: 9 } } }),
      { set: { look: 'b' } },
    ],
    [
      'size override base',
      [],
      [],
      { overrides: { title: { style: { base: { size: 8 } } } } },
    ],
    [
      'size override layers merge',
      [size({ default: 8 })],
      [],
      {
        overrides: {
          title: { style: { base: { color: 'brand' }, phone: { size: 9 } } },
        },
      },
    ],
    [
      'size override run style',
      [],
      [],
      {
        overrides: {
          title: { props: { runs: [{ text: 'x', style: { size: 8 } }] } },
        },
      },
    ],
    [
      'size override when',
      [],
      [],
      {
        overrides: {
          title: {
            style: {
              when: [{ state: 'tab', is: 'papers', decl: { size: 8 } }],
            },
          },
        },
      },
    ],
    [
      'size variant when then override when',
      [look],
      hit('b', {
        style: { when: [{ state: 'tab', is: 'papers', decl: { size: 9 } }] },
      }),
      {
        set: { look: 'b' },
        overrides: {
          title: {
            style: { when: [{ state: 'tab', is: 'other', decl: { size: 8 } }] },
          },
        },
      },
    ],
    ['nothing', [], [], {}],
  ]
  const of = (v: unknown) => JSON.parse(JSON.stringify(v ?? null))
  for (const [name, props, variants, inst] of cases) {
    const d = shownDoc(props, variants, inst, { style: { base: { size: 20 } } })
    const root = unrollInstances(d.pages[0].root, d.components as never, {
      fonts: [],
      styles: defaultSiteStyles(d.look),
    })
    let real: Node | undefined
    const go = (w: Node) => {
      if (w.id === 'i1.title') real = w
      w.children?.forEach(go)
    }
    go(root)
    assert.ok(real, name)
    const comp = d.components[0] as never
    const part = d.components[0].root.children![0]
    const inst1 = d.pages[0].root.children![0]
    const got = shownPart(part, comp, inst1)
    for (const k of ['hide', 'style'] as const)
      assert.deepEqual(of(got[k]), of(real[k]), `${name}: ${k}`)
    assert.deepEqual(of(got.props?.runs), of(real.props?.runs), `${name}: runs`)
  }
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
    [['textRange', 'o', 'overrides.k.title.style.base.size']],
  )
  assert.deepEqual(
    probs(nested({ 'k.title': { props: { runs: [{ text: '' }] } } })),
    [['required', 'o', 'overrides.k.title.props.runs']],
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
        [['required', `u${at}`, 'overrides.k.title.props.runs']],
        `empty, ${total} uses, at ${at}`,
      )
      assert.deepEqual(
        probs(ranged(many(total, { [at]: small }) as never)),
        [['textRange', `u${at}`, 'overrides.k.title.style.base.size']],
        `size, ${total} uses, at ${at}`,
      )
    }
})

test('H1: three levels, the override given by the outermost instance, past the ninth use', () => {
  const key = (o: object) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [`o.${k}`, v]))
  assert.deepEqual(probs(many(12, { 11: key(empties) }, 3)), [
    ['required', 'u11', 'overrides.o.k.title.props.runs'],
  ])
  assert.deepEqual(probs(ranged(many(12, { 11: key(small) }, 3) as never)), [
    ['textRange', 'u11', 'overrides.o.k.title.style.base.size'],
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

test('H1: when too many ways reach a part to judge them all, the refusal is RESOURCE_LIMIT_EXCEEDED, never silence', () => {
  const colour = { 'k.title': { style: { base: { color: 'brand' } } } }
  const over = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [i, colour]),
  )
  const d = many(300, over)
  d.pages[0].root.kind = 'column'
  for (const c of d.pages[0].root.children!) c.slot = {}
  const p = validateSite(d, reg)
  assert.ok(
    p.some(x => x.code === 'RESOURCE_LIMIT_EXCEEDED'),
    JSON.stringify(p.slice(0, 3)),
  )
  const hit = p.find(x => x.code === 'RESOURCE_LIMIT_EXCEEDED')!
  assert.match(hit.message, /c1/)
  assert.match(hit.message, /title/)
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
    [['required', 'i1', 'overrides.croot.style.base.hidden']],
  )
  assert.deepEqual(
    probs(
      hosted({ overrides: { croot: { hide: { phone: true } } } }, [], false),
    ),
    [['required', 'i1', 'overrides.croot.hide.phone']],
  )
  assert.deepEqual(
    probs(
      hosted(
        { set: { show: false } },
        [showing('croot', { default: true })],
        false,
      ),
    ),
    [['required', 'i1', 'set.show']],
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
  // i1 is required too, so a hidden root is reported for the instance and for its content
  const refused = (d: object, path: string, times = 1) =>
    assert.deepEqual(
      probs(d),
      Array.from({ length: times }, () => ['required', 'i1', path]),
      path,
    )
  refused(
    hosted({ overrides: { body: { hide: { phone: true } } } }),
    'overrides.body.hide.phone',
  )
  refused(
    hosted({ overrides: { body: { style: { base: { hidden: true } } } } }),
    'overrides.body.style.base.hidden',
  )
  refused(
    hosted({ overrides: { croot: { hide: { desktop: true } } } }),
    'overrides.croot.hide.desktop',
    2,
  )
  refused(
    hosted({ set: { show: false } }, [showing('body', { default: true })]),
    'set.show',
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
