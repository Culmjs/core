import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Look, Node } from '../../src/document/index.ts'
import { writeHtml } from '../../src/compile/index.ts'
import { toElements } from '../../src/compile/elements.ts'
import { blobPath } from '../../src/compile/elementsShape.ts'
import { compileStyles } from '../../src/compile/styles.ts'
import { compilePage } from '../../src/compile/index.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'
import { validateSite } from '../../src/validate/index.ts'
import { plan } from '../../src/ops/plan.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import type { ElementCtx } from '../../src/compile/elementsBase.ts'

const look = {
  id: 'l',
  name: 'L',
  family: 'Minimal',
  brand: '#2244aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'sys:serif',
  bodyFont: 'sys:sans',
  corners: 6,
  dark: 'auto',
} as Look
const links = { page: (s: string) => s, file: (s: string) => s, form: () => '' }
const shape = (props: object, more: Partial<Node> = {}, id = 's'): Node =>
  ({ id, kind: 'shape', name: id, slot: {}, props, ...more }) as Node
const html = (w: Node) =>
  writeHtml(
    toElements(w, {
      doc: { pages: [] },
      links,
      mode: 'live',
      classOf: new Map([[w.id, 'c0']]),
    } as ElementCtx)!,
  )
const styleOf = (s: string) => /style="([^"]*)"/.exec(s)?.[1] ?? ''
const sctx = {
  look,
  mode: 'live' as const,
  style: { fileUrl: () => undefined, fontFamily: () => 'x' },
}
const page = (...kids: Node[]): Node =>
  ({ id: 'r', kind: 'column', name: 'R', slot: {}, children: kids }) as Node

test('a decorative shape is an svg with aria-hidden="true"; with label it is role="img" with that aria-label and no text node', () => {
  const plain = html(shape({ geometry: { type: 'ellipse' } }))
  assert.match(plain, /^<svg /)
  assert.match(plain, /aria-hidden="true"/)
  assert.doesNotMatch(plain, /role=/)
  const named = html(
    shape({ geometry: { type: 'ellipse' }, label: 'A "sun" <b>' }),
  )
  assert.match(named, /role="img"/)
  assert.match(named, /aria-label="A &quot;sun&quot; &lt;b&gt;"/)
  assert.doesNotMatch(named, /aria-hidden/)
  assert.doesNotMatch(named, />[^<]+</, 'no text node')
  assert.doesNotMatch(named, /<title|<text/)
})

test('rect, ellipse and line draw in percent with no viewBox and aspect-ratio from view; polygon, star and blob use viewBox 0 0 100 100', () => {
  const rect = html(
    shape({ geometry: { type: 'rect', radius: 12, view: [3, 1] } }),
  )
  assert.doesNotMatch(rect, /viewBox/)
  assert.match(rect, /<rect x="0" y="0" width="100%" height="100%"><\/rect>/)
  assert.match(styleOf(rect), /--s-ar:3\/1/)
  assert.match(styleOf(rect), /border-radius:12px/)
  assert.match(
    styleOf(html(shape({ geometry: { type: 'rect' } }))),
    /--s-ar:1\/1/,
  )
  assert.match(
    styleOf(html(shape({ geometry: { type: 'rect', radius: [1, 2, 3, 4] } }))),
    /border-radius:1px 2px 3px 4px/,
  )
  assert.match(
    html(shape({ geometry: { type: 'ellipse' } })),
    /<ellipse cx="50%" cy="50%" rx="50%" ry="50%">/,
  )
  const line = html(
    shape({ geometry: { type: 'line', from: [0, 10], to: [100, 90] } }),
  )
  assert.match(line, /<line x1="0%" y1="10%" x2="100%" y2="90%">/)
  assert.doesNotMatch(line, /viewBox/)
  assert.match(
    styleOf(line),
    /fill:none;stroke:var\(--s-brand\);stroke-width:2/,
  )
  for (const geometry of [
    { type: 'polygon', sides: 6 },
    { type: 'star', points: 5, inner: 0.4 },
    { type: 'blob', seed: 3 },
  ])
    assert.match(
      html(shape({ geometry })),
      /viewBox="0 0 100 100"/,
      geometry.type,
    )
  assert.match(
    html(shape({ geometry: { type: 'path', d: 'M0 0L9 9', view: [20, 10] } })),
    /viewBox="0 0 20 10".*<path d="M0 0L9 9">/,
  )
  assert.match(
    html(shape({ geometry: { type: 'polygon', sides: 3 } })),
    /points="50,0 /,
  )
})

