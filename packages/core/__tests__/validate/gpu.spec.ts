import assert from 'node:assert/strict'
import test from 'node:test'
import {
  catalogue,
  compilePage,
  compileSite,
  compileSubtree,
  createRegistry,
  plan,
  validateSite,
  type CustomEffect,
  type GpuEffectDef,
  type Motion,
  type SiteDocument,
} from '../../src/index.ts'
import { DEMO_PLUGIN, node, siteWith, text, twoPages } from '../kit.ts'

const enabled = () => createRegistry({ gpu: { enabled: true } })
const mist = (): CustomEffect => ({
  name: 'mist',
  source: 'vec4 shade(vec2 uv){return vec4(u_set_tint,u_set_speed);}',
  settings: {
    speed: { type: 'number', min: 0, max: 1, default: 0.5 },
    tint: { type: 'color', default: '#abcdef' },
  },
})
const attachment = { trigger: 'enter-view', gpu: 'mist' } as const
const owner = () => node('hero', 'column', [text('title', 'Real heading')])
const site = (w = owner(), m: unknown = attachment) =>
  siteWith([{ ...w, motion: m as Motion }], { customEffects: [mist()] })
const at = (d: SiteDocument, path: string, id?: string) => {
  const problems = validateSite(d, enabled())
  assert.ok(
    problems.some(p => p.path === path && p.nodeId === id),
    JSON.stringify(problems),
  )
}

test('GPU references are per site, gated by the registry, and preserve the static block', () => {
  const d = site(owner(), {
    ...attachment,
    settings: { speed: 1, tint: '#AA0033' },
    poster: 'hero-poster.webp',
  })
  const reg = enabled()
  assert.deepEqual(validateSite(d, reg), [])
  assert.ok(
    validateSite(d, createRegistry()).some(
      p => p.code === 'UNSUPPORTED_CAPABILITY',
    ),
  )
  const other = structuredClone(d)
  delete other.customEffects
  assert.ok(
    validateSite(other, reg).some(
      p => p.path === 'motion.gpu' && p.nodeId === 'hero',
    ),
  )
  assert.equal(reg.effect('mist'), undefined)
  assert.deepEqual(
    reg.effects().map(e => e.name),
    ['rise', 'contours'],
  )
  const plain = siteWith([owner()])
  const planeCss =
    'main:has(>.culm-plane:not([hidden])){isolation:isolate}.culm-plane{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;image-rendering:pixelated}:where([data-gpu-painted],[data-gpu-probe])>:where(:not([data-gpu-raised],:has([data-gpu-raised]))),:where([data-gpu-painted],[data-gpu-probe]) :where(:has([data-gpu-raised]))>:where(:not([data-gpu-raised],:has([data-gpu-raised]))){position:relative;z-index:1}'
  for (const mode of ['edit', 'live', 'measure'] as const) {
    const opts = { mode, registry: reg }
    const result = compilePage(d, 'home', opts)
    assert.ok(result.ok, JSON.stringify(result.problems))
    const fallback = compilePage(plain, 'home', opts)
    assert.ok(fallback.ok)
    if (mode === 'edit') assert.deepEqual(result, fallback)
    else {
      assert.ok(result.css.includes(planeCss))
      assert.equal(result.css.replace(planeCss, ''), fallback.css)
      assert.equal(
        result.html
          .split('<body>')[1]
          .split('<script')[0]
          .replace(' data-culm-gpu="0" data-gpu-run="custom"', '')
          .replace(' data-gpu-content="t"', ''),
        fallback.html.split('<body>')[1].split('<script')[0],
      )
    }
  }
  assert.deepEqual(
    compileSubtree(d, 'home', 'hero', { registry: reg }),
    compileSubtree(plain, 'home', 'hero', { registry: reg }),
  )
  // With a CSS or timeline program present the renderer actually enters motionCss.
  for (const trigger of ['load', 'enter-view'] as const) {
    for (const doc of [plain, d])
      doc.pages[0].root.children![0].children![0].motion = {
        trigger,
        effect: 'rise',
      }
    const compiled = compilePage(d, 'home', { registry: reg })
    assert.ok(compiled.ok, JSON.stringify(compiled.problems))
    const fallback = compilePage(plain, 'home', { registry: reg })
    assert.ok(fallback.ok)
    assert.ok(compiled.css.includes(planeCss))
    assert.equal(compiled.css.replace(planeCss, ''), fallback.css)
    assert.deepEqual(
      compiled.scripts.filter(s => s.name !== 'gpuLoader'),
      fallback.scripts,
    )
  }
})

