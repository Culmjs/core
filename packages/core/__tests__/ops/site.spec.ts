import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SiteDocument } from '../../src/document/index.ts'
import * as ops from '../../src/ops/site.ts'
import type { OpResult } from '../../src/ops/types.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { node, sampleRegistry, siteWith, twoPages } from '../kit.ts'

const reg = sampleRegistry()
const base = (): SiteDocument =>
  twoPages([node('b', 'box')], [node('c', 'box')])

const run = (name: keyof typeof ops, doc: SiteDocument, op: object): OpResult =>
  (ops[name] as (d: SiteDocument, r: typeof reg, o: object) => OpResult)(
    doc,
    reg,
    { op: name, ...op },
  )
const ok = (r: OpResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const refused = (r: OpResult, code: string, more: object = {}) => {
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, code)
  assert.partialDeepStrictEqual(r.problems[0], more)
}
const invalid = (r: OpResult, more: object = {}) =>
  refused(r, 'INVALID_OPERATION', more)
const ids = (d: SiteDocument) => d.pages.map(p => p.id)

test('addPage adds a page with the defaults and lists its root as created', () => {
  const r = ok(run('addPage', base(), { title: 'News', slug: '/news' }))
  assert.deepEqual(ids(r.doc!), ['home', 'about', 'p1'])
  const p = r.doc!.pages[2]
  assert.deepEqual(p, {
    id: 'p1',
    title: 'News',
    slug: '/news',
    icon: '',
    on: true,
    inMenu: false,
    inFooter: false,
    root: { id: 'n1', kind: 'column', name: 'Page', slot: {} },
  })
  assert.deepEqual(r.created, [{ tree: { page: 'p1' }, id: 'n1' }])
  assert.deepEqual(r.changed, [])
})

test('addPage takes the lowest unused p id and the next n id', () => {
  let d = ok(run('addPage', base(), { title: 'A', slug: '/a' })).doc!
  d = ok(run('addPage', d, { title: 'B', slug: '/b' })).doc!
  assert.deepEqual(ids(d), ['home', 'about', 'p1', 'p2'])
  d = ok(run('removePage', d, { page: 'p1' })).doc!
  d = ok(run('addPage', d, { title: 'C', slug: '/c' })).doc!
  assert.equal(d.pages.at(-1)!.id, 'p1')
  assert.equal(d.pages.at(-1)!.root.id, 'n1')
})

test('addPage takes the given fields', () => {
  const r = ok(
    run('addPage', base(), {
      title: 'X',
      slug: '/x',
      page: 'xx',
      index: 1,
      on: false,
      inMenu: true,
      inFooter: true,
      icon: 'star',
    }),
  )
  assert.deepEqual(ids(r.doc!), ['home', 'xx', 'about'])
  assert.partialDeepStrictEqual(r.doc!.pages[1], {
    on: false,
    inMenu: true,
    inFooter: true,
    icon: 'star',
  })
})

test('addPage refusals: a page id in use; an id that does not match the id rule; a bad index', () => {
  const t = { title: 'X', slug: '/x' }
  invalid(run('addPage', base(), { ...t, page: 'about' }), { path: 'page' })
  for (const page of ['Bad', '', 'a'.repeat(21), 'a-b', 3])
    invalid(run('addPage', base(), { ...t, page }), { path: 'page' })
  for (const index of [-1, 3, 1.5, '1', null])
    invalid(run('addPage', base(), { ...t, index }), { path: 'index' })
  invalid(run('addPage', base(), { slug: '/x' }), { path: 'title' })
  invalid(run('addPage', base(), { title: 'X' }), { path: 'slug' })
  invalid(run('addPage', base(), { ...t, on: 'yes' }), { path: 'on' })
  invalid(run('addPage', base(), { ...t, inMenu: 1 }), { path: 'inMenu' })
  invalid(run('addPage', base(), { ...t, inFooter: 1 }), { path: 'inFooter' })
  invalid(run('addPage', base(), { ...t, icon: 1 }), { path: 'icon' })
})