test('fit contain, cover and stretch give preserveAspectRatio xMidYMid meet, xMidYMid slice and none', () => {
  const par = (fit?: string) =>
    /preserveAspectRatio="([^"]*)"/.exec(
      html(
        shape({ geometry: { type: 'blob', seed: 1 }, ...(fit ? { fit } : {}) }),
      ),
    )?.[1]
  assert.equal(par(), 'xMidYMid meet')
  assert.equal(par('contain'), 'xMidYMid meet')
  assert.equal(par('cover'), 'xMidYMid slice')
  assert.equal(par('stretch'), 'none')
})

test('fill brand is written as style fill:<colorCss("brand")>, so the dark layer follows; a gradient writes a linearGradient with two stops', () => {
  const g = { type: 'ellipse' }
  assert.match(
    styleOf(html(shape({ geometry: g }))),
    /^--s-ar:1\/1;fill:var\(--s-brand\)$/,
  )
  assert.match(styleOf(html(shape({ geometry: g, fill: 'none' }))), /fill:none/)
  assert.match(
    styleOf(html(shape({ geometry: g, fill: '#aabbcc' }))),
    /fill:#aabbcc/,
  )
  assert.match(
    styleOf(
      html(
        shape({
          geometry: g,
          fill: { style: 'sun' },
          opacity: 0.5,
          shadow: 'soft',
          stroke: { color: 'ink', width: 3, dash: [4, 2] },
        }),
      ),
    ),
    /fill:var\(--s-c-sun\);stroke:var\(--s-ink\);stroke-width:3;stroke-dasharray:4 2;opacity:0.5;filter:drop-shadow\(var\(--s-shd-soft\)\)/,
  )
  const out = html(
    shape(
      { geometry: g, fill: { from: 'brand', to: { style: 'sun' }, angle: 90 } },
      {},
      'a.b~1',
    ),
  )
  assert.match(out, /fill:url\(#w-a_b-1-g\)/)
  assert.match(
    out,
    /<defs><lineargradient id="w-a_b-1-g" x1="0%" y1="50%" x2="100%" y2="50%"><stop offset="0" style="stop-color:var\(--s-brand\)"><\/stop><stop offset="1" style="stop-color:var\(--s-c-sun\)"><\/stop><\/lineargradient><\/defs>/,
  )
  // the page's variables hold the site colour and shadow the inline paint points at
  const styles = {
    ...defaultSiteStyles(look),
    colors: [{ id: 'sun', name: 'Sun', value: '#ffcc00' as const }],
  }
  const css = compileStyles(
    page(shape({ geometry: g, fill: { style: 'sun' }, shadow: 'soft' })),
    { ...sctx, styles },
  ).css
  assert.match(css, /--s-c-sun:#ffcc00/)
  assert.match(css, /--s-shd-soft:/)
})

test('blobPath is the same for the same seed, differs for seeds 1 and 2, stays inside 0..100, and smooth 0 is straight lines', () => {
  assert.equal(blobPath(1, 0.8, 6), blobPath(1, 0.8, 6))
  assert.notEqual(blobPath(1, 0.8, 6), blobPath(2, 0.8, 6))
  for (const [seed, smooth, points] of [
    [1, 0.8, 6],
    [2, 1, 12],
    [2147483647, 1, 3],
    [0, 0.5, 8],
  ] as const) {
    const d = blobPath(seed, smooth, points)
    for (const x of d.match(/-?\d+(\.\d+)?/g)!) {
      assert.ok(+x >= 0 && +x <= 100, `${x} in ${d}`)
    }
  }
  const flat = blobPath(4, 0, 5)
  assert.doesNotMatch(flat, /C/)
  assert.equal((flat.match(/L/g) ?? []).length, 5)
  assert.match(blobPath(4, 0.8, 5), /^M[\d. ]+(C[\d. ]+){5}Z$/)
})

test('blobPath(7, 0.8, 6) equals the string recorded when this test first passed', () => {
  assert.equal(
    blobPath(7, 0.8, 6),
    'M99.77 50C100 60.47 83.05 88.71 74.38 92.23C65.71 95.75 42.82 82.01 34.77 76.38C26.72 70.75 14.59 58.09 13.98 50C13.37 41.91 22.62 20.57 30.21 15.73C37.81 10.89 61.67 9.15 70.94 13.72C80.22 18.29 99.31 39.53 99.77 50Z',
  )
})

test('a shape with no width is width:100%; a shape placed behind with no size fills its parent', () => {
  const css = (w: Node) => compileStyles(page(w), sctx).css
  assert.match(
    css(shape({ geometry: { type: 'rect' } })),
    /\{display:block;width:100%;height:auto;aspect-ratio:var\(--s-ar,auto\)\}/,
  )
  const behind = css(
    shape({ geometry: { type: 'rect' } }, { placement: { mode: 'behind' } }),
  )
  assert.match(
    behind,
    /position:absolute;z-index:-20000;[^}]*width:100%;height:100%/,
  )
  // an own width or height is kept
  const sized = css(
    shape(
      { geometry: { type: 'rect' } },
      {
        placement: { mode: 'behind' },
        style: { base: { width: { n: 50, unit: '%' } } },
      },
    ),
  )
  assert.doesNotMatch(sized, /position:absolute[^}]*width:100%;height:100%/)
  assert.match(sized, /position:absolute[^}]*height:100%/)
  // nothing else changes: another kind in a column keeps its rules
  assert.doesNotMatch(
    css({
      id: 'h',
      kind: 'divider',
      name: 'h',
      slot: {},
      placement: { mode: 'behind' },
    } as Node),
    /height:100%/,
  )
})

