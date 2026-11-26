import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  compilePage,
  compileSubtree,
  type Motion,
  type Step,
  type CompileOptions,
  type Node,
  type HtmlNode,
} from '../../src/index.ts'
import { prepare, siteElement } from '../../src/compile/page.ts'
import { motionCss } from '../../src/compile/motion.ts'
import type { Scene } from '../../src/scripts/motionHost.ts'
import {
  PLAYBACK_TIMELINE_SCRIPT,
  TIMELINE_SCRIPT,
} from '../../src/scripts/scriptsMin.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'

test('both a grouped SVG owner and its nested target receive the scoped classes', () => {
  const bit = {
    ...node('bit', 'shape'),
    slot: { x: 1, y: 2, w: 30, h: 40 },
    props: { geometry: { type: 'ellipse' as const } },
  }
  const part = {
    ...node('part', 'shape', [bit]),
    slot: { x: 0, y: 0, w: 50, h: 50 },
    props: { geometry: { type: 'group' as const, combine: 'union' as const } },
    motion: {
      trigger: 'hover',
      steps: [{ ...rise(), target: { id: 'bit' } }],
    } satisfies Motion,
  }
  const group = {
    ...node('mark', 'shape', [part]),
    props: { geometry: { type: 'group' as const } },
  }
  const p = page(siteWith([group]))
  assert.match(p.html, /<svg x="0"[^>]*class="cm-o\d+"/)
  assert.match(p.html, /<svg x="1"[^>]*class="cm-t\d+"/)
  assert.deepEqual(
    p.scripts.map(s => s.name),
    ['base'],
  )
})

const registry = sampleRegistry()
const rise = (distance = 16): Step => ({
  target: 'self',
  from: { opacity: 0, yPx: distance },
  to: { opacity: 1, yPx: 0 },
  durationMs: 400,
  ease: 'ease-out',
})
const docFor = (motion?: Motion) =>
  siteWith([
    {
      ...node('hero', 'column', [text('title', 'Reed Ledger')]),
      ...(motion && { motion }),
    },
  ])
const page = (
  doc: ReturnType<typeof docFor>,
  mode?: CompileOptions['mode'],
) => {
  const p = compilePage(doc, 'home', { registry, mode })
  assert.ok(p.ok, JSON.stringify(p.problems))
  return p
}
const cssOnly = (trigger: Motion['trigger'], ...steps: Step[]) => {
  const p = page(docFor({ trigger, steps }))
  assert.deepEqual(
    p.scripts.map(s => s.name),
    ['base'],
  )
  assert.match(p.css, /prefers-reduced-motion:\s*no-preference/)
  assert.match(p.css, /@keyframes/)
  return p
}

test('the published plain page matches the captured c11f84f fixture byte for byte', () => {
  const plainBaselineHtml = readFileSync(
    new URL('./motion-plain.html.txt', import.meta.url),
    'utf8',
  )
  const meta =
    '<meta http-equiv="Content-Security-Policy" content="script-src &#39;sha256-iUY5Wv1bdMwf9jcnQARgZ1CVyfibEcYvjp28w14MH8A=&#39;; worker-src &#39;none&#39;; base-uri &#39;none&#39;; object-src &#39;none&#39;">'
  assert.equal(
    page(docFor()).html,
    plainBaselineHtml.replace(
      '<meta charset="utf-8">',
      `<meta charset="utf-8">${meta}`,
    ),
  )
})
test('load and keyboard-equivalent hover use finite gated CSS; a generic press needs keys', () => {
  assert.match(cssOnly('load', rise()).css, /400ms/)
  assert.match(cssOnly('hover', rise()).css, /:focus-visible/)
  assert.match(cssOnly('hover', rise()).css, /:hover/)
  assert.ok(
    page(docFor({ trigger: 'press', steps: [rise()] })).scripts.some(
      s => s.name === 'timeline',
    ),
  )
})
test('two steps share the target and the second delay follows the first duration', () => {
  const m: Motion = {
    trigger: 'load',
    steps: [rise(), { ...rise(40), delayMs: 40 }],
  }
  const doc = docFor(m)
  doc.pages[0].root.children![0].style = { base: { rotate: 15 } }
  const p = page(doc)
  assert.match(p.css, /transform:rotate\(15deg\)/)
  assert.match(p.css, /translate:/)
  assert.match(p.css, /440ms/)
  assert.deepEqual(
    p.scripts.map(s => s.name),
    ['base'],
  )
  assert.equal(page(doc).html, p.html)
})
test('native scroll, including the native branch of the compatibility option', () => {
  const nativeScroll = cssOnly('scroll', rise())
  assert.match(nativeScroll.css, /animation-timeline:\s*view\(\)/)
  assert.match(
    nativeScroll.css,
    /@supports\s*\(animation-timeline:\s*view\(\)\)/,
  )
  const compat = page(
    docFor({ trigger: 'scroll', scrollFallback: 'timeline', steps: [rise()] }),
  )
  assert.equal(compat.css, nativeScroll.css)
})

