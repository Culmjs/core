import assert from 'node:assert/strict'
import test from 'node:test'
import * as core from '../../src/index.ts'
import { plan } from '../../src/ops/index.ts'
import type { EffectDef, Motion, Step } from '../../src/index.ts'
import {
  DEMO_PLUGIN,
  node,
  sampleRegistry,
  siteWith,
  text,
  twoPages,
} from '../kit.ts'

const step = (target: Step['target'] = 'self'): Step => ({
  target,
  from: { opacity: 0 },
  to: { opacity: 1 },
  durationMs: 400,
})
const def = (settings: Partial<EffectDef> = {}): EffectDef => ({
  name: 'lift',
  tier: 1,
  settings: { distance: { min: 0, max: 100, default: 16 } },
  steps: ({ distance }) => [
    { ...step(), from: { yPx: distance }, to: { yPx: 0 } },
  ],
  ...settings,
})
const plugin = (...effects: EffectDef[]) => ({
  ...DEMO_PLUGIN,
  name: 'motion',
  effects,
})
const doc = (motion: Motion) =>
  siteWith([{ ...node('hero', 'column', [text('title', 'Test')]), motion }])

for (const [target, nested] of [
  ['n1', false],
  ['title', true],
  ['n2', false],
] as const)
  test(`detach keeps the preset on Title (${target}, nested=${nested})`, () => {
    const reg = core.createRegistry()
    reg.use(plugin(def({ steps: () => [step({ id: target })] })))
    const preset = { trigger: 'load', effect: 'rise' } as const
    const panel = node('panel', 'column', [
      text('caption', 'Caption', { motion: preset }),
      text(target, 'Title'),
    ])
    panel.motion = { trigger: 'load', effect: 'lift' }
    const master = {
      id: 'panel',
      name: 'Panel',
      props: [],
      variants: [],
      root: panel,
    }
    const outer = {
      ...master,
      id: 'outer',
      root: node('wrap', 'box', [
        { ...node('inner', 'instance'), component: 'panel' },
      ]),
    }
    const d = siteWith(
      [{ ...node('use', 'instance'), component: nested ? 'outer' : 'panel' }],
      {
        components: [master, outer],
      },
    )
    const before = structuredClone(d)
    const marked = (site: typeof d) => {
      const p = core.compilePage(site, 'home', {
        registry: reg,
        mode: 'measure',
      })
      assert.ok(p.ok, JSON.stringify(p.problems))
      assert.match(p.html, /<p[^>]*cm-t\d+[^>]*>Title<\/p>/)
    }
    marked(d)
    const r = plan(d, reg, {
      site: 's',
      key: 'k',
      baseRevision: 0,
      ops: [{ op: 'detach', tree: { page: 'home' }, id: 'use' }],
    })
    assert.ok(r.ok, JSON.stringify(r))
    marked(r.doc)
    const use = r.doc.pages[0].root.children![0]
    const detached = nested ? use.children![0] : use
    assert.deepEqual(detached.children![0].motion, preset)
    if (target === 'n2') assert.deepEqual(detached.motion, panel.motion)
    assert.deepEqual(d, before)
  })