test('recheck unused definitions every time, preserving shader vs folder line and measured work', () => {
  const d = siteWith([], { customEffects: [mist()] })
  const reg = enabled()
  assert.deepEqual(validateSite(d, reg), [])
  d.customEffects![0].source =
    'vec4 shade(vec2 uv){\nfor(int i=0;i<65;i++){}\nreturn vec4(1.0);}'
  for (const problems of [
    validateSite(d, reg),
    compilePage(d, 'home', { registry: reg }).problems,
  ]) {
    const p = problems.find(p => p.path === 'customEffects.0.source')
    assert.ok(p)
    assert.deepEqual(
      [p.rule, p.shaderLine, p.measured, p.limit],
      ['shader.passes', 2, 65, 64],
    )
    assert.ok(!('line' in p))
  }
})

test('registered shader source is checked once per build, whether used twice or not used', () => {
  const host = enabled()
  host.use({
    ...DEMO_PLUGIN,
    effects: ['mist', 'spare'].map(name => ({ ...mist(), tier: 3, name })),
  })
  const reads: string[] = []
  let overBudget = false
  // Observe the registry's build-time view without modifying its frozen registrations.
  const registry = {
    ...host,
    effects: () =>
      host.effects().map(d =>
        d.tier === 3
          ? {
              ...d,
              get source() {
                reads.push(d.name)
                return d.name === 'spare' && overBudget
                  ? 'vec4 shade(vec2 uv){\nfor(int i=0;i<65;i++){}\nreturn vec4(1.0);}'
                  : '// checked build view\n' + d.source
              },
            }
          : {
              ...d,
              steps: () => assert.fail('An unused step factory must not run.'),
            },
      ),
  }
  const doc = twoPages(
    [{ ...owner(), motion: attachment }],
    [{ ...node('second', 'box', [text('copy', 'More')]), motion: attachment }],
  )
  const build = () => compileSite(doc, { registry })
  const good = build()
  assert.deepEqual(good.problems, [])
  assert.equal(good.manifest.pages.length, 2)
  for (const page of good.manifest.pages)
    assert.ok(
      good.files
        .find(f => f.path === page.path)!
        .content.includes('// checked build view\\n'),
    )
  assert.deepEqual(reads, ['contours', 'mist', 'spare'])
  reads.length = 0
  overBudget = true
  const refused = build()
  assert.deepEqual(refused.files, [])
  assert.deepEqual(reads, ['contours', 'mist', 'spare'])
  assert.equal(refused.problems.length, 1)
  const [p] = refused.problems
  assert.deepEqual(
    [p.path, p.rule, p.shaderLine, p.measured, p.limit],
    ['registry.effects.spare.source', 'shader.passes', 2, 65, 64],
  )
  assert.ok(!('line' in p))
})

test('closed, uniquely named definitions; declaration limits and values come from the checker', () => {
  const d = site()
  for (const name of [
    'rise',
    'Bad',
    'two-part',
    'prototype',
    'constructor',
    'x'.repeat(33),
  ]) {
    d.customEffects![0].name = name
    at(d, 'customEffects.0.name')
  }
  d.customEffects = [mist(), mist()]
  at(d, 'customEffects.1.name')
  d.customEffects = Array.from({ length: 32 }, (_, i) => ({
    ...mist(),
    name: `mist${i}`,
  }))
  delete d.pages[0].root.children![0].motion
  assert.deepEqual(validateSite(d, enabled()), [])
  d.customEffects.push(mist())
  at(d, 'customEffects')
  for (const key of ['wasm', 'checked', 'reviewed', 'tier']) {
    d.customEffects = [{ ...mist(), [key]: true }]
    at(d, `customEffects.0.${key}`)
  }
  for (const extra of [
    { type: 'color', default: '#abc' },
    { type: 'number', min: 0, max: 1, default: Infinity },
    { type: 'number', min: 2, max: 1, default: 1 },
  ] as const) {
    d.customEffects = [mist()]
    d.customEffects[0].settings.extra = extra
    at(d, 'customEffects.0.settings')
  }
})