test('a native viewport track refuses an intervening scrollport; explicit fallback stays host-only', () => {
  for (const layer of ['base', 'phone'] as const) {
    const m: Motion = { trigger: 'scroll', steps: [rise()] }
    const owner = {
      ...node('hero', 'column', [text('title', 'Reed')]),
      motion: m,
    }
    const scroller = node('scroller', 'column', [owner])
    scroller.style = { [layer]: { overflow: 'scroll-x' } }
    const doc = siteWith([scroller])
    const r = compilePage(doc, 'home', { registry })
    assert.equal(r.ok, false)
    assert.ok(
      r.problems.some(
        p =>
          p.nodeId === 'hero' &&
          p.path === 'motion.trigger' &&
          /viewport/i.test(p.message) &&
          /scroller/.test(p.message),
      ),
      JSON.stringify(r.problems),
    )
    m.scrollFallback = 'timeline'
    assert.doesNotMatch(page(doc).css, /animation-timeline:view\(\)/)
    scroller.style = { [layer]: { overflow: 'clip' } }
    assert.match(page(doc).css, /animation-timeline:view\(\)/)
  }
})

test('a nested scrollport only blocks views in which a complete owner-to-target path is visible', () => {
  for (const hidden of [
    'owner',
    'scroller',
    'target',
    'wrapper',
    'ancestor',
  ] as const) {
    const target = text('title', 'Reed')
    const wrapper = node('wrapper', 'box', [target])
    const owner = node('hero', 'box', [wrapper])
    owner.motion = {
      trigger: 'scroll',
      steps: [{ ...rise(), target: { id: 'title' } }],
    }
    const scroller = node('scroller', 'column', [owner])
    scroller.style = {
      tablet: { overflow: 'scroll-x' },
      phone: { overflow: 'visible' },
    }
    const ancestor = node('ancestor', 'column', [scroller])
    const obscured = { owner, scroller, target, wrapper, ancestor }[hidden]
    obscured.style = {
      ...obscured.style,
      tablet: { ...obscured.style?.tablet, hidden: true },
      phone: { ...obscured.style?.phone, hidden: false },
    }
    const doc = siteWith([ancestor])
    assert.match(page(doc).css, /animation-timeline:--cm-v/)
    delete obscured.style.tablet!.hidden
    const bad = compilePage(doc, 'home', { registry })
    assert.ok(
      !bad.ok &&
        bad.problems.some(
          p => p.nodeId === 'hero' && p.path === 'motion.trigger',
        ),
    )
  }
})
test('a phone-hidden child cannot exempt its visible sibling from the scrollport refusal', () => {
  const first = text('first', 'Hidden', { hide: { phone: true } })
  const second = text('second', 'Visible')
  const owner = node('hero', 'box', [first, second])
  owner.motion = {
    trigger: 'scroll',
    steps: [{ ...rise(), target: 'children' }],
  }
  const scroller = node('scroller', 'column', [owner])
  scroller.style = { phone: { overflow: 'scroll-y' } }
  const doc = siteWith([scroller])
  assert.equal(compilePage(doc, 'home', { registry }).ok, false)
  second.hide = { phone: true }
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
  // A later state can show this child again on phone.
  owner.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  second.style = {
    when: [{ state: 'mode', is: 'on', decl: { hidden: false } }],
  }
  assert.equal(compilePage(doc, 'home', { registry }).ok, false)
})
test('native fallback membership is per rendered owner, including when a scrollport is layout-dependent', () => {
  const m: Motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [rise()],
  }
  const track = (id: string) => text(id, 'Reed', { motion: m })
  const hidden = track('onlydesktop')
  hidden.hide = { tablet: true, phone: true }
  const inside = node('scroller', 'column', [track('inside'), hidden])
  inside.style = { tablet: { overflow: 'scroll-y' } }
  const dark = node('dark', 'box', [track('light')])
  dark.style = { dark: { overflow: 'scroll-x' } }
  const gone = track('gone')
  gone.showIf = { from: 'site', field: 'missing' }
  const doc = siteWith([track('outside'), inside, dark, gone])
  doc.look.dark = 'light'
  const [home] = doc.pages
  const p = prepare(doc, [home.root, doc.header, doc.footer], { registry })
  const rendered = new Map<Node, HtmlNode>()
  const site = siteElement(doc, home, p, { used: false }, rendered)
  const result = motionCss(p.trees, site, rendered, registry, p)
  assert.deepEqual(result.problems, [])
  assert.deepEqual(
    [...result.nativeScroll].map(n => n.id),
    ['outside', 'onlydesktop', 'light'],
  )
})

