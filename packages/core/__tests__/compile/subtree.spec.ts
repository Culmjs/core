import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compilePage,
  compileSite,
  compileSubtree,
} from '../../src/compile/index.ts'
import { find, replace, type Node } from '../../src/document/index.ts'
import { prepare } from '../../src/compile/page.ts'
import { node, projectsList, sampleRegistry, siteWith, text } from '../kit.ts'

const registry = sampleRegistry()
const abc = (): Node => ({
  ...node('abc', 'column', [text('abct', 'Inside')]),
  style: { base: { gap: 12 } },
})

test('a subtree compiles to its own HTML and prefixed classes, with no document wrapper', () => {
  const doc = siteWith([text('other', 'Elsewhere'), abc()])
  const r = compileSubtree(doc, 'home', 'abc', { registry })
  assert.ok(r.ok)
  assert.ok(r.html.startsWith('<') && !r.html.includes('<html'))
  assert.ok(!r.html.includes('<body') && !r.html.includes('<style'))
  assert.match(r.html, /class="pabc-c\d+/)
  assert.match(r.css, /\.pabc-c\d+\{/)
  assert.ok(r.html.includes('data-id="abc"'))
  assert.ok(r.html.includes('Inside') && !r.html.includes('Elsewhere'))
})

test('the css holds the rules of the subtree alone: no base rules, no look', () => {
  const r = compileSubtree(siteWith([abc()]), 'home', 'abc', { registry })
  assert.ok(r.ok)
  assert.ok(!r.css.includes('box-sizing') && !r.css.includes('--s-brand'))
  assert.ok(!r.css.includes('.s-site{'))
  const classes = [...r.css.matchAll(/\.(p[a-z0-9_-]+)/g)].map(m => m[1])
  assert.ok(
    classes.length > 0 && classes.every(c => c.startsWith('pabc-')),
    classes.join(),
  )
})

test('a node of the header or the footer is found, and the page is not needed to hold it', () => {
  const header = node('hd', 'row', [abc()])
  const r = compileSubtree(
    siteWith([text('t', 'x')], { header }),
    'home',
    'abc',
    { registry },
  )
  assert.ok(r.ok && r.html.includes('data-id="abc"'))
  const footer = node('ft', 'row', [{ ...abc(), id: 'xyz' }])
  const f = compileSubtree(
    siteWith([text('t', 'x')], { footer }),
    'home',
    'xyz',
    { registry },
  )
  assert.ok(
    f.ok && f.html.includes('data-id="xyz"') && /\.pxyz-c\d+\{/.test(f.css),
  )
})

test('a subtree is always compiled for editing, whatever mode is asked for', () => {
  const r = compileSubtree(siteWith([abc()]), 'home', 'abc', {
    registry,
    mode: 'live',
  })
  assert.ok(r.ok && r.html.includes('data-id="abct"'))
})

test('a list inside the subtree is expanded with the rows supplied', () => {
  const list = projectsList('abc')
  const r = compileSubtree(siteWith([list]), 'home', 'abc', {
    registry,
    data: { rows: { projects: [{ title: 'Alpha' }, { title: 'Beta' }] } },
  })
  assert.ok(r.ok && r.html.includes('Alpha') && r.html.includes('Beta'))
  assert.ok(r.ok && r.css.includes('.pabc'), r.ok ? r.css : '')
})

test('an unknown node id is refused with INVALID_NODE', () => {
  const r = compileSubtree(siteWith([abc()]), 'home', 'nope', { registry })
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, 'INVALID_NODE')
  assert.equal(r.problems[0].nodeId, 'nope')
})

test('an unknown page, an invalid document and a node id that is not an id are refused', () => {
  const doc = siteWith([abc()])
  for (const r of [
    compileSubtree(doc, 'nope', 'abc', { registry }),
    compileSubtree(siteWith([node('x', 'frame')]), 'home', 'x', { registry }),
    compileSubtree(doc, 'home', '__proto__', { registry }),
    compileSubtree(doc, 'home', 'ABC "><b>', { registry }),
    compileSubtree(null as never, 'home', 'abc', { registry }),
  ])
    assert.ok(!r.ok && r.problems.length > 0)
})

/** Every rule of a sheet with its class names made alike, so a prefixed sheet and the page's own compare. */
const rulesOf = (css: string) =>
  css
    .match(/[^{}]+\{[^{}]*\}/g)
    ?.map(r =>
      r.replace(/\.p?[a-z0-9_~-]*c[0-9a-z]+(?![\w-])/g, '.X').trim(),
    ) ?? []
const bare = (html: string) => html.replace(/ class="[^"]*"/g, '')

/** The subtree of `id` against the page: the same markup apart from class names, and every rule it carries is one the page has. */
function sameAsPage(doc: ReturnType<typeof siteWith>, id: string) {
  const sub = compileSubtree(doc, 'home', id, { registry, data })
  const page = compilePage(doc, 'home', { registry, mode: 'edit', data })
  assert.ok(sub.ok && page.ok)
  assert.ok(sub.html.length > 0)
  // rows of a template are siblings of each other in the page, with their own parents between: compare the elements one by one
  const starts = sub.html.match(/<[a-z0-9]+ [^>]*data-id="[^"]*"[^>]*>/g) ?? []
  assert.ok(starts.length > 0)
  for (const t of starts) assert.ok(bare(page.html).includes(bare(t)), t)
  if (!id.includes('~') && !sub.html.includes(`${id}~`))
    assert.ok(bare(page.html).includes(bare(sub.html)), sub.html)
  const pageRules = new Set(rulesOf(page.css))
  for (const r of rulesOf(sub.css)) assert.ok(pageRules.has(r), r)
  return sub
}
const data = { rows: { projects: [{ title: 'Alpha' }, { title: 'Beta' }] } }

test('a list item is an li, as in the page, and so is each of its rows', () => {
  const list = projectsList('pl')
  list.children![0].style = { base: { gap: 12 } }
  const sub = sameAsPage(siteWith([list]), 'plitem')
  assert.equal(sub.html.match(/<li /g)?.length, 2)
  assert.ok(
    sub.html.indexOf('data-id="plitem~0"') <
      sub.html.indexOf('data-id="plitem~1"'),
  )
  assert.ok(sub.css.includes('gap:12px'))
})

test('a child of a free area keeps its place', () => {
  const kid = text('kk', 'Hi', { slot: { x: 2, y: 1, w: 6, h: 2, z: 0 } })
  const sub = sameAsPage(siteWith([node('fr', 'free', [kid])]), 'kk')
  assert.match(sub.css, /grid-column:3 \/ span 6/)
})

test('a child of a row with a slot keeps its slot rules', () => {
  const kid = text('rk', 'Hi', { slot: { grow: 2 } })
  const sub = sameAsPage(
    siteWith([node('rw', 'row', [kid, text('rk2', 'x')])]),
    'rk',
  )
  assert.ok(sub.css.length > 0)
})

test('a node inside a repeated template comes back once per row, with no rule it does not use', () => {
  const list = projectsList('pl')
  const sub = sameAsPage(
    siteWith([
      list,
      { ...node('other', 'column'), style: { base: { gap: 3 } } },
    ]),
    'pltitle',
  )
  assert.equal(sub.html.match(/<p /g)?.length, 2)
  assert.ok(sub.html.includes('Alpha') && sub.html.includes('Beta'))
  assert.ok(!sub.css.includes('gap:3px'))
})

test('a node in the header is compiled in the header', () => {
  const header = node('hd', 'row', [{ ...abc(), id: 'hk' }])
  sameAsPage(siteWith([text('t', 'x')], { header }), 'hk')
})

test('no page-wide block is returned: no tooltip rule, no reduced-motion rule', () => {
  const tip = text('tp', 'Hi', {
    props: { level: 'p', runs: [{ text: 'Hi' }], tip: 'Help' },
  })
  const r = compileSubtree(siteWith([tip]), 'home', 'tp', { registry })
  assert.ok(r.ok)
  assert.ok(
    !r.css.includes('data-tip') && !r.css.includes('prefers-reduced-motion'),
  )
})

/** The flat rules of a sheet, at-rule heads left out, as in the page tests above. */
const flat = (css: string) => css.match(/[^{}]+\{[^{}]*\}/g) ?? []
/** A rule of the unprefixed page that names a node class (`c0`, `c1a`). */
const namesNodeClass = (rule: string) => /\.c[0-9a-z]+(?![\w-])/.test(rule)

const withFont = (doc: ReturnType<typeof siteWith>, id: string) => {
  const n = find(doc.pages[0].root, id)!
  return {
    ...doc,
    fonts: [...doc.fonts, 'cat:inter' as const],
    pages: [
      {
        ...doc.pages[0],
        root: replace(doc.pages[0].root, id, {
          ...n,
          style: { base: { font: 'cat:inter' } },
        } as Node),
      },
    ],
  }
}

test('pageCss gains the font face when a node takes a font the page did not use, and the node css alone does not carry it', () => {
  const doc = siteWith([text('hd', 'Hi'), text('o', 'x')])
  const before = compileSubtree(doc, 'home', 'hd', { registry })
  const after = compileSubtree(withFont(doc, 'hd'), 'home', 'hd', { registry })
  assert.ok(before.ok && after.ok)
  assert.ok(!before.pageCss.includes('Inter'))
  assert.match(after.pageCss, /@font-face\{font-family:"Inter"/)
  assert.ok(!after.css.includes('@font-face'))
})

test('pageCss gains the tooltip block with the first tooltip, and is unchanged by an edit with no page-wide rule', () => {
  const doc = siteWith([text('a', 'Hi'), text('b', 'x')])
  const base = compileSubtree(doc, 'home', 'a', { registry })
  const same = compileSubtree(
    siteWith([text('a', 'Changed'), text('b', 'x')]),
    'home',
    'a',
    { registry },
  )
  const tip = compileSubtree(
    siteWith([
      text('a', 'Hi', {
        props: { level: 'p', runs: [{ text: 'Hi' }], tip: 'Help' },
      }),
      text('b', 'x'),
    ]),
    'home',
    'a',
    { registry },
  )
  assert.ok(base.ok && same.ok && tip.ok)
  assert.equal(same.pageCss, base.pageCss)
  assert.ok(!base.pageCss.includes('data-tip'))
  assert.ok(tip.pageCss.includes('data-tip'))
  assert.ok(!tip.css.includes('data-tip'))
})

test('pageCss is the rules of the compilePage css that name no node class, in order', () => {
  const tip = text('tp', 'Hi', {
    props: { level: 'p', runs: [{ text: 'Hi' }], tip: 'Help' },
  } as Partial<Node>)
  const move = {
    ...node('mv', 'box'),
    style: { base: { transition: { what: 'colour', ms: 200, ease: 'out' } } },
  } as Node
  const doc = withFont(siteWith([tip, move, abc()]), 'abct')
  const page = compilePage(doc, 'home', { registry, mode: 'edit' })
  assert.ok(page.ok, JSON.stringify(!page.ok && page.problems))
  const wide = flat(page.css).filter(r => !namesNodeClass(r))
  for (const id of ['tp', 'mv', 'abc']) {
    const r = compileSubtree(doc, 'home', id, { registry })
    assert.ok(r.ok)
    assert.deepEqual(flat(r.pageCss), wide)
  }
  assert.ok(wide.some(r => r.includes('data-tip')))
  assert.ok(wide.some(r => r.includes('transition:none')))
  assert.ok(
    wide.some(
      r => r.includes('@font-face') || r.includes('font-family:"Inter"'),
    ),
  )
})

test('compileSubtree refuses an unsafe fontBase like compilePage, and a normal one works', () => {
  const doc = siteWith([text('a', 'Hi')])
  for (const fontBase of ['/_fonts);x{}', '</style>']) {
    const r = compileSubtree(doc, 'home', 'a', { registry, fontBase })
    assert.ok(!r.ok && r.problems.length > 0 && !('pageCss' in r))
  }
  const ok = compileSubtree(doc, 'home', 'a', { registry, fontBase: '/fonts' })
  assert.ok(ok.ok)
})

test('every compile entry point refuses the same unsafe fontBase', () => {
  const doc = siteWith([text('a', 'Hi')])
  const bad = { registry, fontBase: '/_fonts);x{}' }
  assert.ok(!compilePage(doc, 'home', bad).ok)
  assert.ok(!compileSubtree(doc, 'home', 'a', bad).ok)
  const site = compileSite(doc, bad)
  assert.ok(site.problems.length > 0 && site.files.length === 0)
})

test('an unsafe fontBase and an invalid document are reported together', () => {
  const doc = siteWith([node('x', 'frame')])
  const bad = { registry, fontBase: '/_fonts);x{}' }
  for (const r of [
    compilePage(doc, 'home', bad),
    compileSubtree(doc, 'home', 'x', bad),
  ]) {
    assert.ok(!r.ok)
    assert.ok(r.problems.some(p => p.path === 'fontBase'))
    assert.ok(r.problems.some(p => p.path !== 'fontBase'))
  }
})

test('the page css written by the compiler ends with its node and page-wide rules, which pageCss relies on', () => {
  const doc = siteWith([text('a', 'Hi', { style: { base: { gap: 3 } } })])
  const p = prepare(
    doc,
    [doc.pages[0].root, doc.header, doc.footer],
    { registry, mode: 'edit' },
    'a',
  )
  const { css, rules } = p.sheet()
  assert.ok(rules.length > 0 && css.endsWith(rules))
})

test('a subtree of a page that was cut says so, as compilePage does', () => {
  const big = Array.from({ length: 10_000 }, (_, i) => ({ title: `P${i}` }))
  const outer = projectsList('out')
  outer.repeat!.max = 200
  const inner = projectsList('in')
  inner.repeat!.max = 200
  outer.children![0].children!.push(inner)
  const doc = siteWith([outer])
  const data = { rows: { projects: big } }
  const sub = compileSubtree(doc, 'home', 'out', { registry, data })
  assert.ok(sub.ok)
  assert.deepEqual(
    sub.problems.map(p => [p.code, p.path]),
    [['RESOURCE_LIMIT_EXCEEDED', 'elements']],
  )
  const whole = compilePage(doc, 'home', { registry, data, mode: 'edit' })
  assert.ok(whole.ok)
  assert.deepEqual(
    sub.problems,
    whole.problems.filter(p => p.path === 'elements'),
  )
  const small = compileSubtree(siteWith([text('t', 'Hi')]), 'home', 't', {
    registry,
  })
  assert.ok(small.ok)
  assert.deepEqual(small.problems, [])
})