test('materializing an id-bearing tier-2 scroll preset keeps its old-engine scrub', () => {
  const reg = core.createRegistry()
  reg.use(plugin(def({ tier: 2, steps: () => [step({ id: 'title' })] })))
  const root = node('panel', 'box', [text('title', 'Title')])
  root.motion = { trigger: 'scroll', effect: 'lift' }
  const d = siteWith([{ ...node('use', 'instance'), component: 'panel' }], {
    components: [{ id: 'panel', name: 'Panel', props: [], variants: [], root }],
  })
  const r = plan(d, reg, {
    site: 's',
    key: 'k',
    baseRevision: 0,
    ops: [{ op: 'detach', tree: { page: 'home' }, id: 'use' }],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.doc.pages[0].root.children![0].motion, {
    trigger: 'scroll',
    steps: [step({ id: 'n1' })],
    scrollFallback: 'timeline',
  })
})

test('block look presets address exactly the same inserted parts as handwritten local targets', () => {
  const reg = core.createRegistry()
  const looks = ['written', 'named'].map(id => ({
    id,
    name: id,
    tree: {
      ...node('root', 'column', [text('title', 'Reed')]),
      motion: (id === 'written'
        ? { trigger: 'load', steps: [step({ id: 'title' })] }
        : { trigger: 'load', effect: 'lift' }) as Motion,
    },
  }))
  reg.use({
    ...plugin(def({ steps: () => [step({ id: 'title' })] })),
    blocks: [
      {
        id: 'reed',
        version: 1,
        name: 'Reed',
        category: 'utility',
        settings: [],
        looks,
      },
    ],
  })
  const results = looks.map(({ id }) => {
    const r = core.insertBlock(reg, 'reed', id, 'card')
    assert.ok(r.ok)
    const d = siteWith([r.root, text('title', 'Unrelated')])
    const out = core.compilePage(d, 'home', { registry: reg, mode: 'measure' })
    assert.ok(out.ok, JSON.stringify(out.problems))
    assert.match(out.html, /<p[^>]*cm-t\d+[^>]*data-id="card\.title"/)
    return out.html
  })
  assert.equal(results[0], results[1])
  const r = core.insertBlock(reg, 'reed', 'named', 'card')
  assert.ok(r.ok)
  r.root.children = [
    {
      ...node('other', 'box', [text('other.title', 'No suffix lookup')]),
      origin: { block: 'reed', look: 'named', version: 1 },
    },
  ]
  const bad = core.validateSite(
    siteWith([r.root, text('title', 'Sibling')]),
    reg,
  )
  assert.ok(
    bad.some(p => p.nodeId === 'card' && p.path === 'motion.steps.0.target'),
    JSON.stringify(bad),
  )
})
test('a block-qualified candidate outside the owner or across a repeat cannot shadow its local target', () => {
  const reg = sampleRegistry()
  reg.use({
    ...plugin(def({ steps: () => [step({ id: 'title' })] })),
    blocks: [],
    sources: [],
    settingFns: {},
  })
  for (const acrossRepeat of [false, true]) {
    const inner = node('inner', 'box', [text('title', 'Mine')])
    const unrelated = text('card.title', 'Not mine')
    if (acrossRepeat)
      inner.children!.push({
        ...node('list', 'list', [node('item', 'column', [unrelated])]),
        repeat: { source: 'projects' },
      })
    const card = {
      ...node('card', 'box', acrossRepeat ? [inner] : [inner, unrelated]),
      origin: { block: 'demo', look: 'default', version: 1 },
    }
    const doc = siteWith([card])
    const compile = () => {
      const p = core.compilePage(doc, 'home', {
        registry: reg,
        mode: 'measure',
        data: { rows: { projects: [{ title: 'Row' }] } },
      })
      assert.ok(p.ok, JSON.stringify(p.problems))
      return p.html
    }
    inner.motion = { trigger: 'load', steps: [step({ id: 'title' })] }
    const expected = compile()
    assert.match(expected, /<p[^>]*cm-t\d+[^>]*data-id="title"/)
    inner.motion = { trigger: 'load', effect: 'lift' }
    assert.equal(compile(), expected)
    inner.children!.shift()
    assert.ok(
      core
        .validateSite(doc, reg)
        .some(p => p.nodeId === 'inner' && p.path === 'motion.steps.0.target'),
    )
  }
})
test('registry exposes rise and plug-in definitions; capability is distinct from the invocation', () => {
  const reg = core.createRegistry()
  reg.use(plugin(def()))
  assert.deepEqual(
    reg.effects().map(d => d.name),
    ['rise', 'lift'],
  )
  assert.deepEqual(reg.effect('rise')?.settings.distance, {
    min: 0,
    max: 100,
    default: 16,
  })
  for (const trigger of ['load', 'enter-view', 'pointer-x'] as const) {
    const m: Motion = { trigger, effect: 'lift', settings: { distance: 22 } }
    assert.deepEqual(core.validateSite(doc(m), reg), [])
    assert.deepEqual(core.lowerMotion(m, reg), {
      tier: trigger === 'load' ? 1 : 2,
      steps: [{ ...step(), from: { yPx: 22 }, to: { yPx: 0 } }],
    })
  }
  for (const m of [
    { trigger: 'scroll', effect: 'rise', scrollFallback: 'timeline' },
    { trigger: 'scroll', effect: 'rise', pinPx: 100 },
    { trigger: 'load', steps: [step(), step({ id: 'title' })] },
    { trigger: 'load', steps: [step('path')] },
    { trigger: 'load', steps: [step('words')] },
    { trigger: 'load', steps: [{ ...step('children'), staggerMs: 20 }] },
  ] satisfies Motion[])
    assert.equal(core.lowerMotion(m, reg).tier, 2)
})
test('duplicate, ill-defined or host-requiring tier-1 effects reject the entire registration', () => {
  for (const bad of [
    def({ name: 'rise' }),
    def({ name: 'a' }),
    def({ settings: { distance: { min: 1, max: 10, default: 0 } } }),
    def({ steps: () => [] }),
    def({
      steps: () => {
        throw Error('bad')
      },
    }),
    def({ steps: () => [{ ...step(), durationMs: NaN }] }),
    def({ steps: () => [step('letters')] }),
    def({ steps: () => [step(), step({ id: 'title' })] }),
  ]) {
    const reg = core.createRegistry()
    assert.throws(() => reg.use(plugin(def({ name: 'a' }), bad)))
    assert.equal(reg.block('demo'), undefined)
    assert.deepEqual(reg.plugins(), [])
    assert.deepEqual(
      reg.effects().map(d => d.name),
      ['rise'],
    )
  }
})
test('bad settings and factory output at invocation are structured refusals on the owner', () => {
  const reg = core.createRegistry()
  reg.use(
    plugin(
      def({
        steps: ({ distance }) => {
          if (distance === 2) throw Error('bad')
          return distance === 4
            ? [step('children'), step()]
            : [{ ...step(), durationMs: distance === 3 ? -1 : 400 }]
        },
      }),
    ),
  )
  for (const [settings, path] of [
    [{ other: 0 }, 'motion.settings.other'],
    [{ distance: 101 }, 'motion.settings.distance'],
    [{ distance: NaN }, 'motion.settings.distance'],
    [{ distance: 2 }, 'motion.effect'],
    [{ distance: 3 }, 'motion.steps.0.durationMs'],
    [{ distance: 4 }, 'motion.effect'],
  ] as const) {
    const r = core.compilePage(
      doc({ trigger: 'load', effect: 'lift', settings }),
      'home',
      { registry: reg },
    )
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some(p => p.path === path && p.nodeId === 'hero'),
      JSON.stringify(r.problems),
    )
  }
})
test('one checked factory result follows master and repeated copies to the rendered descendant', () => {
  let calls = 0
  const reg = sampleRegistry()
  reg.use({
    ...plugin(
      def({
        steps: () => {
          calls++
          return [step({ id: 'title' })]
        },
      }),
    ),
    blocks: [],
    sources: [],
    settingFns: {},
  })
  const root = node('panel', 'column', [text('title', 'Title')])
  root.motion = { trigger: 'hover', effect: 'lift' }
  const use = { ...node('item', 'instance'), component: 'card' }
  const d = siteWith(
    [{ ...node('list', 'list', [use]), repeat: { source: 'projects' } }],
    {
      components: [{ id: 'card', name: 'Card', root, props: [], variants: [] }],
    },
  )
  calls = 0
  const before = structuredClone(d)
  const r = core.compilePage(d, 'home', {
    registry: reg,
    mode: 'measure',
    data: { rows: { projects: [{ title: 'A' }, { title: 'B' }] } },
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  assert.equal(calls, 1)
  for (const i of [0, 1])
    assert.match(
      r.html,
      new RegExp(
        `<p[^>]*class="[^"]*cm-\\w+[^"]*"[^>]*data-id="item\\.title~${i}"`,
      ),
    )
  assert.deepEqual(d, before)
})
test('the checked preset targets are rechecked against effective component geometry', () => {
  const reg = core.createRegistry()
  reg.use(
    plugin(
      def({
        tier: 2,
        steps: () => [
          {
            ...step({ id: 'title', part: 'path' }),
            from: { draw: 0 },
            to: { draw: 1 },
          },
        ],
      }),
    ),
  )
  const root = node('panel', 'column', [
    {
      ...node('title', 'shape'),
      props: {
        geometry: { type: 'path' as const, d: 'M0 0L1 1' },
        stroke: { color: 'ink' as const, width: 1 },
      },
    },
  ])
  root.motion = { trigger: 'load', effect: 'lift' }
  const use = {
    ...node('item', 'instance'),
    component: 'card',
    overrides: { title: { props: { geometry: { type: 'ellipse' as const } } } },
  }
  const d = siteWith([use], {
    components: [{ id: 'card', name: 'Card', root, props: [], variants: [] }],
  })
  const r = core.compilePage(d, 'home', { registry: reg })
  assert.equal(r.ok, false)
  assert.ok(
    r.problems.some(
      p => p.nodeId === 'item' && p.path === 'motion.steps.0.target',
    ),
    JSON.stringify(r.problems),
  )
})

test('a site build uses one private snapshot, even if the plug-in later mutates its result', () => {
  const shared = [{ ...step(), from: { xPx: 0 }, to: { xPx: 17 } }]
  let calls = 0
  const reg = core.createRegistry()
  reg.use({
    ...plugin(
      def({
        steps: () => {
          calls++
          return shared
        },
      }),
    ),
    rules: [
      {
        name: 'later',
        check: () => {
          shared[0].to.xPx = 777
          return []
        },
      },
    ],
  })
  const d = twoPages([], [])
  d.header.children = [
    text('logo', 'Reed', { motion: { trigger: 'load', effect: 'lift' } }),
  ]
  calls = 0
  const site = core.compileSite(d, { registry: reg })
  assert.deepEqual(site.problems, [])
  assert.equal(calls, 1)
  assert.equal(shared[0].to.xPx, 777)
  assert.equal(site.files.length, 2)
  for (const f of site.files) {
    assert.match(f.content, /translate:17px 0px/)
    assert.doesNotMatch(f.content, /translate:777px/)
  }
})

test('a declared tier-2 preset retains that floor after projection and copying', () => {
  const reg = core.createRegistry()
  reg.use(plugin(def({ tier: 2 })))
  const m: Motion = { trigger: 'load', effect: 'lift' }
  assert.equal(core.lowerMotion(m, reg).tier, 2)
  const d = doc(m)
  const r = core.compilePage(d, 'home', { registry: reg })
  delete d.pages[0].root.children![0].motion
  const plain = core.compilePage(d, 'home', { registry: reg })
  assert.ok(r.ok && plain.ok)
  assert.equal(r.css, plain.css)
})

test('detach of an id-bearing tier-2 load preset preserves host execution via host: true', () => {
  const reg = core.createRegistry()
  reg.use(plugin(def({ tier: 2, steps: () => [step({ id: 'title' })] })))
  const root = node('panel', 'box', [text('title', 'Title')])
  root.motion = { trigger: 'load', effect: 'lift' }
  const d = siteWith([{ ...node('use', 'instance'), component: 'panel' }], {
    components: [{ id: 'panel', name: 'Panel', props: [], variants: [], root }],
  })
  const r = plan(d, reg, {
    site: 's',
    key: 'k',
    baseRevision: 0,
    ops: [{ op: 'detach', tree: { page: 'home' }, id: 'use' }],
  })
  assert.ok(r.ok)
  assert.deepEqual(r.doc.pages[0].root.children![0].motion, {
    trigger: 'load',
    host: true,
    steps: [step({ id: 'n1' })],
  })
})