test('scrollport and visibility must coincide in the same theme, including for the wide side-header wrapper', () => {
  const m: Motion = { trigger: 'scroll', steps: [rise()] }
  const hero = text('hero', 'Reed', {
    motion: m,
    style: { dark: { hidden: true } },
  })
  const wrap = node('wrap', 'column', [hero])
  wrap.style = { dark: { overflow: 'scroll-y' } }
  const doc = siteWith([wrap])
  doc.look.dark = 'auto'
  assert.match(page(doc).css, /animation-timeline:view\(\)/)
  delete hero.style
  assert.equal(compilePage(doc, 'home', { registry }).ok, false)
  // A desktop hide inherits onto tablet; its phone reset reveals the target only
  // below the side-header rule's min-width:901px.
  const phone = text('phone', 'Mobile', { hide: { desktop: true }, motion: m })
  const header = node('head', 'column', [phone])
  header.style = { base: { side: 240 } }
  const withHeader = siteWith([], { header })
  assert.match(page(withHeader).css, /animation-timeline:view\(\)/)
  delete phone.hide
  assert.equal(compilePage(withHeader, 'home', { registry }).ok, false)
})
test('a scrollport and the complete target path need a common declared-state assignment', () => {
  const target = text('title', 'Reed')
  const wrap = node('wrap', 'column', [target])
  const hero = node('hero', 'column', [wrap])
  hero.motion = {
    trigger: 'scroll',
    steps: [{ ...rise(), target: { id: 'title' } }],
  }
  const box = node('scroller', 'column', [hero])
  box.state = ['mode', 'panel'].map(name => ({
    name,
    values: 'on-off',
    initial: 'off',
  }))
  box.style = {
    when: [{ state: 'mode', is: 'on', decl: { overflow: 'scroll-x' } }],
  }
  const doc = siteWith([box])
  target.style = { when: [{ state: 'mode', is: 'on', decl: { hidden: true } }] }
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
  hero.motion.scrollFallback = 'timeline'
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
  delete hero.motion.scrollFallback
  // A later show makes on/on a witness.
  target.style.when!.push({ state: 'panel', is: 'on', decl: { hidden: false } })
  assert.equal(compilePage(doc, 'home', { registry }).ok, false)
  // But not if a wrapper hides that same assignment.
  wrap.style = { when: [{ state: 'panel', is: 'on', decl: { hidden: true } }] }
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
  delete wrap.style
  delete target.style
  box.style.when!.push({
    state: 'mode',
    is: 'on',
    decl: { overflow: 'visible' },
  })
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
})

