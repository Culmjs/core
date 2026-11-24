import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compilePage,
  defaultSiteStyles,
  expand,
  plan,
  type Component,
  type Motion,
  type Node,
  type SiteDocument,
  type Step,
  validateSite,
} from '../../src/index.ts'
import { blockIds } from '../../src/document/tree.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'

const reg = sampleRegistry()
const step = (target: Step['target'] = 'self'): Step => ({
  target,
  from: { opacity: 0 },
  to: { opacity: 1 },
  durationMs: 500,
})
const motion = (...steps: Step[]): Motion => ({ trigger: 'enter-view', steps })
const hero = () => node('hero', 'column', [text('title', 'Reed Ledger')])
const raw = (m: unknown, owner = hero()) =>
  siteWith([{ ...owner, motion: m as Motion }])
const site = (s: Step) => raw(motion(s))
const refused = (doc: SiteDocument, path: string, id = 'hero') => {
  const problems = validateSite(doc, reg)
  assert.ok(
    problems.some(
      p => p.code === 'INVALID_NODE' && p.nodeId === id && p.path === path,
    ),
    JSON.stringify(problems),
  )
  assert.ok(
    !problems.some(p => p.code === 'INVALID_DOCUMENT'),
    JSON.stringify(problems),
  )
}
const use = (id: string, component: string): Node => ({
  ...node(id, 'instance'),
  component,
})
const master = (root: Node): Component => ({
  id: 'card',
  name: 'Card',
  root,
  props: [],
  variants: [],
})
const expanded = (doc: SiteDocument) =>
  expand(doc.pages[0].root, {
    components: doc.components,
    styles: defaultSiteStyles(doc.look),
    fonts: doc.fonts,
    data: { rows: { projects: [{ title: 'One' }, { title: 'Two' }] } },
  }).tree.children!
const target = (w: Node) =>
  w.motion && 'steps' in w.motion && w.motion.steps[0].target

test('a bounded, two-step program addresses its owner and an authored descendant', () => {
  const doc = raw(
    motion(
      {
        ...step(),
        from: { xPx: -2000, yPx: 2000, scale: 0 },
        to: { scale: 8, yPx: -2000, xPx: 2000 },
        delayMs: 0,
        durationMs: 1,
        staggerMs: 1000,
        ease: 'linear',
      },
      {
        ...step({ id: 'title' }),
        from: { xPercent: -200, rotateDeg: -360, scaleX: 0 },
        to: { scaleX: 8, rotateDeg: 360, xPercent: 200 },
        durationMs: 10000,
        delayMs: 10000,
        ease: 'ease-out',
      },
    ),
  )
  assert.deepEqual(validateSite(doc, reg), [])
  for (const trigger of [
    'load',
    'enter-view',
    'hover',
    'press',
    'scroll',
    'pointer-x',
  ])
    assert.deepEqual(
      validateSite(
        raw({
          trigger,
          steps: Array.from({ length: 16 }, () => step('children')),
        }),
        reg,
      ),
      [],
    )
})

test('refusals describe the field on the stored node, including on direct compile', () => {
  for (const durationMs of [0, -1, 1.5, 10001, NaN, Infinity]) {
    const doc = site({ ...step(), durationMs })
    refused(doc, 'motion.steps.0.durationMs')
    const compiled = compilePage(doc, 'home', { registry: reg })
    assert.equal(compiled.ok, false)
    assert.ok(
      compiled.problems.some(
        p => p.nodeId === 'hero' && p.path === 'motion.steps.0.durationMs',
      ),
    )
  }
  for (const [key, val] of [
    ['delayMs', -1],
    ['delayMs', 10001],
    ['staggerMs', 0.1],
    ['staggerMs', 1001],
    ['ease', 'url(foo)'],
  ] as const)
    refused(site({ ...step(), [key]: val }), `motion.steps.0.${key}`)
  for (const steps of [[], Array(17).fill(step()), {}, null])
    refused(raw({ trigger: 'load', steps }), 'motion.steps')
  refused(raw({ trigger: 'load', steps: [null] }), 'motion.steps.0')
  refused(raw(null), 'motion')
})

