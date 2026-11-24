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
  assert.equal(page(docFor()).html, plainBaselineHtml)
})
test('load, keyboard-equivalent hover and active press use finite gated CSS', () => {
  assert.match(cssOnly('load', rise()).css, /400ms/)
  assert.match(cssOnly('hover', rise()).css, /:focus-visible/)
  assert.match(cssOnly('hover', rise()).css, /:hover/)
  assert.match(cssOnly('press', rise()).css, /:active/)
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

test('native fallback membership is per rendered owner, including when a scrollport is layout-dependent', () => {
  const m: Motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [rise()],
  }
  const track = (id: string) => text(id, 'Reed', { motion: m })
  const inside = node('scroller', 'column', [track('inside')])
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
    ['outside', 'light'],
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
  }
})