test('GPU attachment options, poster and overrides form one distinct closed arm', () => {
  for (const [key, value] of Object.entries({
    effect: 'rise',
    steps: [],
    pinPx: 100,
    scrollFallback: 'timeline',
    trigger: 'load',
    gpu: 'rise',
    checked: true,
    reviewed: true,
    wasm: {},
  }))
    at(site(owner(), { ...attachment, [key]: value }), `motion.${key}`, 'hero')
  for (const poster of [
    '../poster.png',
    '/p',
    'https://s.test/p.png',
    '//host/p',
    'a\\b',
    '%2e%2e%2fasset',
    '',
    null,
  ])
    at(site(owner(), { ...attachment, poster }), 'motion.poster', 'hero')
  for (const settings of [null, [], new Map([['speed', -1]])])
    at(site(owner(), { ...attachment, settings }), 'motion.settings', 'hero')
  for (const [key, value] of [
    ['speed', NaN],
    ['speed', 1.1],
    ['other', 0],
    ['constructor', 1],
    ['tint', '#00a'],
    ['tint', 1],
  ])
    at(
      site(owner(), { ...attachment, settings: { [key]: value } }),
      `motion.settings.${key}`,
      'hero',
    )
})

test('only a content-bearing layout outside forms, including the filled slot and the effective master', () => {
  for (const w of [
    text('hero', 'Not a container'),
    node('hero', 'column'),
    node('hero', 'column', [node('nested', 'box', [text('empty', '  ')])]),
    node('hero', 'column', [
      text('sample', 'Sample', {
        props: { sample: true, runs: [{ text: 'Sample' }] },
      }),
    ]),
    node('hero', 'column', [node('image', 'image')]),
    node('hero', 'column', [
      text('hidden', 'Hidden', { style: { base: { hidden: true } } }),
    ]),
  ])
    at(site(w), 'motion.gpu', 'hero')
  const d = site()
  const hero = d.pages[0].root.children![0]
  d.pages[0].root.children = [node('form', 'form', [hero])]
  at(d, 'motion.gpu', 'hero')

  const part = { ...owner(), motion: attachment }
  const root = node('shell', 'box', [part])
  d.components = [
    {
      id: 'card',
      name: 'Card',
      root,
      variants: [],
      props: [{ type: 'slot', key: 'body', label: 'Body', part: 'hero' }],
    },
  ]
  const use = {
    ...node('use', 'instance', [text('slotted', 'More')]),
    component: 'card',
  }
  d.pages[0].root.children = [use]
  assert.deepEqual(validateSite(d, enabled()), [])
  use.children = [node('form', 'form')]
  at(d, 'parts.hero.motion.gpu', 'use')
  use.children = []
  d.pages[0].root.children = [node('form', 'form', [use])]
  at(d, 'parts.hero.motion.gpu', 'use')
})

test('setMotion and detach preserve the site reference and settings, on instance or master', () => {
  const reg = enabled()
  const m: Motion = {
    ...attachment,
    settings: { speed: 0.1 },
    poster: 'static.png',
  }
  for (const onMaster of [false, true]) {
    const d = siteWith([{ ...node('use', 'instance'), component: 'card' }], {
      customEffects: [mist()],
      components: [
        { id: 'card', name: 'Card', props: [], variants: [], root: owner() },
      ],
    })
    const r = plan(d, reg, {
      site: 's',
      key: 'k',
      baseRevision: 0,
      ops: [
        {
          op: 'setMotion',
          tree: onMaster ? { component: 'card' } : { page: 'home' },
          id: onMaster ? 'hero' : 'use',
          motion: m,
        },
        { op: 'detach', tree: { page: 'home' }, id: 'use' },
      ],
    })
    assert.ok(r.ok, JSON.stringify(r))
    assert.deepEqual(r.doc.pages[0].root.children![0].motion, m)
    assert.ok(compilePage(r.doc, 'home', { registry: reg, mode: 'measure' }).ok)
  }
})

test('the static fallback survives absent data, and decorative or invisible runs alone do not count', () => {
  const ref = { from: 'site', field: 'title' } as const
  for (const child of [
    text('hide', 'Maybe', { showIf: ref }),
    text('blank', '\u200b'),
    text('math', '', { props: { runs: [{ math: '<math></math>' }] } }),
    text('value', '', {
      props: { runs: [{ text: 'Replaced by binding', bind: ref }] },
    }),
  ])
    at(site(node('hero', 'column', [child])), 'motion.gpu', 'hero')
  const drawing = {
    ...node('art', 'shape'),
    props: { geometry: { type: 'ellipse' as const }, label: 'Marker' },
  }
  assert.deepEqual(
    validateSite(site(node('hero', 'column', [drawing])), enabled()),
    [],
  )
})