test('shadowed composed holders can supply different values to actual style selectors', () => {
  const state = (initial: string) => [
    { name: 'mode', values: 'on-off' as const, initial },
  ]
  const target = text('title', 'Reed', {
    style: {
      base: { hidden: true },
      when: [{ state: 'mode', is: 'off', decl: { hidden: false } }],
    },
  })
  const inner = node('inner', 'column', [target])
  inner.motion = {
    trigger: 'scroll',
    steps: [{ ...rise(), target: { id: 'title' } }],
  }
  const scroller = node('scroller', 'column', [inner])
  scroller.state = state('on')
  scroller.style = {
    when: [{ state: 'mode', is: 'on', decl: { overflow: 'scroll-x' } }],
  }
  const doc = siteWith([scroller], {
    header: { ...node('header', 'instance'), component: 'banner' },
    components: [
      {
        id: 'banner',
        name: 'Banner',
        props: [],
        variants: [],
        root: {
          ...node('bar', 'column', [text('label', 'Header')]),
          state: state('off'),
        },
      },
    ],
  })
  // The local holder can scroll while the site wrapper shows the target.
  const bad = compilePage(doc, 'home', { registry })
  assert.ok(
    !bad.ok &&
      bad.problems.some(
        p => p.nodeId === 'inner' && p.path === 'motion.trigger',
      ),
    JSON.stringify(bad.problems),
  )
  // The later matching on hide always wins while scrolling.
  target.style!.when!.push({ state: 'mode', is: 'on', decl: { hidden: true } })
  assert.match(page(doc).css, /animation-timeline:--cm-v/)
})

test('many declared values need only the matching branches, and a real overlap still selects fallback', () => {
  const values = Array.from({ length: 16 }, (_, i) => `v${i}`)
  const states = Array.from({ length: 8 }, (_, i) => ({
    name: `mode${i}`,
    values,
    initial: 'v0',
  }))
  const target = text('title', 'Reed', {
    style: {
      when: states.map(s => ({
        state: s.name,
        is: 'v1',
        decl: { hidden: true },
      })),
    },
  })
  target.motion = {
    trigger: 'scroll',
    effect: 'rise',
    scrollFallback: 'timeline',
  }
  const outer = node('scroller', 'column', [target])
  outer.state = states
  outer.style = {
    when: states.map(s => ({
      state: s.name,
      is: 'v1',
      decl: { overflow: 'scroll-x' },
    })),
  }
  const doc = siteWith([outer])
  assert.match(page(doc).css, /@supports \(animation-timeline:view\(\)\)/)
  target.style!.when!.pop() // the last holder value now exposes the bad scrollport
  assert.doesNotMatch(
    page(doc).css,
    /@supports \(animation-timeline:view\(\)\)/,
  )
})
test('built-in rise compiles identically to its explicit steps; edit/subtree stay static', () => {
  for (const distance of [undefined, 0, 42, 100]) {
    const doc = docFor({
      trigger: 'load',
      effect: 'rise',
      settings: distance === undefined ? {} : { distance },
    })
    const explicit = docFor({ trigger: 'load', steps: [rise(distance)] })
    assert.equal(page(doc).css, page(explicit).css)
    assert.equal(page(doc, 'measure').css, page(doc).css)
    assert.equal(page(doc, 'edit').html, page(docFor(), 'edit').html)
    const sub = (d: typeof doc) =>
      compileSubtree(d, 'home', 'hero', { registry })
    assert.deepEqual(sub(doc), sub(docFor()))
  }
})
test('an omitted rendered target or owner emits no motion, including samples, hidden and empty media', () => {
  for (const child of [
    { ...node('gone', 'image'), props: { alt: 'Absent' } },
    text('gone', 'Sample', {
      props: { sample: true, runs: [{ text: 'Sample' }] },
    }),
    text('gone', 'Hidden', {
      hide: { desktop: true, tablet: true, phone: true },
    }),
    text('gone', 'Conditional', { showIf: { from: 'site', field: 'show' } }),
  ]) {
    const owner = node('hero', 'column', [child, text('kept', 'Here')])
    const doc = siteWith([owner])
    const plain = page(doc)
    owner.motion = {
      trigger: 'hover',
      steps: [{ ...rise(), target: { id: 'gone' } }],
    }
    child.motion = { trigger: 'load', effect: 'rise' }
    assert.equal(page(doc).html, plain.html)
    child.motion.trigger = owner.motion.trigger = 'enter-view'
    assert.equal(page(doc).html, plain.html)
  }
})

