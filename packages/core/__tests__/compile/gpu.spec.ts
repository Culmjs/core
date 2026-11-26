import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  BUDGETS,
  checkBudgets,
  compilePage,
  compileSite,
  compileSubtree,
  createRegistry,
  type CompileOptions,
  type CustomEffect,
  type Node,
  type SiteDocument,
} from '../../src/index.ts'
import { DEMO_PLUGIN, node, siteWith, text, twoPages } from '../kit.ts'
import { DomUtils, parseDocument } from 'htmlparser2'

const def: CustomEffect = {
  name: 'mist',
  source:
    '// </script> <heading> &\nvec4 shade(vec2 uv){return vec4(u_set_speed);}',
  settings: { speed: { type: 'number', min: 0, max: 1, default: 0.5 } },
}
const registry = createRegistry({
  gpu: { enabled: true, approvedWasmPlugins: [{ name: 'demo', version: 1 }] },
})
registry.use({
  ...DEMO_PLUGIN,
  effects: [
    {
      ...def,
      name: 'field',
      tier: 3,
      wasm: { abi: 'field-v1', bytesBase64: 'AAE=' },
    },
  ],
})
const owner = (id = 'hero', gpu = 'mist'): Node => ({
  ...node(id, 'box', [text(`${id}title`, 'Real heading')]),
  motion: { trigger: 'enter-view', gpu, poster: 'static.png' },
})
const repeated = () =>
  siteWith(
    [{ ...node('list', 'list', [owner()]), repeat: { source: 'projects' } }],
    { customEffects: [def] },
  )
const data = {
  rows: {
    projects: [
      { title: 'one', kind: 'book' },
      { title: 'two', kind: 'book' },
    ],
  },
}
function page(doc: SiteDocument, options: Partial<CompileOptions> = {}) {
  const p = compilePage(doc, 'home', { registry, data, ...options })
  assert.ok(p.ok, JSON.stringify(p.problems))
  assert.deepEqual(p.problems, [])
  return p
}
const hash = (s: string) =>
  `sha256-${createHash('sha256').update(s).digest('base64')}`
const policy = (html: string) =>
  html
    .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)![1]
    .replaceAll('&#39;', "'")
const payload = (html: string) =>
  JSON.parse(
    html.match(
      /<script type="application\/json" id="culm-gpu">([^<]*)<\/script>/,
    )![1],
  )

test('only registered contours has builtin identity; checked shaders can earn worker policy in main', () => {
  const doc = twoPages([owner('trusted', 'contours')], [owner('custom')], {
    customEffects: [def],
  })
  const trusted = page(doc)
  assert.equal(payload(trusted.html).definitions[0].builtin, 'contours-v1')
  assert.match(trusted.html, / data-gpu-run="1"/)
  assert.match(policy(trusted.html), /worker-src blob:/)
  assert.doesNotMatch(policy(trusted.html), /unsafe-/)
  assert.ok(
    registry.gpu?.isReviewed(registry.effect('contours') as CustomEffect),
  )
  const custom = page(repeated())
  assert.match(custom.html, / data-gpu-run="custom"/)
  assert.equal(payload(custom.html).definitions[0].reviewed, undefined)
  assert.match(policy(custom.html), /worker-src blob:/)
  const stripOnly = siteWith()
  stripOnly.header.children = [owner('strip', 'contours')]
  assert.match(policy(page(stripOnly).html), /worker-src 'none'/)
  const deployed = compileSite(doc, { registry })
  assert.deepEqual(deployed.problems, [])
  for (const f of deployed.files.filter(f => f.path.endsWith('.html')))
    assert.match(policy(f.content), /worker-src blob:/)
  const copy = page(doc, {
    registry: {
      ...registry,
      effects: () => registry.effects().map(e => ({ ...e })),
    },
  })
  assert.equal(payload(copy.html).definitions[0].builtin, undefined)
  assert.equal(payload(copy.html).definitions[0].reviewed, true)
  assert.match(copy.html, / data-gpu-run="custom"/)
  assert.match(policy(copy.html), /worker-src blob:/)
})

