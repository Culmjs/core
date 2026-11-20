import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { requiredRefs } from '../../src/document/required.ts'
import { plan } from '../../src/ops/plan.ts'
import type { ChangeRequest } from '../../src/ops/types.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import type { SettingFn } from '../../src/registry/index.ts'
import { STAMP, kitRegistry, node, siteWith, text, twoPages } from '../kit.ts'

// Goal 5 through `plan`: what a person cannot do to required content, however it is tried.

const reg = kitRegistry()
const T = { page: 'home' }
const req = (ops: unknown[]): ChangeRequest =>
  ({ site: 's', baseRevision: 0, key: 'k', ops }) as ChangeRequest

const inst = (id: string, more: Partial<Node> = {}): Node => ({
  id,
  kind: 'instance',
  name: id,
  slot: {},
  component: 'card',
  ...more,
})
const prop = (key: string, type: string, field: string, extra = {}) => ({
  key,
  label: key,
  type,
  part: 'title',
  field,
  ...extra,
})
const card = () => ({
  id: 'card',
  name: 'Card',
  root: node('croot', 'box', [text('title', 'Hi', { required: true })]),
  props: [
    prop('words', 'text', 'text'),
    prop('show', 'toggle', 'hidden', { default: true }),
    prop('sz', 'number', 'fontSize', { default: 20 }),
    { key: 'look', label: 'Look', type: 'choice', options: ['a', 'b'] },
  ],
  variants: [] as unknown[],
})
const form = (): Node => ({
  id: 'f',
  kind: 'form',
  name: 'f',
  slot: {},
  props: { formId: 'f' },
  children: [
    {
      id: 'a',
      kind: 'field',
      name: 'a',
      slot: {},
      props: { name: 'email', label: 'Email' },
    },
  ],
})

/** (a) a required text on a page, (b) a required text part of a component used once, (c) a form with a field. */
const start = (): SiteDocument => {
  const d = twoPages(
    [
      node('wrap', 'box', [text('rt', 'Welcome', { required: true })]),
      inst('i1'),
      form(),
    ],
    [text('at', 'About us', { required: true })],
  )
  d.pages[0].root.state = [
    { name: 'tab', values: ['talks', 'papers'], initial: 'talks' },
  ]
  d.components = [card() as never]
  d.styles = { ...defaultSiteStyles(d.look), textRange: { min: 11, max: 96 } }
  return d
}

const when = { when: { state: 'tab', is: 'papers' } }
const hide = (id: string, layout: string) => ({
  op: 'setHidden',
  tree: T,
  id,
  layout,
  hidden: true,
})
const style = (id: string, layer: unknown, decl: object) => ({
  op: 'setStyle',
  tree: T,
  id,
  layer,
  decl,
})
const over = (overrides: object) => ({
  op: 'setInstance',
  tree: T,
  id: 'i1',
  overrides,
})
const set = (values: object) => ({
  op: 'setInstance',
  tree: T,
  id: 'i1',
  set: values,
})