test('frames have matching, nonempty, finite properties with bounded units', () => {
  for (const [key, val] of [
    ['opacity', 1.01],
    ['xPx', -2001],
    ['yPx', Infinity],
    ['xPercent', 201],
    ['scale', -0.1],
    ['scaleX', 8.01],
    ['rotateDeg', NaN],
    ['draw', 1.1],
  ] as const)
    refused(
      site({ ...step(), from: { [key]: val }, to: { [key]: 1 } }),
      `motion.steps.0.from.${key}`,
    )
  for (const frame of [
    {},
    null,
    [],
    { scale: 1, scaleX: 2 },
    { xPx: 1, xPercent: 1 },
  ])
    refused(
      raw({ trigger: 'load', steps: [{ ...step(), from: frame, to: frame }] }),
      'motion.steps.0.from',
    )
  refused(site({ ...step(), to: { xPx: 4 } }), 'motion.steps.0.to')
})

test('closed objects and exclusive program branches; unresolved effects never pass', () => {
  refused(raw({ ...motion(step()), repeat: 'forever' }), 'motion.repeat')
  refused(
    raw({ trigger: 'load', steps: [{ ...step(), css: 'color:red' }] }),
    'motion.steps.0.css',
  )
  refused(
    raw({
      trigger: 'load',
      steps: [{ ...step(), from: { transform: 'scale(8)' } }],
    }),
    'motion.steps.0.from.transform',
  )
  refused(raw({ trigger: 'load', effect: 'no-such-effect' }), 'motion.effect')
  refused(raw({ trigger: 'load', effect: [] }), 'motion.effect')
  refused(
    raw({ trigger: 'load', steps: [step()], effect: 'no-such-effect' }),
    'motion.effect',
  )
  refused(
    raw({ trigger: 'load', steps: [step()], settings: {} }),
    'motion.settings',
  )
  refused(
    raw({ trigger: 'load', effect: 'missing', settings: { distance: NaN } }),
    'motion.settings.distance',
  )
  refused(raw({ trigger: 'click', steps: [step()] }), 'motion.trigger')
  refused(siteWith([{ ...hero(), enter: 'slide' } as Node]), 'enter')
  refused(siteWith([{ ...hero(), props: { motion: 'rise' } }]), 'props.motion')
})

test('only exact descendant IDs resolve: not self, siblings, ancestors, other trees or selectors', () => {
  for (const tgt of [
    '#title',
    { id: 'missing' },
    { id: 'hero' },
    { id: 'header' },
    { id: 'homeroot' },
    { id: 'other' },
    {},
    [],
    null,
    { id: {} },
    { id: '#title' },
    { id: 'title', part: 'letters' },
    { id: 'title', selector: 'p' },
  ]) {
    const doc = raw({ trigger: 'load', steps: [{ ...step(), target: tgt }] })
    doc.pages[0].root.children!.push(text('other', 'Elsewhere'))
    refused(doc, 'motion.steps.0.target')
  }
})

test('state triggers use ancestor and header context, never a sibling declaration', () => {
  const doc = raw({ trigger: { state: 'mode', is: 'on' }, steps: [step()] })
  const state = [{ name: 'mode', values: 'on-off' as const, initial: 'off' }]
  refused(doc, 'motion.trigger.state')
  doc.pages[0].root.children!.push({ ...node('sibling', 'box'), state })
  refused(doc, 'motion.trigger.state')
  doc.pages[0].root.children!.pop()
  doc.pages[0].root.state = state
  assert.deepEqual(validateSite(doc, reg), [])
  delete doc.pages[0].root.state
  doc.header.state = state
  assert.deepEqual(validateSite(doc, reg), [])
  doc.pages[0].root.children![0].motion!.trigger = {
    state: 'mode',
    is: 'unknown',
  }
  refused(doc, 'motion.trigger.is')
  refused(
    raw({ trigger: { state: 'mode', is: 'on', run: 'js' }, steps: [step()] }),
    'motion.trigger.run',
  )
})