test('removePage removes the page', () => {
  const r = ok(run('removePage', base(), { page: 'about' }))
  assert.deepEqual(ids(r.doc!), ['home'])
  assert.deepEqual([r.created, r.changed], [[], []])
})

test('removePage is refused for the last page', () => {
  invalid(run('removePage', siteWith([]), { page: 'home' }), { path: 'page' })
})

test('removePage refuses an unknown or missing page', () => {
  invalid(run('removePage', base(), { page: 'zz' }), { path: 'page' })
  invalid(run('removePage', base(), {}), { path: 'page' })
})

test('removePage is refused for a page that holds a required node', () => {
  const d = base()
  d.pages[1].root.children![0].required = true
  refused(run('removePage', d, { page: 'about' }), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'c',
  })
})

test('setPage sets the given fields only', () => {
  const r = ok(
    run('setPage', base(), {
      page: 'about',
      title: 'T',
      slug: '/t',
      on: false,
      inMenu: false,
      inFooter: true,
      icon: 'i',
    }),
  )
  assert.deepEqual(r.doc!.pages[1], {
    ...base().pages[1],
    title: 'T',
    slug: '/t',
    on: false,
    inMenu: false,
    inFooter: true,
    icon: 'i',
  })
  assert.deepEqual(r.doc!.pages[0], base().pages[0])
  assert.deepEqual([r.created, r.changed], [[], []])
})

test('setPage with on false is allowed for a page that holds a required node', () => {
  const d = base()
  d.pages[1].root.children![0].required = true
  ok(run('setPage', d, { page: 'about', on: false }))
})

test('setPage with no field is refused; with an unknown page is refused', () => {
  invalid(run('setPage', base(), { page: 'about' }))
  invalid(run('setPage', base(), { page: 'zz', title: 'T' }), { path: 'page' })
  invalid(run('setPage', base(), { title: 'T' }), { path: 'page' })
  invalid(run('setPage', base(), { page: 'about', title: 1 }), {
    path: 'title',
  })
  invalid(run('setPage', base(), { page: 'about', slug: null }), {
    path: 'slug',
  })
  invalid(run('setPage', base(), { page: 'about', on: 'x' }), { path: 'on' })
  invalid(run('setPage', base(), { page: 'about', inMenu: 0 }), {
    path: 'inMenu',
  })
  invalid(run('setPage', base(), { page: 'about', inFooter: 0 }), {
    path: 'inFooter',
  })
  invalid(run('setPage', base(), { page: 'about', icon: 0 }), { path: 'icon' })
})

test('a duplicate slug is not refused by setPage itself', () => {
  const r = ok(run('setPage', base(), { page: 'about', slug: '/' }))
  assert.ok(validateSite(r.doc, reg).length > 0)
})

test('movePage moves the page to the index', () => {
  const r = ok(run('movePage', base(), { page: 'about', index: 0 }))
  assert.deepEqual(ids(r.doc!), ['about', 'home'])
  assert.deepEqual([r.created, r.changed], [[], []])
  const d = ok(run('addPage', base(), { title: 'A', slug: '/a' })).doc!
  assert.deepEqual(
    ids(ok(run('movePage', d, { page: 'home', index: 2 })).doc!),
    ['about', 'p1', 'home'],
  )
})

test('movePage refusals', () => {
  invalid(run('movePage', base(), { page: 'zz', index: 0 }), { path: 'page' })
  for (const index of [-1, 2, 0.5, '0', undefined])
    invalid(run('movePage', base(), { page: 'about', index }), {
      path: 'index',
    })
})