const refusals: [string, unknown[], 'required' | 'textRange'][] = [
  // (a) a required text on a page
  ['remove it', [{ op: 'remove', tree: T, id: 'rt' }], 'required'],
  ['remove its parent', [{ op: 'remove', tree: T, id: 'wrap' }], 'required'],
  ['remove the page', [{ op: 'removePage', page: 'about' }], 'required'],
  ['hide it on desktop', [hide('rt', 'desktop')], 'required'],
  ['hide it on tablet', [hide('rt', 'tablet')], 'required'],
  ['hide it on phone', [hide('rt', 'phone')], 'required'],
  ['hidden in base', [style('rt', 'base', { hidden: true })], 'required'],
  [
    'hidden in a state layer',
    [style('rt', 'hover', { hidden: true })],
    'required',
  ],
  ['hidden in a when layer', [style('rt', when, { hidden: true })], 'required'],
  ['hide its parent on phone', [hide('wrap', 'phone')], 'required'],
  [
    'hidden in its parent base',
    [style('wrap', 'base', { hidden: true })],
    'required',
  ],
  [
    'hidden in its parent state layer',
    [style('wrap', 'dark', { hidden: true })],
    'required',
  ],
  [
    'hidden in its parent when layer',
    [style('wrap', when, { hidden: true })],
    'required',
  ],
  [
    'setText empty',
    [{ op: 'setText', tree: T, id: 'rt', text: '' }],
    'required',
  ],
  [
    'setText spaces',
    [{ op: 'setText', tree: T, id: 'rt', text: '   ' }],
    'required',
  ],
  [
    'setProps with no runs',
    [{ op: 'setProps', tree: T, id: 'rt', props: { runs: [] } }],
    'required',
  ],
  [
    'size 8 on the phone layer',
    [style('rt', 'phone', { size: 8 })],
    'textRange',
  ],
  // (c) a form with a field
  ['remove the form', [{ op: 'remove', tree: T, id: 'f' }], 'required'],
  ['remove the field', [{ op: 'remove', tree: T, id: 'a' }], 'required'],
  ['hide the form on phone', [hide('f', 'phone')], 'required'],
  ['hide the field on tablet', [hide('a', 'tablet')], 'required'],
  [
    'hidden in the form base',
    [style('f', 'base', { hidden: true })],
    'required',
  ],
  [
    'hidden in the field when layer',
    [style('a', when, { hidden: true })],
    'required',
  ],
  // (b) a required text part of a component used once
  [
    'an override that hides the part',
    [over({ title: { hide: { phone: true } } })],
    'required',
  ],
  [
    'an override whose style hides the part',
    [over({ title: { style: { base: { hidden: true } } } })],
    'required',
  ],
  [
    'an override that sets size 8',
    [over({ title: { style: { phone: { size: 8 } } } })],
    'textRange',
  ],
  ['set of the hidden property', [set({ show: false })], 'required'],
  ['set of the fontSize property out of range', [set({ sz: 8 })], 'textRange'],
  ['set of the text property to ""', [set({ words: '' })], 'required'],
  ['set of the text property to spaces', [set({ words: '  ' })], 'required'],
  [
    'remove the only instance',
    [{ op: 'remove', tree: T, id: 'i1' }],
    'required',
  ],
  [
    'detach then remove',
    [
      { op: 'detach', tree: T, id: 'i1' },
      { op: 'remove', tree: T, id: 'i1' },
    ],
    'required',
  ],
  [
    'makeComponent of a subtree holding (a), then remove the instance',
    [
      {
        op: 'makeComponent',
        tree: T,
        id: 'wrap',
        component: 'wc',
        name: 'Wrap',
      },
      { op: 'remove', tree: T, id: 'wrap' },
    ],
    'required',
  ],
]

test('the starting document is valid', () => {
  assert.deepEqual(validateSite(start(), reg), [])
  assert.deepEqual(
    requiredRefs(start())
      .map(r => r.id)
      .sort(),
    ['a', 'at', 'f', 'rt', 'title'],
  )
})

for (const [name, ops, rule] of refusals)
  test(`refused through plan (${rule}): ${name}`, () => {
    const r = plan(start(), reg, req(ops))
    assert.ok(!r.ok, 'expected a refusal')
    assert.ok(
      r.problems.some(p => p.rule === rule),
      JSON.stringify(r.problems),
    )
  })

test('refused: a variant patch that hides the part (no operation edits variants, so the document is built directly)', () => {
  const d = start()
  d.components[0].variants = [
    { when: { look: 'b' }, patch: { title: { hide: { phone: true } } } },
  ]
  d.pages[0].root.children![1] = inst('i1', { set: { look: 'b' } })
  const p = validateSite(d, reg)
  assert.ok(
    p.some(x => x.rule === 'required'),
    JSON.stringify(p),
  )
})

test('refused: a variant patch that sets size 8', () => {
  const d = start()
  d.components[0].variants = [
    {
      when: { look: 'b' },
      patch: { title: { style: { phone: { size: 8 } } } },
    },
  ]
  d.pages[0].root.children![1] = inst('i1', { set: { look: 'b' } })
  assert.ok(validateSite(d, reg).some(x => x.rule === 'textRange'))
})