test('timeline data is escaped on each rendered owner; one charged host for shared roots, live and measure', () => {
  const doc = docFor({
    trigger: 'enter-view',
    steps: [{ ...rise(), target: { id: 'title' } }],
  })
  doc.footer.children = [
    text('credits', 'Credits', {
      motion: { trigger: 'enter-view', effect: 'rise' },
    }),
  ]
  for (const mode of ['live', 'measure'] as const) {
    for (const stateful of [false, true]) {
      doc.footer.state = stateful
        ? [{ name: 'mode', initial: 'off', values: 'on-off' }]
        : []
      const p = page(doc, mode)
      const bytes = p.stats.scriptBytes
      assert.deepEqual(
        p.scripts.map(s => s.name),
        stateful ? ['base', 'states', 'timeline'] : ['base', 'timeline'],
      )
      assert.equal(
        p.html.match(/ data-culm-motion="[^"]*&quot;[^"]*"/g)?.length,
        2,
      )
      assert.equal(Buffer.byteLength(p.scripts.at(-1)!.code), bytes.timeline)
      assert.equal(
        Buffer.byteLength(p.html.match(/<script>(.*?)<\/script>/s)![1]),
        bytes.base + bytes.states + bytes.timeline!,
      )
      assert.equal(
        bytes.base,
        Buffer.byteLength(p.scripts[0].code) + p.scripts.length - 1,
      )
    }
  }
  const edit = page(doc, 'edit')
  assert.deepEqual(edit.scripts, [])
  assert.doesNotMatch(edit.html, /data-culm-motion/)
  const sub = compileSubtree(doc, 'home', 'hero', { registry })
  assert.doesNotMatch(JSON.stringify(sub), /data-culm-motion/)
})

test('stationary entrances ship only playback; one interactive shared-root scene restores the full host', () => {
  const doc = docFor({
    trigger: 'enter-view',
    steps: [{ ...rise(), target: { id: 'title' } }],
  })
  const compiled = page(doc)
  assert.equal(compiled.scripts.at(-1)?.code, PLAYBACK_TIMELINE_SCRIPT)
  const bytes = Buffer.byteLength(PLAYBACK_TIMELINE_SCRIPT)
  assert.equal(compiled.stats.scriptBytes.timeline, bytes)
  assert.ok(bytes < Buffer.byteLength(TIMELINE_SCRIPT))
  doc.footer.children = [
    text('other', 'Survey', {
      motion: { trigger: 'pointer-x', steps: [rise()] },
    }),
  ]
  const mixed = page(doc)
  assert.equal(mixed.scripts.at(-1)?.code, TIMELINE_SCRIPT)
  assert.equal(
    mixed.stats.scriptBytes.timeline,
    Buffer.byteLength(TIMELINE_SCRIPT),
  )
})