test('no stage 1 or 2 compile fixture changes: a page with no shape writes nothing for shapes', () => {
  const css = compileStyles(
    page({ id: 't', kind: 'divider', name: 't', slot: {} } as Node),
    sctx,
  ).css
  assert.doesNotMatch(css, /--s-ar|drop-shadow/)
})

test('a custom site shadow with a spread gives the shape a valid three-length drop-shadow', () => {
  const styles = {
    ...defaultSiteStyles(look),
    shadows: [
      {
        id: 'glow',
        name: 'Glow',
        value: { x: 2, y: 4, blur: 10, spread: 6, color: { style: 'sun' } },
      },
    ],
    colors: [{ id: 'sun', name: 'Sun', value: '#ffcc00' as const }],
  } as never
  const w = shape({ geometry: { type: 'ellipse' }, shadow: 'glow' })
  assert.match(styleOf(html(w)), /filter:drop-shadow\(var\(--s-shd-glow\)\)/)
  const css = compileStyles(page(w), { ...sctx, styles }).css
  const v = /--s-shd-glow:([^;}]*)/.exec(css)?.[1]
  assert.equal(v, '2px 4px 10px var(--s-c-sun)')
  assert.match(css, /--s-c-sun:#ffcc00/)
})

// ---- composition ----

const cpart = (id: string, geometry: object, kids: Node[]): Node =>
  shape(
    { geometry },
    { children: kids, slot: { x: 0, y: 0, w: 50, h: 50 } },
    id,
  )