test('masked splitting is limited to text; path drawing addresses a visible stroke explicitly', () => {
  for (const split of ['lines', 'words', 'letters'] as const) {
    const s = { ...step(split), mask: true, ease: 'expo-out' as const }
    assert.deepEqual(
      validateSite(raw(motion(s), text('hero', 'Reed Ledger')), reg),
      [],
    )
    refused(site(s), 'motion.steps.0.target')
  }
  refused(site({ ...step(), mask: false }), 'motion.steps.0.mask')
  const path: Node = {
    ...node('line', 'shape'),
    props: {
      geometry: { type: 'path', d: 'M0 0L1 1' },
      stroke: { color: 'ink', width: 2 },
    },
  }
  const draw = (target: Step['target']): Step => ({
    ...step(target),
    from: { draw: 0 },
    to: { draw: 1 },
  })
  assert.deepEqual(validateSite(raw(motion(draw('path')), path), reg), [])
  const owner = node('hero', 'box', [path])
  assert.deepEqual(
    validateSite(raw(motion(draw({ id: 'line', part: 'path' })), owner), reg),
    [],
  )
  refused(raw(motion(draw({ id: 'line' })), owner), 'motion.steps.0.target')
  refused(raw(motion(draw('self')), path), 'motion.steps.0.target', 'line')
  path.props!.stroke = { color: 'ink', width: 0 }
  refused(raw(motion(draw('path')), path), 'motion.steps.0.target', 'line')
  delete path.props!.stroke
  refused(raw(motion(draw('path')), path), 'motion.steps.0.target', 'line')
  path.props!.stroke = { color: 'ink', width: 2 }
  path.props!.geometry = { type: 'ellipse' }
  refused(raw(motion(draw('path')), path), 'motion.steps.0.target', 'line')
})

test('scroll options require scroll, a bounded pin and one child on a container', () => {
  const m = {
    trigger: 'scroll',
    steps: [step()],
    pinPx: 1,
    scrollFallback: 'timeline',
  }
  for (const pinPx of [1, 4000])
    assert.deepEqual(validateSite(raw({ ...m, pinPx }), reg), [])
  for (const pinPx of [0, 4001, Infinity])
    refused(raw({ ...m, pinPx }), 'motion.pinPx')
  refused(raw({ ...m, trigger: 'load' }), 'motion.pinPx')
  refused(raw({ ...m, trigger: 'hover' }), 'motion.scrollFallback')
  refused(raw({ ...m, scrollFallback: 'script' }), 'motion.scrollFallback')
  refused(raw(m, text('hero', 'Leaf')), 'motion.pinPx')
  refused(raw(m, node('hero', 'column', [])), 'motion.pinPx')
  refused(
    raw(m, node('hero', 'column', [text('a', 'A'), text('b', 'B')])),
    'motion.pinPx',
  )
})

test('block and component copies retarget master programs; an instance replaces only its own root program', () => {
  const root = { ...hero(), motion: motion(step({ id: 'title' })) }
  const before = structuredClone(root)
  const block = blockIds('intro', root)
  block.origin = { block: 'demo', version: 1, look: 'default' }
  assert.deepEqual(target(block), { id: 'intro.title' })
  assert.deepEqual(validateSite(siteWith([block]), reg), [])
  const component = master(root)
  component.props.push({
    key: 'slot',
    type: 'slot',
    label: 'Slot',
    part: 'hero',
  })
  const c = {
    ...use('c', 'card'),
    children: [text('slotchild', 'Slot')],
    motion: motion(step({ id: 'slotchild' })),
  }
  const doc = siteWith([use('a', 'card'), use('b', 'card'), c], {
    components: [component],
  })
  const original = structuredClone(doc)
  assert.deepEqual(validateSite(doc, reg), [])
  assert.deepEqual(expanded(doc).map(target), [
    { id: 'a.title' },
    { id: 'b.title' },
    { id: 'slotchild' },
  ])
  assert.deepEqual(doc, original)
  assert.deepEqual(root, before)
  c.motion = motion(step({ id: 'c.title' }))
  refused(doc, 'motion.steps.0.target', 'c')
})

test('uses get the effective root kind and effective children for split and pin', () => {
  const component = master(text('copy', 'Reed Ledger'))
  const inst = { ...use('hero', 'card'), motion: motion(step('words')) }
  const doc = siteWith([inst], { components: [component] })
  assert.deepEqual(validateSite(doc, reg), [])
  component.root = node('panel', 'column', [text('label', 'Hi')])
  refused(doc, 'motion.steps.0.target')
  inst.motion = { trigger: 'scroll', pinPx: 400, steps: [step()] }
  assert.deepEqual(validateSite(doc, reg), [])
  component.props.push({
    type: 'slot',
    key: 'slot',
    label: 'Slot',
    part: 'panel',
  })
  inst.children = [text('second', 'Two')]
  refused(doc, 'motion.pinPx')
})

test('an effective path target respects the geometry an instance overrides', () => {
  const component = master({
    ...node('glyph', 'shape'),
    props: {
      geometry: { type: 'path', d: 'M0 0L1 1' },
      stroke: { color: 'ink', width: 2 },
    },
  })
  const inst = use('mark', 'card')
  const doc = raw(
    motion({
      ...step({ id: 'mark', part: 'path' }),
      from: { draw: 0 },
      to: { draw: 1 },
    }),
    node('hero', 'column', [inst]),
  )
  doc.components = [component]
  assert.deepEqual(validateSite(doc, reg), [])
  inst.overrides = { glyph: { props: { geometry: { type: 'ellipse' } } } }
  refused(doc, 'motion.steps.0.target')
})