test('timeline tokens bind checked component descendants after repeat expansion; no rows cost nothing', () => {
  const root = node('panel', 'column', [text('title', 'Title')])
  root.motion = {
    trigger: 'enter-view',
    steps: [{ ...rise(), target: { id: 'title' } }],
  }
  const use = { ...node('item', 'instance'), component: 'card' }
  const doc = siteWith(
    [{ ...node('list', 'list', [use]), repeat: { source: 'projects' } }],
    {
      components: [{ id: 'card', name: 'Card', root, props: [], variants: [] }],
    },
  )
  assert.deepEqual(
    page(doc).scripts.map(s => s.name),
    ['base'],
  )
  const r = compilePage(doc, 'home', {
    registry,
    mode: 'measure',
    data: { rows: { projects: [{ title: 'A' }, { title: 'B' }] } },
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  for (const i of [0, 1]) {
    assert.match(
      r.html,
      new RegExp(`<li[^>]*data-id="item~${i}"[^>]* data-culm-motion="([^"]*)"`),
    )
    assert.match(
      r.html,
      new RegExp(`<p[^>]*cm-e\\d+[^>]*data-id="item\\.title~${i}"`),
    )
  }
  for (const [, attr] of r.html.matchAll(/ data-culm-motion="([^"]*)"/g))
    assert.doesNotMatch(attr, /title|item~/)
})

test('every fallback is charged, but only the representable scroll owner has native playback', () => {
  const fallback: Motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    effect: 'rise',
  }
  const outside = text('outside', 'Viewport', { motion: fallback })
  const scroller = node('scroller', 'column', [
    text('inside', 'Nested', { motion: fallback }),
  ])
  scroller.style = { base: { overflow: 'scroll-y' } }
  const p = page(
    siteWith([
      outside,
      scroller,
      text('timed', 'Timed', {
        motion: { trigger: 'enter-view', effect: 'rise' },
      }),
    ]),
    'measure',
  )
  const data = [...p.html.matchAll(/ data-culm-motion="([^"]*)"/g)].map(
    ([, s]) => JSON.parse(s.replaceAll('&quot;', '"')),
  )
  assert.deepEqual(
    data.map(s => [s.trigger, !!s.native]),
    [
      ['scroll', true],
      ['scroll', false],
      ['enter-view', false],
    ],
  )
  assert.ok(p.stats.scriptBytes.timeline)
})

test('a press timeline on a plain owner is reachable by keyboard', () => {
  const doc = docFor({
    trigger: 'press',
    steps: [rise(), { ...rise(), target: 'children' }],
  })
  assert.match(
    page(doc, 'measure').html,
    /<div[^>]*data-id="hero"[^>]*tabindex="0"[^>]*data-culm-motion=/,
  )
})

test('a pin cannot reserve space or ship its host when its visual child was omitted', () => {
  const owner = node('owner', 'box', [
    { ...node('missing', 'image'), props: { alt: 'Missing' } },
  ])
  const doc = siteWith([owner])
  const plain = page(doc)
  owner.motion = { trigger: 'scroll', pinPx: 500, effect: 'rise' }
  assert.equal(page(doc).html, plain.html)
})

test('a path in a nested SVG group resolves its own direct geometry, separate from an ordinary target', () => {
  const part = (id: string) => ({
    ...node(id, 'shape'),
    slot: { x: 0, y: 0, w: 20, h: 20 },
    props: {
      geometry: { type: 'path' as const, d: 'M0 0L10 10' },
      stroke: { width: 1, color: 'ink' as const },
    },
  })
  const group = node('group', 'shape', [part('other'), part('mark')])
  group.props = { geometry: { type: 'group' } }
  group.motion = {
    trigger: 'enter-view',
    steps: [
      { ...rise(), target: { id: 'mark' } },
      {
        target: { id: 'mark', part: 'path' },
        from: { draw: 0 },
        to: { draw: 1 },
        durationMs: 250,
      },
    ],
  }
  const p = page(siteWith([group]))
  assert.match(p.html, /<svg[^>]+data-culm-motion=/)
  assert.match(
    p.html,
    /<svg x="0"[^>]+cm-e\d+[^>]*><path d="M0 0L10 10" class="cm-e\d+"/,
  )
  assert.equal(p.html.match(/<path d="M0 0L10 10" class=/g)?.length, 1)
})