const part = (
  id: string,
  geometry: object,
  slot: object = { x: 0, y: 0, w: 50, h: 50 },
  props: object = {},
): Node => shape({ geometry, ...props }, { slot }, id)
const group = (
  kids: Node[],
  combine?: string,
  props: object = {},
  id = 's',
): Node =>
  shape(
    { geometry: { type: 'group', ...(combine ? { combine } : {}) }, ...props },
    { children: kids },
    id,
  )

test('layer: each child is an svg at its slot with its own fill', () => {
  const out = html(
    group([
      part(
        'a',
        { type: 'ellipse' },
        { x: 1, y: 2, w: 30, h: 40 },
        { fill: 'brand' },
      ),
      part(
        'b',
        { type: 'star', points: 5, inner: 0.4 },
        { x: 5, y: 6, w: 7, h: 8 },
        { fill: '#ff0000' },
      ),
    ]),
  )
  assert.match(
    out,
    /<svg x="1" y="2" width="30" height="40" style="[^"]*fill:var\(--s-brand\)[^"]*"><ellipse /,
  )
  assert.match(
    out,
    /<svg x="5" y="6" width="7" height="8" viewBox="0 0 100 100"[^>]*style="[^"]*fill:#ff0000/,
  )
  assert.match(out, /viewBox="0 0 100 100"/)
  assert.doesNotMatch(out, /<g[ >]|<mask/)
})