test("detach keeps the instance's own required mark: [detach, remove] is refused and detach alone leaves the root required", () => {
  const d = start()
  d.components[0].root.children![0] = text('title', 'Hi')
  d.pages[0].root.children![1] = inst('i1', { required: true })
  assert.deepEqual(validateSite(d, reg), [])
  assert.ok(requiredRefs(d).some(r => r.id === 'i1'))
  const both = plan(
    d,
    reg,
    req([
      { op: 'detach', tree: T, id: 'i1' },
      { op: 'remove', tree: T, id: 'i1' },
    ]),
  )
  assert.ok(!both.ok)
  assert.equal(both.problems[0].code, 'POLICY_VIOLATION')
  assert.equal(both.problems[0].rule, 'required')
  const one = plan(d, reg, req([{ op: 'detach', tree: T, id: 'i1' }]))
  assert.ok(one.ok)
  assert.equal(one.doc.pages[0].root.children![1].required, true)
  assert.ok(requiredRefs(one.doc).some(r => r.id === 'i1'))
})

test('accepted: lifting the mark and removing in one batch (2a allows it; the default allow of the next checkpoint will refuse it)', () => {
  const r = plan(
    start(),
    reg,
    req([
      { op: 'setRequired', tree: T, id: 'rt', required: null },
      { op: 'remove', tree: T, id: 'wrap' },
    ]),
  )
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
})

test('accepted: a show condition on data, and turning the page off', () => {
  const cond = plan(
    start(),
    reg,
    req([
      {
        op: 'bindData',
        tree: T,
        id: 'rt',
        showIf: { from: 'site', field: 'title' },
      },
    ]),
  )
  assert.ok(cond.ok, JSON.stringify(!cond.ok && cond.problems))
  const off = plan(
    start(),
    reg,
    req([{ op: 'setPage', page: 'about', on: false }]),
  )
  assert.ok(off.ok, JSON.stringify(!off.ok && off.problems))
})

// ---- second fix round: nested components, instances and slots, looks in use ----

/** `count` uses of an outer component `outer` that holds a nested `card` (its title is required); the root of both is a column. */
const nestedSite = (count: number, levels = 2): SiteDocument => {
  const d = siteWith([])
  const innerUse = inst('k')
  d.components = [
    card() as never,
    {
      id: 'outer',
      name: 'Outer',
      root: node('oroot', 'column', [innerUse]),
      props: [],
      variants: [],
    },
  ]
  let top = 'outer'
  if (levels === 3) {
    d.components.push({
      id: 'outmost',
      name: 'Outmost',
      root: node('mroot', 'column', [inst('o', { component: 'outer' })]),
      props: [],
      variants: [],
    })
    top = 'outmost'
  }
  d.pages[0].root.children = Array.from({ length: count }, (_, i) =>
    inst(`u${i}`, { component: top }),
  )
  return d
}
const overAt = (id: string, overrides: object) => ({
  op: 'setInstance',
  tree: T,
  id,
  overrides,
})
const must = (doc: SiteDocument, ops: unknown[], rule: string) => {
  const r = plan(doc, reg, req(ops))
  assert.ok(!r.ok, 'expected a refusal')
  assert.ok(
    r.problems.some(p => p.rule === rule),
    JSON.stringify(r.problems),
  )
}
const ranged = (d: SiteDocument): SiteDocument => ({
  ...d,
  styles: { ...defaultSiteStyles(d.look), textRange: { min: 11, max: 96 } },
})

for (const count of [9, 20])
  for (const [name, overrides, rule] of [
    [
      'empty its text',
      { 'k.title': { props: { runs: [{ text: '' }] } } },
      'required',
    ],
    ['size 8', { 'k.title': { style: { base: { size: 8 } } } }, 'textRange'],
    ['hide', { 'k.title': { hide: { phone: true } } }, 'required'],
    [
      'hidden in a style layer',
      { 'k.title': { style: { phone: { hidden: true } } } },
      'required',
    ],
    [
      'hide the nested use itself',
      { k: { hide: { desktop: true } } },
      'required',
    ],
  ] as const)
    test(`refused through plan (${rule}): an override of the nested part on the last of ${count} uses: ${name}`, () => {
      assert.deepEqual(validateSite(ranged(nestedSite(count)), reg), [])
      must(
        ranged(nestedSite(count)),
        [overAt(`u${count - 1}`, overrides)],
        rule,
      )
    })