test('setSite replaces name and languages and leaves the rest', () => {
  const langs = [{ code: 'fa', dir: 'rtl' }, { code: 'en' }]
  const r = ok(run('setSite', base(), { name: 'New', languages: langs }))
  assert.deepEqual(r.doc, { ...base(), name: 'New', languages: langs })
  assert.equal(ok(run('setSite', base(), { name: 'N' })).doc!.name, 'N')
  assert.deepEqual(
    ok(run('setSite', base(), { languages: [] })).doc!.languages,
    [],
  )
})

test('setSite refusals', () => {
  invalid(run('setSite', base(), {}))
  invalid(run('setSite', base(), { name: 1 }), { path: 'name' })
  invalid(run('setSite', base(), { languages: 'en' }), { path: 'languages' })
  invalid(
    run('setSite', base(), { languages: [JSON.parse('{"__proto__":1}')] }),
  )
})

test('setLook, setSite and setFonts replace the value and leave the rest', () => {
  const look = { ...base().look, brand: '#123456' }
  const l = ok(run('setLook', base(), { look }))
  assert.deepEqual(l.doc, { ...base(), look })
  const fonts = ['sys:mono']
  const f = ok(run('setFonts', base(), { fonts }))
  assert.deepEqual(f.doc, { ...base(), fonts })
  assert.deepEqual(
    [l.created, l.changed, f.created, f.changed],
    [[], [], [], []],
  )
})

test('setLook and setFonts refusals', () => {
  invalid(run('setLook', base(), {}), { path: 'look' })
  invalid(run('setLook', base(), { look: [] }), { path: 'look' })
  invalid(run('setLook', base(), { look: null }), { path: 'look' })
  invalid(
    run('setLook', base(), { look: JSON.parse('{"__proto__":{"x":1}}') }),
    { path: 'look.__proto__' },
  )
  invalid(run('setFonts', base(), {}), { path: 'fonts' })
  invalid(run('setFonts', base(), { fonts: 'sys:mono' }), { path: 'fonts' })
})

test('setSiteStyles on a site with no styles starts from defaultSiteStyles(look)', () => {
  const d = base()
  assert.equal(d.styles, undefined)
  const space = { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 }
  const r = ok(run('setSiteStyles', d, { styles: { space } }))
  assert.deepEqual(r.doc!.styles, { ...defaultSiteStyles(d.look), space })
})

test('setSiteStyles replaces only the keys given and null removes textRange', () => {
  const d = base()
  d.styles = {
    ...defaultSiteStyles(d.look),
    textRange: { min: 12, max: 40 },
    motion: 'off',
  }
  const a = ok(run('setSiteStyles', d, { styles: { colors: [] } }))
  assert.deepEqual(a.doc!.styles, { ...d.styles, colors: [] })
  const b = ok(
    run('setSiteStyles', d, { styles: { textRange: null, motion: null } }),
  )
  const { textRange, motion, ...rest } = d.styles
  assert.ok(textRange && motion)
  assert.deepEqual(b.doc!.styles, rest)
  const c = ok(
    run('setSiteStyles', d, { styles: { textRange: { min: 10, max: 20 } } }),
  )
  assert.deepEqual(c.doc!.styles!.textRange, { min: 10, max: 20 })
})

test('setSiteStyles refusals', () => {
  invalid(run('setSiteStyles', base(), {}), { path: 'styles' })
  invalid(run('setSiteStyles', base(), { styles: [] }), { path: 'styles' })
  invalid(run('setSiteStyles', base(), { styles: {} }))
  for (const k of ['colors', 'text', 'space', 'shadows'])
    invalid(run('setSiteStyles', base(), { styles: { [k]: null } }), {
      path: `styles.${k}`,
    })
  invalid(run('setSiteStyles', base(), { styles: { nope: 1 } }), {
    path: 'styles.nope',
    allowed: ['colors', 'text', 'space', 'shadows', 'motion', 'textRange'],
  })
  invalid(
    run('setSiteStyles', base(), {
      styles: { colors: JSON.parse('[{"__proto__":1}]') },
    }),
    { path: 'styles.colors.0.__proto__' },
  )
})