test('dynamic text keeps prepared fixed blocks and leaves only measured group timing open', () => {
  const hero = text('hero', 'Reed', {
    motion: {
      trigger: 'enter-view',
      steps: [
        {
          ...rise(),
          target: 'letters',
          from: { xPercent: 105 },
          to: { xPercent: 0 },
          staggerMs: 42,
          mask: true,
          ease: 'expo-out',
        },
        { ...rise(), delayMs: 25 },
      ],
    },
  })
  const html = page(siteWith([hero])).html
  const s = JSON.parse(
    html.match(/ data-culm-motion="([^"]*)"/)![1].replaceAll('&quot;', '"'),
  )
  assert.equal(s.tracks.length, 0)
  const [letters, fixed] = s.parts
  assert.deepEqual(
    [
      letters.unit,
      letters.stagger,
      letters.duration,
      letters.mask,
      fixed.delay,
      fixed.duration,
    ],
    ['letters', 42, 400, true, 25, 400],
  )
  assert.match(letters.tracks[0][1][0].easing, /^linear\(/)
  assert.equal(letters.tracks[0][1][0].translate, '105%')
})

function headingParts(steps: Step[], appear = false) {
  const hero = text('hero', 'Reed Ledger', {
    props: { level: 'h2', runs: [{ text: 'Reed Ledger' }] },
    ...(appear && { style: { base: { appearAfter: 100 } } }),
    motion: { trigger: 'enter-view', steps },
  })
  const p = page(siteWith([hero]))
  const scene: Scene = JSON.parse(
    p.html.match(/ data-culm-motion="([^"]*)"/)![1].replaceAll('&quot;', '"'),
  )
  assert.ok(scene.parts)
  return { parts: scene.parts, css: p.css }
}

test('dynamic blocks carry the vertical scale of the same owner or split unit only', () => {
  const step = (
    target: Step['target'],
    from: Step['from'],
    to: Step['to'],
  ): Step => ({ target, from, to, durationMs: 100 })
  const horizontal = (target: Step['target']) =>
    step(target, { scaleX: 2 }, { scaleX: 3 })
  const { parts } = headingParts([
    step('self', { scale: 1 }, { scale: 2 }),
    step('letters', { opacity: 0 }, { opacity: 1 }),
    horizontal('self'),
    horizontal('letters'),
    step('letters', { scale: 1 }, { scale: 4 }),
    horizontal('self'),
    horizontal('letters'),
    horizontal('words'),
  ])
  const curve = (i: number) => parts[i].tracks[0][1].map(f => f.scale)
  assert.deepEqual([2, 3, 5, 6, 7].map(curve), [
    ['2 2', '3 2'],
    ['2 1', '3 1'],
    ['2 2', '3 2'],
    ['2 4', '3 4'],
    ['2 1', '3 1'],
  ])
})

test('split opacity fades members while only the reveal-bearing heading uses the alpha channel', () => {
  const fade = (target: Step['target']): Step => ({
    target,
    from: { opacity: 0.2 },
    to: { opacity: 0.8 },
    durationMs: 100,
  })
  const { parts } = headingParts(
    (['letters', 'self', 'words', 'lines'] as const).map(fade),
    true,
  )
  for (const p of parts) {
    const [, frames, , reveal] = p.tracks[0]
    assert.deepEqual(frames, [{ opacity: 0.2 }, { opacity: 0.8 }])
    assert.deepEqual(
      reveal,
      p.unit ? undefined : [{ '--cm-alpha': 0.2 }, { '--cm-alpha': 0.8 }],
    )
  }
  assert.doesNotMatch(headingParts([fade('letters')], true).css, /--cm-alpha/)
})