test('refused through plan: the same override given by the outermost of three levels, past the ninth use', () => {
  const d = ranged(nestedSite(12, 3))
  assert.deepEqual(validateSite(d, reg), [])
  must(d, [overAt('u11', { 'o.k.title': { props: { runs: [] } } })], 'required')
  must(
    d,
    [overAt('u11', { 'o.k.title': { style: { base: { size: 8 } } } })],
    'textRange',
  )
})

test('accepted: 200 uses of a nested component with no overrides, and a harmless override on one of them', () => {
  const d = ranged(nestedSite(200))
  assert.deepEqual(validateSite(d, reg), [])
  const r = plan(
    d,
    reg,
    req([overAt('u150', { 'k.title': { style: { base: { size: 20 } } } })]),
  )
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
})

test('refused through plan: a required instance hidden through its component root', () => {
  const d = start()
  d.pages[0].root.children![1] = inst('i1', { required: true })
  assert.deepEqual(validateSite(d, reg), [])
  must(
    d,
    [overAt('i1', { croot: { style: { base: { hidden: true } } } })],
    'required',
  )
  // a hide an override gives the component root is dropped by the unroll, so the instance is shown (m1)
  assert.ok(
    plan(d, reg, req([overAt('i1', { croot: { hide: { phone: true } } })])).ok,
  )
  d.components[0].props.push(
    prop('rootshow', 'toggle', 'hidden', {
      part: 'croot',
      default: true,
    }) as never,
  )
  assert.deepEqual(validateSite(d, reg), [])
  must(d, [set({ rootshow: false })], 'required')
  // the visible twin
  assert.ok(plan(d, reg, req([set({ rootshow: true })])).ok)
})

test('refused through plan: required content in a slot whose host the use hides; accepted when it does not', () => {
  const d = start()
  d.components[0].root.children!.push(node('host', 'box'))
  d.components[0].props.push(
    { key: 'content', label: 'Content', type: 'slot', part: 'host' } as never,
    prop('hostshow', 'toggle', 'hidden', {
      part: 'host',
      default: true,
    }) as never,
  )
  d.pages[0].root.children![1] = inst('i1', {
    children: [text('slotted', 'In the slot', { required: true })],
  })
  assert.deepEqual(validateSite(d, reg), [])
  must(d, [over({ host: { hide: { phone: true } } })], 'required')
  must(d, [set({ hostshow: false })], 'required')
  must(d, [over({ croot: { style: { base: { hidden: true } } } })], 'required')
  assert.ok(plan(d, reg, req([set({ hostshow: true })])).ok)
  assert.ok(
    plan(d, reg, req([over({ host: { style: { base: { color: 'brand' } } } })]))
      .ok,
  )
})

test('a look hides a required part only for a use that selects it, and a part its use shows is visible', () => {
  const d = start()
  d.components[0].variants = [
    { when: { look: 'b' }, patch: { title: { hide: { phone: true } } } },
  ]
  // nobody selects b
  assert.deepEqual(validateSite(d, reg), [])
  assert.ok(plan(d, reg, req([set({ look: 'a' })])).ok)
  // one use selects it, through plan
  must(d, [set({ look: 'b' })], 'required')
  // a master hidden for good is shown by a use whose toggle turns it on
  const m = start()
  m.components[0].root.children![0] = {
    ...m.components[0].root.children![0],
    style: { base: { hidden: true } },
  }
  m.components[0].props = m.components[0].props.filter(p => p.key !== 'show')
  m.components[0].props.push(
    prop('show', 'toggle', 'hidden', { default: false }) as never,
  )
  assert.ok(validateSite(m, reg).some(p => p.rule === 'required'))
  m.pages[0].root.children![1] = inst('i1', { set: { show: true } })
  assert.deepEqual(validateSite(m, reg), [])
})

// ---- third fix round: what the outer component does to the nested one, judged on the unrolled tree ----