test('union: one g with the group fill; a child fill is not written', () => {
  const out = html(
    group(
      [
        part('a', { type: 'ellipse' }, undefined, { fill: '#ff0000' }),
        part(
          'b',
          { type: 'ellipse' },
          { x: 20, y: 0, w: 50, h: 50 },
          { fill: '#00ff00' },
        ),
      ],
      'union',
      { fill: 'ink' },
    ),
  )
  assert.equal(out.match(/<g[ >]/g)?.length, 1)
  assert.match(out, /<g style="fill:var\(--s-ink\)">/)
  assert.doesNotMatch(out, /#ff0000|#00ff00/)
})

test('subtract: the first child under a mask whose other children are black; the mask id is the safe dom id + "-m"', () => {
  const out = html(
    group(
      [
        part(
          'a',
          { type: 'rect' },
          { x: 0, y: 0, w: 100, h: 100 },
          { fill: '#ff0000' },
        ),
        part('b', { type: 'ellipse' }, { x: 10, y: 10, w: 30, h: 30 }),
        part('c', { type: 'ellipse' }, { x: 50, y: 10, w: 30, h: 30 }),
      ],
      'subtract',
      { fill: 'brand' },
      'r~1.s',
    ),
  )
  assert.match(out, /<mask id="w-r-1_s-m"[^>]*>/)
  assert.match(
    out,
    /<g mask="url\(#w-r-1_s-m\)" style="fill:var\(--s-brand\)">/,
  )
  const mask = /<mask[\s\S]*<\/mask>/.exec(out)![0]
  assert.equal(mask.match(/fill:#000/g)?.length, 2)
  assert.match(mask, /fill:#fff|fill="#fff"|fill:white/)
  const under = out.slice(
    out.indexOf('</defs>') > -1 ? out.indexOf('</defs>') : 0,
  )
  assert.doesNotMatch(under, /#ff0000/)
})

test('a rect with unequal corners inside a group is a path of its slot size', () => {
  const out = html(
    group([
      part(
        'a',
        { type: 'rect', radius: [4, 0, 8, 0] },
        { x: 0, y: 0, w: 60, h: 20 },
      ),
      part('b', { type: 'rect', radius: 5 }, { x: 0, y: 30, w: 60, h: 20 }),
    ]),
  )
  assert.match(
    out,
    /<path d="M4 0H60A0 0 0 0 1 60 0V12A8 8 0 0 1 52 20H0A0 0 0 0 1 0 20V4A4 4 0 0 1 4 0Z">/,
  )
  assert.doesNotMatch(out, /border-radius/)
  assert.match(out, /<rect[^>]*rx="5"/)
})

const sid = (html: string) => {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]!)
  const refs = [...html.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]!)
  return { ids, refs }
}

test('a group in a repeated list row and in two component instances: every gradient and mask id is unique and each url(#) resolves', () => {
  const g = (id: string): Node =>
    group(
      [
        part(
          `${id}a`,
          { type: 'rect' },
          { x: 0, y: 0, w: 100, h: 100 },
          {
            fill: { from: 'brand', to: 'ink' },
          },
        ),
        part(`${id}b`, { type: 'ellipse' }, { x: 10, y: 10, w: 30, h: 30 }),
      ],
      'subtract',
      { fill: { from: 'ink', to: 'brand' } },
      id,
    )
  const list: Node = {
    id: 'pl',
    kind: 'list',
    name: 'pl',
    slot: {},
    repeat: { source: 'projects' },
    children: [node('pitem', 'column', [g('g')])],
  }
  const inst = (id: string): Node => ({
    id,
    kind: 'instance',
    name: id,
    slot: {},
    component: 'c',
  })
  const doc = siteWith([list, inst('u1'), inst('u2')], {
    components: [
      {
        id: 'c',
        name: 'C',
        root: node('croot', 'column', [g('cg')]),
        props: [],
        variants: [],
      },
    ],
  })
  const r = compilePage(doc, 'home', {
    registry: sampleRegistry(),
    data: { rows: { projects: [{ title: 'A' }, { title: 'B' }] } },
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  const { ids, refs } = sid(r.html)
  const used = ids.filter(i => /-[gm]$/.test(i))
  assert.equal(
    used.length,
    4 * 2,
    'a mask and a group gradient for each of four groups',
  )
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  assert.ok(refs.length >= used.length)
  assert.ok(
    refs.every(x => ids.includes(x)),
    'every url resolves',
  )
})

test('a badge (star union circle) and a ribbon (rect subtract triangle) compile within every ceiling', () => {
  const badge = group(
    [
      part(
        'a',
        { type: 'star', points: 8, inner: 0.7 },
        { x: 0, y: 0, w: 100, h: 100 },
      ),
      part('b', { type: 'ellipse' }, { x: 20, y: 20, w: 60, h: 60 }),
    ],
    'union',
    { fill: 'brand' },
    'badge',
  )
  const ribbon = group(
    [
      part('c', { type: 'rect' }, { x: 0, y: 0, w: 100, h: 40 }),
      part(
        'd',
        { type: 'polygon', sides: 3, rotate: 90 },
        { x: 80, y: 0, w: 40, h: 40 },
      ),
    ],
    'subtract',
    { fill: 'ink' },
    'ribbon',
  )
  const r = compilePage(siteWith([badge, ribbon]), 'home', {
    registry: sampleRegistry(),
  })
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.problems))
  assert.deepEqual(r.problems, [])
  assert.ok(r.stats.bytes < 100_000)
})

// ---- nested groups take the outer union or subtract paint ----

test('union over union with a gradient: every url(#) resolves; union over layer: the parts take the union fill; subtract over layer: the mask parts are black', () => {
  const inner = (combine: string, id = 'in') =>
    cpart(id, { type: 'group', combine }, [
      part('p', { type: 'ellipse' }, undefined, { fill: '#ff0000' }),
      part('q', { type: 'ellipse' }, undefined, { fill: '#00ff00' }),
    ])
  const uu = html(
    group([inner('union')], 'union', { fill: { from: 'brand', to: 'ink' } }),
  )
  assert.equal(uu.match(/<lineargradient/g)?.length, 1)
  for (const m of uu.matchAll(/url\(#([^)]+)\)/g))
    assert.ok(uu.includes(`id="${m[1]}"`), m[1])
  assert.doesNotMatch(uu, /#ff0000|#00ff00/)
  const ul = html(group([inner('layer')], 'union', { fill: 'ink' }))
  assert.doesNotMatch(ul, /#ff0000|#00ff00|--s-brand/)
  const sl = html(
    group([part('a', { type: 'rect' }), inner('layer')], 'subtract', {
      fill: 'ink',
    }),
  )
  const mask = /<mask[\s\S]*<\/mask>/.exec(sl)![0]
  assert.doesNotMatch(mask, /#ff0000|#00ff00|--s-brand/)
  assert.equal(mask.match(/fill:#000/g)?.length, 3)
})

// ---- a button with shapes behind its label ----

const back = (id: string, more: Partial<Node> = {}): Node =>
  shape(
    { geometry: { type: 'rect', radius: 9999 } },
    { placement: { mode: 'behind' }, ...more },
    id,
  )
const btn = (kids?: Node[], more: Partial<Node> = {}): Node =>
  ({
    id: 'b',
    kind: 'button',
    name: 'b',
    slot: {},
    props: { label: 'Go' },
    ...(kids ? { children: kids } : {}),
    ...more,
  }) as Node
const probsOf = (b: Node) =>
  validateSite(siteWith([b]), sampleRegistry()).map(p => p.path)

test('a button holds up to 4 shapes, each placed behind; a text child, a fifth shape, or a shape placed normal or front on any layout is refused', () => {
  assert.deepEqual(
    probsOf(btn([back('a'), back('b2'), back('c'), back('d')])),
    [],
  )
  assert.ok(
    probsOf(
      btn([back('a'), back('b2'), back('c'), back('d'), back('e')]),
    ).includes('children'),
  )
  assert.ok(probsOf(btn([text('t', 'x')])).length > 0)
  assert.ok(
    probsOf(btn([shape({ geometry: { type: 'rect' } })])).includes('placement'),
  )
  assert.ok(
    probsOf(btn([back('a', { placement: { mode: 'front' } })])).includes(
      'placement',
    ),
  )
  assert.ok(
    probsOf(
      btn([
        back('a', { placement: { mode: 'behind', phone: { mode: 'normal' } } }),
      ]),
    ).includes('placement'),
  )
  assert.ok(
    probsOf(
      btn([
        back('a', { placement: { mode: 'behind', tablet: { mode: 'front' } } }),
      ]),
    ).includes('placement'),
  )
})

test('a button with a shape behind writes the svg first, then the label, inside the same a; the button is position:relative;isolation:isolate', () => {
  const w = btn([back('a')], {
    props: { label: 'Go', link: { to: 'home' } },
  } as never)
  const out = html(w)
  assert.match(out, /^<a [^>]*>\s*<svg [\s\S]*<\/svg>Go<\/a>$/)
  assert.equal(out.match(/<a /g)?.length, 1)
  assert.match(
    compileStyles(page(w), sctx).css,
    /position:relative;isolation:isolate/,
  )
})

test('a button with no children compiles byte for byte as before', () => {
  const plain = html(btn())
  assert.equal(plain, html(btn([])))
  assert.doesNotMatch(plain, /<svg/)
  assert.ok(plain.endsWith('>Go</a>'))
})

test('a shape placed behind in a column compiles with z-index -20000 and fills the column', () => {
  assert.match(
    compileStyles(page(back('a')), sctx).css,
    /position:absolute;z-index:-20000;[^}]*width:100%;height:100%/,
  )
})

test('remove of a required heading that has a shape behind it is still refused, and setRequired false on it too', () => {
  const h = text('h', 'Welcome', { required: true })
  const doc = siteWith([h, back('bg')])
  const req = (ops: unknown[]) =>
    ({ site: 's', baseRevision: 0, key: 'k', ops }) as never
  const reg = sampleRegistry()
  const rm = plan(
    doc,
    reg,
    req([{ op: 'remove', tree: { page: 'home' }, id: 'h' }]),
  )
  assert.ok(!rm.ok && rm.problems.some(p => p.rule === 'required'))
  const off = plan(
    doc,
    reg,
    req([
      { op: 'setRequired', tree: { page: 'home' }, id: 'h', required: false },
    ]),
  )
  assert.ok(!off.ok, 'setRequired false on required content is refused')
})