const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}
test('no site operation changes its input', () => {
  const calls: [keyof typeof ops, object][] = [
    ['addPage', { title: 'N', slug: '/n', index: 0 }],
    ['removePage', { page: 'about' }],
    ['setPage', { page: 'about', title: 'T', on: false }],
    ['movePage', { page: 'about', index: 0 }],
    ['setSite', { name: 'N', languages: [{ code: 'en' }] }],
    ['setLook', { look: { ...base().look, brand: '#000000' } }],
    ['setSiteStyles', { styles: { textRange: null, motion: 'off' } }],
    ['setFonts', { fonts: ['sys:serif'] }],
  ]
  for (const [name, op] of calls) {
    const doc = deepFreeze(base())
    const before = structuredClone(doc)
    ok(run(name, doc, op))
    assert.deepEqual(doc, before, name)
  }
  const styled = base()
  styled.styles = {
    ...defaultSiteStyles(styled.look),
    textRange: { min: 1, max: 2 },
  }
  deepFreeze(styled)
  ok(run('setSiteStyles', styled, { styles: { textRange: null } }))
})

// ---- the shape of a refusal about a page: a page id is not a node id
const noNodeId = (r: OpResult) => {
  assert.ok(!r.ok)
  assert.equal(r.problems[0].nodeId, undefined, JSON.stringify(r.problems[0]))
}
test('a refusal about a page names it by path "page" and carries no nodeId', () => {
  const t = { title: 'X', slug: '/x' }
  for (const [name, op, path] of [
    ['addPage', { ...t, page: 'about' }, 'page'],
    ['addPage', { ...t, page: 'Bad' }, 'page'],
    ['removePage', { page: 'zz' }, 'page'],
    ['removePage', {}, 'page'],
    ['setPage', { page: 'zz', title: 'T' }, 'page'],
    ['movePage', { page: 'zz', index: 0 }, 'page'],
    ['movePage', { page: 'about', index: 5 }, 'index'],
  ] as const) {
    const r = run(name, base(), op)
    invalid(r, { path })
    noNodeId(r)
  }
  const last = run('removePage', siteWith([]), { page: 'home' })
  invalid(last, { path: 'page' })
  noNodeId(last)
})

test('refusals with no field to point at say so: setPage with no field, setSite {}', () => {
  for (const r of [
    run('setPage', base(), { page: 'about' }),
    run('setSite', base(), {}),
  ]) {
    invalid(r)
    noNodeId(r)
    assert.ok(!r.ok)
    assert.equal(r.problems[0].path, undefined)
  }
})

test('setSiteStyles with no key points at styles; an unsafe key in languages is named in full', () => {
  const r = run('setSiteStyles', base(), { styles: {} })
  invalid(r, { path: 'styles' })
  noNodeId(r)
  const u = run('setSite', base(), {
    languages: [JSON.parse('{"__proto__":1}')],
  })
  invalid(u, { path: 'languages.0.__proto__' })
  noNodeId(u)
})

test('removePage is refused when the page holds the last use of a component with a required node, and accepted while another page uses it', () => {
  const use = (id: string) => ({
    id,
    kind: 'instance' as const,
    name: id,
    slot: {},
    component: 'card',
  })
  const d = twoPages([node('b', 'box')], [use('u1')])
  d.components = [
    {
      id: 'card',
      name: 'Card',
      root: node('croot', 'box', [{ ...node('req', 'box'), required: true }]),
      props: [],
      variants: [],
    },
  ]
  assert.deepEqual(validateSite(d, reg), [])
  const r = run('removePage', d, { page: 'about' })
  refused(r, 'POLICY_VIOLATION', { rule: 'required', nodeId: 'req' })
  assert.ok(!r.ok)
  assert.match(r.problems[0].message, /component "card"/)
  // a second use on the home page keeps it
  d.pages[0].root.children!.push(use('u2'))
  ok(run('removePage', d, { page: 'about' }))
})