/** `nestedSite` with a box `obox` around the nested use and a toggle `oshow` on it; three levels put it in `outmost`. */
const boxed = (levels = 2): SiteDocument => {
  const d = nestedSite(1, levels)
  d.components[1] = {
    ...d.components[1],
    root: node('oroot', 'column', [node('obox', 'box', [inst('k')])]),
    props: [
      prop('oshow', 'toggle', 'hidden', {
        part: 'obox',
        default: true,
      }) as never,
    ],
  }
  return d
}
const at = (p: { rule?: string; nodeId?: string; path?: string }[]) =>
  p.filter(x => x.rule === 'required').map(x => [x.nodeId, x.path])

test('N1 refused through plan: an outer override hides the box around the nested use, or the outer root', () => {
  for (const [overrides, path] of [
    [{ obox: { hide: { phone: true } } }, 'parts.k.title'],
    [{ obox: { style: { base: { hidden: true } } } }, 'parts.k.title'],
    [{ obox: { style: { dark: { hidden: true } } } }, 'parts.k.title'],
    [{ oroot: { style: { base: { hidden: true } } } }, 'parts.k.title'],
  ] as const) {
    assert.deepEqual(validateSite(boxed(), reg), [])
    const r = plan(boxed(), reg, req([overAt('u0', overrides)]))
    assert.ok(!r.ok, JSON.stringify(overrides))
    assert.deepEqual(at(r.problems), [['u0', path]])
  }
  assert.ok(
    plan(
      boxed(),
      reg,
      req([overAt('u0', { obox: { style: { base: { color: 'brand' } } } })]),
    ).ok,
  )
})

test('N1 refused through plan: three levels, the middle nested use or a box inside it', () => {
  for (const [key, path] of [
    ['o', 'parts.o.k.title'],
    ['o.obox', 'parts.o.k.title'],
    ['o.k', 'parts.o.k.title'],
  ]) {
    const r = plan(
      boxed(3),
      reg,
      req([overAt('u0', { [key]: { hide: { phone: true } } })]),
    )
    assert.ok(!r.ok, key)
    assert.deepEqual(at(r.problems), [['u0', path]])
  }
})

test('N2 refused through plan: the outer toggle on the box around the nested use, off', () => {
  const off = { op: 'setInstance', tree: T, id: 'u0', set: { oshow: false } }
  const r = plan(boxed(), reg, req([off]))
  assert.ok(!r.ok)
  assert.deepEqual(at(r.problems), [['u0', 'parts.k.title']])
  assert.ok(plan(boxed(), reg, req([{ ...off, set: { oshow: true } }])).ok)
})

// ---- fourth round, S1: no operation writes the sample marks ----

const firstProblem = (r: ReturnType<typeof plan>) => {
  assert.ok(!r.ok, 'expected a refusal')
  return r.problems[0]
}

test('S1 refused through plan: setProps writing sample or chrome, with any value', () => {
  for (const [key, value] of [
    ['sample', true],
    ['sample', false],
    ['chrome', true],
  ] as const) {
    const p = firstProblem(
      plan(
        start(),
        reg,
        req([{ op: 'setProps', tree: T, id: 'rt', props: { [key]: value } }]),
      ),
    )
    assert.deepEqual(
      [p.code, p.nodeId, p.path],
      ['INVALID_OPERATION', 'rt', `props.${key}`],
    )
    assert.match(p.message, /cannot be set/)
  }
})

test('S1 refused through plan: setInstance whose override writes sample or chrome on a part', () => {
  for (const key of ['sample', 'chrome']) {
    const p = firstProblem(
      plan(start(), reg, req([over({ title: { props: { [key]: true } } })])),
    )
    assert.deepEqual(
      [p.code, p.nodeId, p.path],
      ['INVALID_OPERATION', 'i1', `overrides.title.props.${key}`],
    )
  }
})

test('S1: inserting the stamp block (a required sample title) is accepted and valid; setText on it clears the mark', () => {
  const ins = {
    op: 'insertBlock',
    tree: T,
    parent: 'homeroot',
    index: 0,
    block: 'stamp',
    look: 'default',
    id: 'st',
  }
  const r = plan(start(), reg, req([ins]))
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  const title = (d: SiteDocument) =>
    d.pages[0].root.children!.find(c => c.id === 'st')!.children![0]
  assert.equal(title(r.doc).props!.sample, true)
  assert.equal(title(r.doc).required, true)
  assert.deepEqual(validateSite(r.doc, reg), [])
  const typed = plan(
    start(),
    reg,
    req([ins, { op: 'setText', tree: T, id: 'st.title', text: 'Mine' }]),
  )
  assert.ok(typed.ok, JSON.stringify(!typed.ok && typed.problems))
  assert.equal(title(typed.doc).props!.sample, false)
})