test('fallback covers every visible owner layout, including complementary witnesses', () => {
  const d = site()
  const hero = d.pages[0].root.children![0]
  hero.children![0].hide = { phone: true }
  at(d, 'motion.gpu', 'hero')
  hero.hide = { phone: true }
  assert.deepEqual(validateSite(d, enabled()), [])
  delete hero.hide
  hero.children!.push(
    text('small', 'Phone heading', {
      style: { base: { hidden: true }, phone: { hidden: false } },
    }),
  )
  assert.deepEqual(validateSite(d, enabled()), [])
})

test('light content cannot supply the dark scheme fallback on an automatic site', () => {
  const d = site()
  const hero = d.pages[0].root.children![0]
  hero.children![0].style = { dark: { hidden: true } }
  d.look = { ...d.look, dark: 'auto' }
  at(d, 'motion.gpu', 'hero')
  hero.style = { dark: { hidden: true } }
  assert.deepEqual(validateSite(d, enabled()), [])
  delete hero.style
  hero.children!.push(
    text('night', 'Dark heading', {
      style: { base: { hidden: true }, dark: { hidden: false } },
    }),
  )
  assert.deepEqual(validateSite(d, enabled()), [])
})

for (const kind of ['image', 'video', 'icon'] as const)
  test(`a resolver-dependent ${kind} needs independent static content`, () => {
    const child = node('media', kind)
    child.props =
      kind === 'icon'
        ? { name: 'unknown:missing', label: 'Home', link: { page: '/' } }
        : { assetId: 'missing' }
    const d = site(node('hero', 'box', [child]))
    at(d, 'motion.gpu', 'hero')
    if (kind === 'image') child.props.fallback = 'An authored fallback'
    else
      d.pages[0].root.children![0].children!.push(
        text('caption', 'An authored fallback'),
      )
    const page = compilePage(d, 'home', { registry: enabled() })
    assert.ok(page.ok, JSON.stringify(page.problems))
    assert.match(page.html, />An authored fallback</)
  })

const moduleDef = (): GpuEffectDef => ({
  ...mist(),
  tier: 3,
  wasm: { abi: 'field-v1', bytesBase64: 'AGFzbQEAAAA=' },
})
test('pure shader plugins need GPU capability; module envelopes have independent raw and encoded ceilings', () => {
  const shader = { ...mist(), tier: 3 as const }
  assert.throws(() =>
    createRegistry().use({ ...DEMO_PLUGIN, effects: [shader] }),
  )
  enabled().use({ ...DEMO_PLUGIN, effects: [shader] })
  const reg = createRegistry({
    gpu: { enabled: true, approvedWasmPlugins: [{ name: 'demo', version: 1 }] },
  })
  for (const wasm of [
    { abi: 'other', bytesBase64: 'AAAA' },
    { abi: 'field-v1', bytesBase64: 'not_base64' },
    { abi: 'field-v1', bytesBase64: 'A'.repeat(684) },
    { abi: 'field-v1', bytesBase64: 'A'.repeat(688) },
  ])
    assert.throws(() =>
      reg.use({
        ...DEMO_PLUGIN,
        effects: [{ ...shader, wasm } as GpuEffectDef],
      }),
    )
  assert.deepEqual(reg.plugins(), [])
  reg.use({
    ...DEMO_PLUGIN,
    effects: [
      {
        ...shader,
        wasm: { abi: 'field-v1', bytesBase64: 'A'.repeat(683) + '=' },
      },
    ],
  })
})

test('host and site consume the same source and JSON setting language', () => {
  class Settings {
    speed = mist().settings.speed
    tint = mist().settings.tint
  }
  for (const d of [
    {
      ...mist(),
      settings: new Settings() as unknown as CustomEffect['settings'],
    },
    { ...mist(), source: 'vec4 shade(vec2 uv){return texture(u_field,uv);}' },
  ]) {
    const reg = enabled()
    assert.throws(() =>
      reg.use({ ...DEMO_PLUGIN, effects: [{ ...d, tier: 3 }] }),
    )
    assert.throws(() =>
      createRegistry({ gpu: { enabled: true, reviewed: [d] } }),
    )
    assert.ok(
      validateSite(siteWith([], { customEffects: [d] }), reg).some(p =>
        p.rule?.startsWith('shader.'),
      ),
    )
  }
})