test('each list row owns its motion, and a data condition may drop a valid target', () => {
  const item = {
    ...node('item', 'column', [text('title', 'Row')]),
    motion: motion(step({ id: 'title' })),
  }
  const list = {
    ...node('list', 'list', [item]),
    repeat: { source: 'projects' },
  }
  const doc = siteWith([list])
  const original = structuredClone(doc)
  assert.deepEqual(validateSite(doc, reg), [])
  assert.deepEqual(expanded(doc)[0].children!.map(target), [
    { id: 'title~0' },
    { id: 'title~1' },
  ])
  assert.deepEqual(doc, original)
  list.children![0].children![0].showIf = { from: 'site', field: 'show' }
  assert.deepEqual(validateSite(doc, reg), [])
  assert.deepEqual(
    expanded(doc)[0].children!.map(row => row.children),
    [[], []],
  )
  list.motion = motion(step({ id: 'title' }))
  refused(doc, 'motion.steps.0.target', 'list')
})

test('the table header stays singular; only the final row starts a new template scope', () => {
  const row = (id: string) =>
    node(id, 'table-row', [node(id + 'cell', 'table-cell')])
  const body = { ...row('body'), motion: motion(step({ id: 'bodycell' })) }
  const table = {
    ...node('table', 'table', [row('head'), body]),
    repeat: { source: 'projects' },
    motion: motion(step({ id: 'headcell' })),
  }
  const doc = siteWith([table])
  assert.deepEqual(validateSite(doc, reg), [])
  assert.deepEqual(expanded(doc)[0].children!.slice(1).map(target), [
    { id: 'bodycell~0' },
    { id: 'bodycell~1' },
  ])
  for (const id of ['body', 'bodycell']) {
    table.motion = motion(step({ id }))
    refused(doc, 'motion.steps.0.target', 'table')
  }
})

test('nested templates retarget a component path through both repeat suffixes', () => {
  const shape: Node = {
    ...node('line', 'shape'),
    props: {
      geometry: { type: 'path', d: 'M0 0L1 1' },
      stroke: { color: 'ink', width: 1 },
    },
  }
  const component = master({
    ...node('panel', 'column', [shape]),
    motion: motion({
      ...step({ id: 'line', part: 'path' }),
      from: { draw: 0 },
      to: { draw: 1 },
    }),
  })
  const list = (id: string, row: Node) => ({
    ...node(id, 'list', [row]),
    repeat: { source: 'projects' },
  })
  const outer = node('outer', 'column', [
    list('innerlist', use('carduse', 'card')),
  ])
  const doc = siteWith([list('outerlist', outer)], { components: [component] })
  const original = structuredClone(doc)
  assert.deepEqual(validateSite(doc, reg), [])
  const copies = expanded(doc)[0].children!.flatMap(
    row => row.children![0].children!,
  )
  assert.deepEqual(copies.map(target), [
    { id: 'carduse.line~0~0', part: 'path' },
    { id: 'carduse.line~1~0', part: 'path' },
    { id: 'carduse.line~0~1', part: 'path' },
    { id: 'carduse.line~1~1', part: 'path' },
  ])
  assert.deepEqual(doc, original)
  outer.motion = motion(step({ id: 'carduse' }))
  refused(doc, 'motion.steps.0.target', 'outer')
})

test('checking an unused component cannot bind over the stored default text runs', () => {
  const card = master(text('copy', 'Initial'))
  card.props = [
    {
      key: 'words',
      label: 'Words',
      type: 'text',
      part: 'copy',
      field: 'text',
      default: [{ text: 'Stored words' }],
    },
    {
      key: 'word',
      label: 'Word',
      type: 'text',
      part: 'copy',
      field: 'text',
      run: 0,
    },
  ]
  const inst = use('bound', 'card')
  inst.bind = { word: { from: 'site', field: 'title' } }
  const wrapper = { ...master(node('wrapper', 'column', [inst])), id: 'unused' }
  wrapper.root.motion = motion(step())
  const before = siteWith([], { components: [card, wrapper] })
  for (const run of [
    (doc: SiteDocument) => assert.deepEqual(validateSite(doc, reg), []),
    (doc: SiteDocument) =>
      assert.equal(compilePage(doc, 'home', { registry: reg }).ok, true),
    (doc: SiteDocument) =>
      assert.equal(
        plan(doc, reg, {
          site: 'example',
          key: 'empty',
          baseRevision: 0,
          ops: [],
        }).ok,
        true,
      ),
  ]) {
    const input = structuredClone(before)
    run(input)
    assert.deepEqual(input, before)
  }
})