/** A registry with the kit and a block `mk` whose title is a required sample; `fn` is its setting function, `version` the block's version. */
const markRegistry = (version = 1, fn?: SettingFn) => {
  const r = kitRegistry()
  r.use({
    name: 'mark',
    version,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    blocks: [
      {
        ...STAMP,
        id: 'mk',
        version,
        onInsert: undefined,
        settings: fn
          ? [{ key: 'm', label: 'M', type: 'switch', fn: 'mark' }]
          : [],
      },
    ],
    ...(fn ? { settingFns: { mark: fn } } : {}),
  })
  return r
}
const mkDoc = (r: ReturnType<typeof kitRegistry>) => {
  const p = plan(
    start(),
    r,
    req([
      {
        op: 'insertBlock',
        tree: T,
        parent: 'homeroot',
        index: 0,
        block: 'mk',
        look: 'default',
        id: 'mk',
      },
      { op: 'setText', tree: T, id: 'mk.title', text: 'Mine' },
    ]),
  )
  assert.ok(p.ok, JSON.stringify(!p.ok && p.problems))
  return p.doc
}

test('S1 refused: a setting function that marks a required text the owner wrote as a sample', () => {
  const marking: SettingFn = {
    read: () => false,
    apply(root) {
      const out: Node = JSON.parse(JSON.stringify(root))
      out.children![0].props = { ...out.children![0].props, sample: true }
      return out
    },
  }
  const r = markRegistry(1, marking)
  const p = firstProblem(
    plan(
      mkDoc(r),
      r,
      req([
        { op: 'setBlockSetting', tree: T, id: 'mk', key: 'm', value: true },
      ]),
    ),
  )
  assert.deepEqual(
    [p.code, p.rule, p.nodeId],
    ['POLICY_VIOLATION', 'required', 'mk.title'],
  )
})

test('S1 refused: updateBlock that resets a required text the owner wrote back to a sample', () => {
  const doc = mkDoc(markRegistry(1))
  const p = firstProblem(
    plan(doc, markRegistry(2), req([{ op: 'updateBlock', tree: T, id: 'mk' }])),
  )
  assert.deepEqual(
    [p.code, p.rule, p.nodeId],
    ['POLICY_VIOLATION', 'required', 'mk.title'],
  )
})

// ---- fourth round, CT1: a page cut at the element limit that holds required content ----

/** 79 uses of `w` (25 parts each), then `u1`, a use of `card` (its title is required); `req` false drops every required mark. */
const crowded = (required = true): SiteDocument => {
  const d = siteWith([
    ...Array.from({ length: 79 }, (_, i) => inst(`w${i}`, { component: 'w' })),
    inst('u1'),
  ])
  const c = card()
  if (!required) delete c.root.children![0].required
  d.components = [
    c as never,
    {
      id: 'w',
      name: 'W',
      root: node(
        'wroot',
        'column',
        Array.from({ length: 24 }, (_, k) => text(`wt${k}`, 'x')),
      ),
      props: [],
      variants: [],
    },
  ]
  return d
}
const addW = {
  op: 'add',
  tree: T,
  parent: 'homeroot',
  index: 0,
  node: { id: 'wx', kind: 'instance', component: 'w' },
}

test('CT1 refused through plan: an add that pushes a page with required content past the element limit', () => {
  assert.deepEqual(validateSite(crowded(), reg), [])
  const r = plan(crowded(), reg, req([addW]))
  assert.ok(!r.ok, 'expected a refusal')
  assert.deepEqual(
    r.problems.map(p => [p.code, p.rule, p.path]),
    [['RESOURCE_LIMIT_EXCEEDED', 'required', 'pages.home']],
  )
  assert.match(r.problems[0].message, /required/)
})

test('CT1: the same cut page with no required content stays valid', () => {
  const r = plan(crowded(false), reg, req([addW]))
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  assert.deepEqual(validateSite(r.doc, reg), [])
})