test('disabled attachments retain their owner diagnostic, including when the site has definitions', () => {
  const problems = validateSite(site(), createRegistry())
  assert.ok(
    problems.some(
      p =>
        p.code === 'UNSUPPORTED_CAPABILITY' &&
        p.path === 'motion.gpu' &&
        p.nodeId === 'hero',
    ),
  )
})
test('module registration is atomic and only the original host name/version pair has authority', () => {
  const d = moduleDef()
  const approval = { name: 'demo', version: 1 }
  const host = createRegistry({
    gpu: { enabled: true, approvedWasmPlugins: [approval], reviewed: [mist()] },
  })
  approval.version = 2
  const p = {
    ...DEMO_PLUGIN,
    effects: [d],
    gpu: { enabled: true, approvedWasmPlugins: [approval] },
    trust: 'in-page' as const,
  }
  for (const [reg, plugin] of [
    [enabled(), p],
    [createRegistry(), p],
    [host, { ...p, version: 2 }],
    [host, { ...p, name: 'someone' }],
  ] as const) {
    assert.throws(() => reg.use(plugin))
    assert.deepEqual(reg.plugins(), [])
    assert.equal(reg.block('demo'), undefined)
    assert.equal(reg.effect('mist'), undefined)
  }
  host.use(p)
  const saved = host.effect('mist')
  assert.ok(saved?.tier === 3)
  d.source = 'changed'
  d.settings.tint.default = '#000000'
  d.wasm!.bytesBase64 = ''
  assert.deepEqual(saved, moduleDef())
  assert.equal(host.gpu?.isReviewed(saved), true)
  assert.ok(Object.isFrozen(saved.wasm) && Object.isFrozen(saved.settings.tint))
  const doc = site()
  assert.ok(
    validateSite(doc, host).some(p => p.path === 'customEffects.0.name'),
  )
  delete doc.customEffects
  assert.deepEqual(validateSite(doc, host), [])
  doc.pages[0].root.children![0].motion = { trigger: 'load', effect: 'mist' }
  assert.ok(validateSite(doc, host).some(p => p.path === 'motion.effect'))
  const detail = catalogue(host, { what: 'effects', id: 'mist' })
  assert.ok(detail.ok)
  const metadata = JSON.stringify(detail)
  assert.match(metadata, /"tier":3/)
  assert.match(metadata, /"type":"color"/)
  assert.match(metadata, /static/i)
  assert.doesNotMatch(metadata, /vec4|AGFzbQ|bytesBase64/)
})

test('review is an immutable match by declaration value; same name in another site grants nothing', () => {
  const reviewed = mist()
  const reg = createRegistry({ gpu: { enabled: true, reviewed: [reviewed] } })
  const a = site(),
    b = site()
  const original = a.customEffects![0]
  original.settings = {
    tint: original.settings.tint,
    speed: original.settings.speed,
  }
  reviewed.settings.tint.default = '#aaaaaa'
  assert.equal(reg.gpu?.isReviewed(original), true)
  const signedZero = mist()
  if (signedZero.settings.speed.type === 'number')
    signedZero.settings.speed.min = -0
  for (const changed of [
    { ...mist(), name: 'other' },
    { ...mist(), source: mist().source + '\n' },
    reviewed,
    signedZero,
    {
      ...mist(),
      settings: { ...mist().settings, extra: mist().settings.tint },
    },
  ])
    assert.equal(reg.gpu?.isReviewed(changed), false)
  b.customEffects![0].source += ' '
  assert.deepEqual(validateSite(a, reg), [])
  assert.deepEqual(validateSite(b, reg), [])
  assert.equal(reg.gpu?.isReviewed(b.customEffects![0]), false)
  assert.equal(reg.effect('mist'), undefined)
  const metadata = catalogue(reg, {
    what: 'effects',
    id: 'mist',
    site: { doc: a, revision: 3 },
  })
  assert.ok(metadata.ok)
  assert.doesNotMatch(JSON.stringify(metadata), /vec4|bytesBase64/)
  assert.equal(catalogue(reg, { what: 'effects', id: 'mist' }).ok, false)
})