function branchStates() {
  const branch = (id: string, values: string[]): Node => ({
    ...node(id, 'column'),
    state: [{ name: 'mode', values, initial: values[0] }],
  })
  const component = master(
    node('panel', 'column', [
      branch('sibling', ['light', 'dark']),
      branch('slotpart', ['short', 'long']),
    ]),
  )
  component.props = [
    { key: 'slot', type: 'slot', label: 'Slot', part: 'slotpart' },
  ]
  const inst = use('hero', 'card')
  return { component, inst, doc: siteWith([inst], { components: [component] }) }
}

test('an instance root cannot use a state declared below it in a sibling of the slot', () => {
  const { doc, inst } = branchStates()
  inst.motion = { trigger: { state: 'mode', is: 'dark' }, steps: [step()] }
  refused(doc, 'motion.trigger.state')
  assert.equal(compilePage(doc, 'home', { registry: reg }).ok, false)
})

test('a slotted node gets its actual ancestor’s values, not the first declaration in the master', () => {
  const { doc, inst } = branchStates()
  const child = text('slotted', 'Slot')
  inst.children = [child]
  child.motion = { trigger: { state: 'mode', is: 'long' }, steps: [step()] }
  assert.deepEqual(validateSite(doc, reg), [])
  assert.equal(compilePage(doc, 'home', { registry: reg }).ok, true)
  child.motion.trigger = { state: 'mode', is: 'dark' }
  refused(doc, 'motion.trigger.is', 'slotted')
})

test('page and footer motion see a state on the composed header root', () => {
  const header = master(node('bar', 'column', [text('name', 'Site')]))
  header.root.state = [{ name: 'contrast', values: 'on-off', initial: 'off' }]
  const m: Motion = {
    trigger: { state: 'contrast', is: 'on' },
    steps: [step()],
  }
  const doc = siteWith([{ ...hero(), motion: m }], {
    components: [header],
    header: use('head', 'card'),
  })
  doc.footer.motion = m
  assert.deepEqual(validateSite(doc, reg), [])
  delete header.root.state
  header.root.children![0].state = [
    { name: 'contrast', values: 'on-off', initial: 'off' },
  ]
  refused(doc, 'motion.trigger.state')
})

test('pinning needs a potentially visible child across layouts, theme and declared states', () => {
  const child = text('title', 'Pinned')
  const owner = node('hero', 'column', [child])
  owner.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  owner.motion = { trigger: 'scroll', pinPx: 500, steps: [step()] }
  const doc = siteWith([owner])
  child.style = { base: { hidden: true } }
  refused(doc, 'motion.pinPx')
  assert.equal(compilePage(doc, 'home', { registry: reg }).ok, false)
  child.style.tablet = { hidden: false }
  child.style.phone = { hidden: true }
  assert.deepEqual(validateSite(doc, reg), [])
  child.hide = { tablet: true }
  refused(doc, 'motion.pinPx')
  child.style.when = [{ state: 'mode', is: 'on', decl: { hidden: false } }]
  assert.deepEqual(validateSite(doc, reg), [])
  child.style.when.push({ state: 'mode', is: 'on', decl: { hidden: true } })
  refused(doc, 'motion.pinPx') // the later rule wins for the same state/value
  child.style.when.pop()
  child.hide = { desktop: true, phone: true }
  refused(doc, 'motion.pinPx') // omitted even from the live tree
  delete child.hide
  child.style = { base: { hidden: true }, dark: { hidden: false } }
  assert.deepEqual(validateSite(doc, reg), [])
  doc.look = { ...doc.look, dark: 'light' }
  refused(doc, 'motion.pinPx')
  child.style = { base: { hidden: true } }
  owner.children!.push(text('visible', 'One visual child'))
  assert.deepEqual(validateSite(doc, reg), [])
})