test('two rendered copies share one checked definition and fixed lazy asset; JSON round trips', () => {
  const p = page(repeated())
  const tokens = [...p.html.matchAll(/data-culm-gpu="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(tokens).size, 2)
  const { definitions, regions } = payload(p.html)
  assert.deepEqual(definitions, [def])
  assert.deepEqual(
    regions,
    tokens.map(owner => ({
      owner,
      definition: 0,
      settings: { set_speed: [0.5] },
      poster: 'static.png',
    })),
  )
  assert.deepEqual(
    p.scripts.map(s => s.name),
    ['base', 'gpuLoader'],
  )
  assert.equal(p.assets?.length, 1)
  const [host] = p.assets!
  assert.equal(host.path, '_culm/gpu.js')
  assert.ok(p.scripts[1].code.includes(hash(host.content)))
  assert.deepEqual(p.gpu, { usesWasm: false })
  assert.equal(p.stats.scriptBytes.gpuHost, Buffer.byteLength(host.content))
  assert.equal(
    p.stats.scriptBytes.gpuLoader,
    Buffer.byteLength(p.scripts[1].code) + 1,
  )
  assert.equal(
    Object.values(p.stats.scriptBytes).reduce((a, b) => a + b, 0),
    Buffer.byteLength(p.scripts.map(s => s.code).join(';') + host.content),
  )
  assert.deepEqual(p.stats.gpuData, {
    shaderBytes: Buffer.byteLength(def.source),
    wasmBytes: 0,
    wasmTransportBytes: 0,
  })
  const measure = page(repeated(), { mode: 'measure' })
  assert.deepEqual(payload(measure.html), payload(p.html))
  assert.match(measure.html, /data-id="hero~\d+"/)
})

test('plain, zero rows, dropped samples, edit, subtree and unpublished pages keep only fallback', () => {
  const sample = owner()
  // The conditional sample can drop its wrapper (the heading is unedited block chrome).
  sample.children![0].props!.chrome = true
  sample.children!.push({
    ...text('sample', ''),
    props: { sample: true, runs: [{ text: 'Example' }] },
    showIf: { from: 'item', field: 'title' },
  })
  const dropped = repeated()
  dropped.pages[0].root.children![0].children = [sample]
  for (const p of [
    page(siteWith()),
    page(repeated(), { data: { rows: { projects: [] } } }),
    page(dropped),
  ]) {
    assert.deepEqual(
      p.scripts.map(s => s.name),
      ['base'],
    )
    assert.equal(p.assets?.length ?? 0, 0)
    assert.equal(p.stats.gpuData, undefined)
    assert.doesNotMatch(
      p.html,
      /data-culm-gpu|_culm\/gpu\.js|application\/json/,
    )
  }
  assert.deepEqual(page(repeated(), { mode: 'edit' }).scripts, [])
  const sub = compileSubtree(repeated(), 'home', 'hero', { registry, data })
  assert.ok(sub.ok)
  assert.match(sub.html, /Real heading/)
  assert.doesNotMatch(sub.html, /culm-gpu|<script/)
  const doc = twoPages([], [owner()], { customEffects: [def] })
  doc.pages[1].on = false
  const off = compilePage(doc, 'about', { registry })
  assert.ok(off.ok)
  assert.equal(off.assets, undefined)
  const site = compileSite(doc, { registry })
  assert.deepEqual(site.problems, [])
  assert.deepEqual(
    site.files.map(f => f.path),
    ['index.html', '_headers'],
  )
  assert.match(policy(site.files[0].content), /worker-src 'none'/)
})

test('one host manifest entry across using pages; site policy is the union of actual executable bytes', () => {
  const doc = twoPages([owner('hero', 'field')], [owner('other')], {
    customEffects: [def],
  })
  doc.pages.push({
    ...doc.pages[1],
    id: 'plain',
    slug: '/plain',
    root: node('plainroot', 'box'),
  })
  const p = page(doc)
  assert.deepEqual(p.gpu, { usesWasm: true })
  assert.doesNotMatch(p.html, / data-gpu-run=/)
  assert.match(policy(p.html), /worker-src 'none'/)
  assert.deepEqual(payload(p.html).definitions[0].wasm, {
    abi: 'field-v1',
    bytesBase64: 'AAE=',
  })
  assert.deepEqual(p.stats.gpuData, {
    shaderBytes: Buffer.byteLength(def.source),
    wasmBytes: 2,
    wasmTransportBytes: 4,
  })
  const site = compileSite(doc, { registry })
  assert.deepEqual(site.problems, [])
  assert.deepEqual(
    site.files.map(f => f.path),
    [
      'index.html',
      'about/index.html',
      'plain/index.html',
      '_culm/gpu.js',
      '_headers',
    ],
  )
  const host = site.files[3]
  assert.deepEqual(
    site.manifest.scripts.find(s => s.name === 'gpuHost'),
    {
      name: 'gpuHost',
      bytes: Buffer.byteLength(host.content),
      pages: ['home', 'about'],
    },
  )
  assert.deepEqual(site.manifest.gpuData, [
    { page: 'home', ...p.stats.gpuData },
    {
      page: 'about',
      shaderBytes: Buffer.byteLength(def.source),
      wasmBytes: 0,
      wasmTransportBytes: 0,
    },
  ])
  const pages = site.files.slice(0, 3)
  const csp = policy(pages[0].content)
  assert.deepEqual(
    new Set(csp.match(/sha256-[A-Za-z0-9+/=]+/g)),
    new Set([
      hash(host.content),
      ...pages.map(f => hash(f.content.match(/<script>(.*?)<\/script>/s)![1])),
    ]),
  )
  for (const f of pages) assert.equal(policy(f.content), csp)
  assert.equal(site.files[4].content, `/*\n  Content-Security-Policy: ${csp}\n`)
  assert.doesNotMatch(csp, /unsafe-|'self'/)
  assert.notEqual(policy(p.html), csp)
})

test('a rendered owner can lose its last visible descendant during data/sample and file resolution', () => {
  const doc = repeated()
  const hero = doc.pages[0].root.children![0].children![0]
  hero.children![0].props!.chrome = true
  hero.children = [
    node('wrapper', 'box', [
      ...hero.children!,
      {
        ...text('sample', ''),
        props: { sample: true, runs: [{ text: 'Example' }] },
        showIf: { from: 'item', field: 'title' },
      },
    ]),
    { ...node('image', 'image'), props: { assetId: 'unresolved' } },
  ]
  const p = page(doc, {
    mode: 'measure',
    links: {
      page: s => s,
      file: id => (id === 'static.png' ? '/local/confirmed.png' : undefined),
    },
  })
  assert.match(p.html, /data-id="hero~\d+"/)
  assert.match(p.html, /\/local\/confirmed.png/)
  assert.doesNotMatch(p.html, /Real heading|data-culm-gpu|application\/json/)
  assert.equal(p.assets, undefined)
})

test('host and joined shared limits are inclusive; shader and module bytes are not JS', () => {
  assert.deepEqual(
    [BUDGETS.gpuHostScript, BUDGETS.wasmBytes, BUDGETS.wasmTransportBytes],
    [9012, 512, 684],
  )
  const p = page(siteWith())
  const findings = (gpuHost: number, gpuLoader: number) =>
    checkBudgets({
      ...p.stats,
      scriptBytes: { base: 10000, states: 982, gpuLoader, gpuHost },
    }).map(p => p.path)
  assert.deepEqual(findings(9012, 6), [])
  assert.deepEqual(findings(9013, 5), ['gpuHostScript'])
  assert.deepEqual(findings(9012, 7), ['sharedScripts'])
})

test('an explicit local poster belongs to the emitted owner even without a runnable leaf', () => {
  const hero = owner('hero', 'contours')
  hero.children = [
    { ...node('opt', 'image'), props: { src: '/unconfirmed.png', alt: '' } },
  ]
  hero.style = { base: { bgImage: 'ordinary' } }
  const doc = siteWith([hero])
  const links = {
    page: (v: string) => v,
    file: (v: string) =>
      v === 'static.png'
        ? '/local/p%23.png?v=1#image'
        : v === 'ordinary'
          ? '/local/bg.png'
          : undefined,
  }
  for (const mode of ['live', 'edit'] as const) {
    const p = page(doc, { links, mode })
    assert.match(p.html, /\/local\/p%23\.png\?v=1#image/)
    assert.match(p.css, /\/local\/bg.png/)
    assert.equal(p.assets, undefined)
  }
  const sub = compileSubtree(doc, 'home', 'hero', { registry, links })
  assert.ok(sub.ok)
  assert.match(sub.html + sub.css, /\/local\/p%23\.png\?v=1#image/)
  for (const url of [
    '//elsewhere.invalid/p.png',
    'https://elsewhere.invalid/p.png',
  ]) {
    const p = page(doc, {
      links: { ...links, file: id => (id === 'static.png' ? url : undefined) },
    })
    assert.doesNotMatch(p.html, /elsewhere/)
  }
})

test('exact 1,999 and 2,000 body-element boundaries include the live canvas reservation', () => {
  const doc = siteWith([owner('hero', 'contours')])
  const count = (html: string) =>
    DomUtils.getElementsByTagName(
      '*',
      DomUtils.getElementsByTagName('body', parseDocument(html))[0].children,
    ).length
  const small = page(doc)
  const kids = doc.pages[0].root.children!
  for (let i = count(small.html); i < 1999; i++)
    kids.push(node(`fill${i}`, 'box'))
  const fits = page(doc)
  assert.equal(count(fits.html), 1999)
  assert.match(policy(fits.html), /worker-src blob:/)
  assert.equal(fits.stats.elements, 2000)
  // Replacing two boxes by this SVG + its two path elements costs a net +1.
  const glyph = siteWith([
    ...kids.slice(0, -2),
    { ...node('glyph', 'icon'), props: { name: 'home' } },
  ])
  const withGlyph = page(glyph)
  assert.match(policy(withGlyph.html), /worker-src 'none'/)
  assert.equal(count(withGlyph.html), withGlyph.stats.elements)
  kids.push(node('onemore', 'box'))
  const full = page(doc)
  assert.match(policy(full.html), /worker-src 'none'/)
  assert.equal(full.assets, undefined)
  assert.equal(full.stats.elements, count(full.html))
  delete kids[0].motion
  kids.push(node('plainonly', 'box'))
  const plain = page(doc)
  assert.equal(count(plain.html), 2000)
  assert.equal(plain.stats.elements, 2000)
})

test('a contours + pin page budgets the final pin measurement nodes before granting its canvas', () => {
  const pin = node('pin', 'box', [text('visual', 'Pinned title')])
  pin.motion = { trigger: 'scroll', pinPx: 500, effect: 'rise' }
  const gpu = owner('hero', 'contours')
  const fill = node('fill', 'column', [])
  const doc = siteWith([pin, gpu, fill])
  const parsed = (html: string) =>
    DomUtils.getElementsByTagName(
      '*',
      DomUtils.getElementsByTagName('body', parseDocument(html))[0].children,
    )
  const small = page(doc)
  assert.ok(
    parsed(small.html).filter(e => e.name === 'svg' && e.attribs.width === '0')
      .length >= 2,
    'pin really adds measurement elements',
  )
  for (let i = parsed(small.html).length; i < 1999; i++)
    fill.children!.push(node(`n${i}`, 'box'))
  for (const n of [1999, 2000, 2001, 2002]) {
    if (n > 1999) fill.children!.push(node(`more${n}`, 'box'))
    const p = compilePage(doc, 'home', { registry })
    assert.ok(p.ok)
    const count = parsed(p.html).length
    const active = n === 1999
    assert.equal(count, active ? n : n - 1)
    assert.equal(p.stats.elements, count + Number(active))
    assert.equal(!!p.assets, active)
    assert.equal(policy(p.html).includes('worker-src blob:'), active)
    assert.deepEqual(
      p.problems.map(x => x.path),
      n === 2002 ? ['elements'] : [],
    )
  }
  delete gpu.motion
  const motionOnly = compilePage(doc, 'home', { registry })
  assert.ok(motionOnly.ok)
  assert.equal(motionOnly.stats.elements, parsed(motionOnly.html).length)
  assert.deepEqual(
    motionOnly.problems.map(x => x.path),
    ['elements'],
  )
  delete pin.motion
  const plain = page(doc)
  assert.equal(plain.stats.elements, parsed(plain.html).length)
})

test('an inventory-confirmed poster overrides the ordinary image; a known-missing poster does not', () => {
  const hero = owner('hero', 'contours')
  hero.style = { base: { bgImage: 'ordinary' } }
  const doc = siteWith([hero])
  const url = '/local/selected%3f%23.png?v=3#picture'
  const links = {
    page: (s: string) => s,
    file: (s: string) => (s === 'static.png' ? url : '/local/base.png'),
  }
  for (const [availableMedia, expected] of [
    [new Set(['/local/base.png']), false],
    [new Set(['/local/base.png', '/local/selected%3F%23.png']), true],
    [undefined, true],
  ] as const) {
    for (const mode of ['live', 'measure', 'edit'] as const) {
      const p = page(doc, { mode, links, availableMedia })
      assert.equal(p.html.includes(url), expected, mode)
      assert.match(p.css, /\/local\/base.png/)
    }
    const sub = compileSubtree(doc, 'home', 'hero', {
      registry,
      links,
      availableMedia,
    })
    assert.ok(sub.ok)
    assert.equal(sub.html.includes(url), expected, 'subtree')
    assert.match(sub.css, /\/local\/base.png/)
  }
})

const hideWhen = (...values: string[]) => ({
  when: values.map(is => ({ state: 'panel', is, decl: { hidden: true } })),
})
for (const scenario of ['never', 'exclusive', 'reachable'] as const)
  test(`GPU visibility requires a common declared state across the rendered branch: ${scenario}`, () => {
    const hero = owner()
    const caption = hero.children![0]
    const wrap = node('section', 'box', [hero])
    const doc = siteWith([wrap], { customEffects: [def] })
    doc.header.state = [{ name: 'panel', values: 'on-off', initial: 'off' }]
    // The header may have no emitted strip; its state lives on .s-site.
    if (scenario !== 'never') wrap.style = hideWhen('off')
    caption.style = hideWhen(
      ...(scenario === 'never'
        ? ['on', 'off']
        : scenario === 'exclusive'
          ? ['on']
          : ['off']),
    )
    const p = page(doc)
    assert.equal(!!p.gpu, scenario === 'reachable')
    assert.match(p.html, /Real heading/)
  })

test('an optional file address is not proof of bytes; a rendered labelled icon link is content', () => {
  const doc = repeated()
  const hero = doc.pages[0].root.children![0].children![0]
  hero.children![0].props!.chrome = true
  const optional = node('opt', 'image')
  hero.children = [
    node('wrapper', 'box', [
      ...hero.children!,
      {
        ...text('sample', ''),
        props: { sample: true, runs: [{ text: 'Example' }] },
        showIf: { from: 'item', field: 'title' },
      },
    ]),
    optional,
  ]
  optional.props = { assetId: 'optional.jpg', alt: '' }
  const links = {
    page: (s: string) => s,
    file: (id: string) => '/assets/' + id,
  }
  const absent = page(doc, { links })
  assert.match(absent.html, /src="\/assets\/optional.jpg"/)
  assert.equal(absent.gpu, undefined)
  assert.ok(
    page(doc, { links, availableMedia: new Set(['/assets/optional.jpg']) }).gpu,
  )
  optional.props = { src: 'https://example.invalid/photo.jpg', alt: '' }
  assert.equal(page(doc, { links }).gpu, undefined)
  optional.kind = 'icon'
  optional.props = { name: 'home', label: 'Home', link: { page: '/' } }
  const icon = page(doc, { links })
  assert.match(icon.html, /aria-label="Home"><svg/)
  assert.ok(icon.gpu)
  optional.props.name = 'missing:home'
  assert.equal(page(doc, { links }).gpu, undefined)
})

test('only the local image pathname witnesses a region; suffixes and encoded delimiters retain their meanings', () => {
  const hero = owner()
  const image = node('poster', 'image')
  hero.children = [image]
  const doc = siteWith([hero], { customEffects: [def] })
  const availableMedia = new Set([
    '/assets/cover.jpg',
    '/assets/note%3F%23%25.jpg',
  ])
  for (const [src, expected] of [
    ['/assets/cover.jpg?v=2', true],
    ['/assets/cover.jpg#detail', true],
    ['/assets/note%3F%23%25.jpg?v=2#detail', true],
    ['/assets/note%3f%23%25.jpg#detail', true],
    ['/assets/note?%23%25.jpg', false],
    ['/assets/cover.jpg%23detail', false],
    ['https://example.invalid/assets/cover.jpg?v=2', false],
  ] as const) {
    image.props = { src, alt: '' }
    const p = page(doc, { availableMedia })
    assert.ok(p.html.includes(`src="${src}"`), src)
    assert.equal(!!p.gpu, expected, src)
  }
})

const registryWithModule = (wasm: unknown) => ({
  ...registry,
  effects: () =>
    registry
      .effects()
      .map(e =>
        e.tier === 3 && e.name === 'field'
          ? { ...e, wasm: wasm as typeof e.wasm }
          : e,
      ),
})
test('every build refuses a malformed or oversized module view before emitting files', () => {
  const doc = siteWith([owner('hero', 'field')])
  for (const wasm of [
    null,
    { abi: 'other', bytesBase64: 'AA==' },
    { abi: 'field-v1', bytesBase64: 'A'.repeat(684) },
    { abi: 'field-v1', bytesBase64: 'A'.repeat(688) },
  ]) {
    const site = compileSite(doc, { registry: registryWithModule(wasm) })
    assert.deepEqual(
      site.files.map(f => f.path),
      [],
    )
    assert.ok(
      site.problems.some(
        p =>
          p.code === 'INVALID_DOCUMENT' &&
          p.path === 'registry.effects.field.wasm',
      ),
    )
  }
})
test('the checked module envelope is a snapshot: read its values just once per build', () => {
  let reads = 0
  const first = 'A'.repeat(683) + '='
  const p = page(siteWith([owner('hero', 'field')]), {
    registry: registryWithModule({
      abi: 'field-v1',
      get bytesBase64() {
        return reads++ === 0 ? first : 'AA=='
      },
    }),
  })
  assert.equal(reads, 1)
  assert.equal(payload(p.html).definitions[0].wasm.bytesBase64, first)
  assert.equal(p.stats.gpuData?.wasmBytes, 512)
})