test('a pin on a use sees the visual child after a part override', () => {
  const card = master(hero())
  const inst = use('use', 'card')
  inst.motion = { trigger: 'scroll', pinPx: 200, steps: [step()] }
  inst.overrides = { title: { style: { base: { hidden: true } } } }
  const doc = siteWith([inst], { components: [card] })
  refused(doc, 'motion.pinPx', 'use')
  inst.overrides.title.style!.phone = { hidden: false }
  assert.deepEqual(validateSite(doc, reg), [])
})

for (const sibling of [false, true]) {
  test(`a tablet-grid list counts as a pin child ${sibling ? 'beside another child' : 'on its own'}`, () => {
    const list = node('items', 'list', [
      node('item', 'box', [text('label', 'One')]),
    ])
    list.style = { base: { hidden: true }, tablet: { align: 'center' } }
    const owner = node('hero', 'column', [
      list,
      ...(sibling ? [text('aside', 'Two')] : []),
    ])
    const doc = siteWith([owner])
    const plain = compilePage(doc, 'home', { registry: reg })
    assert.ok(plain.ok)
    assert.match(
      plain.css,
      /@media \(max-width: 1024px\)\{[^@]*display:grid;grid-template-columns:minmax\(0,max-content\);justify-content:center/,
    )
    owner.motion = { trigger: 'scroll', pinPx: 400, steps: [step()] }
    if (sibling) {
      refused(doc, 'motion.pinPx')
      assert.equal(compilePage(doc, 'home', { registry: reg }).ok, false)
    } else {
      assert.deepEqual(validateSite(doc, reg), [])
      assert.equal(compilePage(doc, 'home', { registry: reg }).ok, true)
    }
  })
}

test('tablet layout can restore the display of an ordered box or a wrapping container', () => {
  const ordered = node('ordered', 'box', [
    text('copy', 'First', { style: { tablet: { order: 1 } } }),
  ])
  const wrapped = node('wrapped', 'column', [
    {
      ...node('photo', 'image'),
      props: { alt: 'Portrait', fallback: 'Portrait' },
      placement: { mode: 'normal', tablet: { mode: 'wrap-start' } },
    },
  ])
  for (const child of [ordered, wrapped]) {
    child.style = { base: { hidden: true } }
    const owner = node('hero', 'column', [child])
    const doc = siteWith([owner])
    owner.motion = { trigger: 'scroll', pinPx: 400, steps: [step()] }
    assert.deepEqual(validateSite(doc, reg), [])
    child.hide = { tablet: true, phone: true }
    refused(doc, 'motion.pinPx')
  }
})

test('a page cannot depend on a header root declaration past the composition budget', () => {
  const chain = Array.from({ length: 66 }, (_, i) => ({
    ...master(i === 65 ? node('bar', 'column') : use('link', `c${i + 1}`)),
    id: `c${i}`,
  }))
  chain[65].root.state = [
    { name: 'contrast', values: 'on-off', initial: 'off' },
  ]
  const owner = hero()
  owner.motion = { trigger: { state: 'contrast', is: 'on' }, steps: [step()] }
  const doc = siteWith([owner], {
    header: use('header', 'c0'),
    components: chain,
  })
  const problems = validateSite(doc, reg)
  assert.ok(
    problems.some(
      p =>
        p.code === 'RESOURCE_LIMIT_EXCEEDED' &&
        p.nodeId === 'hero' &&
        p.path === 'motion.trigger.state',
    ),
    JSON.stringify(problems),
  )
  const compiled = compilePage(doc, 'home', { registry: reg })
  assert.equal(compiled.ok, false)
  assert.deepEqual(compiled.problems, problems)
  owner.state = [{ name: 'local', values: 'on-off', initial: 'off' }]
  owner.motion.trigger = { state: 'local', is: 'on' }
  assert.deepEqual(validateSite(doc, reg), []) // the local declaration does not depend on the cut header
  delete owner.state
  doc.header.state = [{ name: 'banner', values: 'on-off', initial: 'off' }]
  owner.motion.trigger = { state: 'banner', is: 'on' }
  assert.deepEqual(validateSite(doc, reg), []) // the returned header still holds its own declaration
  const surviving = compilePage(doc, 'home', { registry: reg })
  assert.ok(surviving.ok)
  assert.match(surviving.html, /data-s-banner="off"/)
  owner.motion.trigger = { state: 'contrast', is: 'on' }
  doc.header.component = 'c5' // the same declaration is reachable in a shorter chain
  assert.deepEqual(validateSite(doc, reg), [])
  const reachable = compilePage(doc, 'home', { registry: reg })
  assert.ok(reachable.ok)
  assert.match(reachable.html, /data-s-contrast="off"/)
})
