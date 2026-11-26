import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptySite, type SiteDocument } from '../../src/document/index.ts'
import { createRegistry, insertBlock } from '../../src/registry/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { LOOK, node } from '../kit.ts'
import {
  base,
  btn,
  codes,
  col,
  comp,
  fs,
  holder,
  inst,
  item,
  listOver,
  master,
  n,
  own,
  put,
  reacts,
  reg,
  reg2,
  row,
  site,
  text,
  ttl,
  withRules,
} from './helpers.ts'

test('an empty site and an inserted block are valid, and the document is not changed', () => {
  assert.deepEqual(validateSite(emptySite('x', LOOK), reg), [])
  const ins = insertBlock(reg, 'demo', 'default', 'abc')
  assert.ok(ins.ok)
  const d = site(col(ins.root))
  const before = structuredClone(d)
  assert.deepEqual(validateSite(d, reg), [])
  assert.deepEqual(d, before)
})

test('INVALID_DOCUMENT: not an object, wrong version, unknown top-level field', () => {
  for (const d of [
    null,
    1,
    'x',
    [],
    undefined,
    { ...base(), schemaVersion: 3 },
    { ...base(), schemaVersion: '1' },
    { ...base(), extra: 1 },
  ])
    assert.ok(codes(d).includes('INVALID_DOCUMENT'), JSON.stringify(d))
  const newer = validateSite({ ...base(), schemaVersion: 3 }, reg)
  assert.equal(newer.length, 1)
  assert.match(newer[0].message, /newer/)
  const extra = validateSite({ ...base(), extra: 1 }, reg)
  assert.equal(extra[0].path, 'extra')
})

test('INVALID_DOCUMENT: a page with an unknown field, a wrong type, or a repeated id or slug', () => {
  const p = base().pages[0]
  const withPage = (page: unknown, more: unknown[] = []) => ({
    ...base(),
    pages: [page, ...more],
  })
  const unknown = validateSite(withPage({ ...p, kind: 'x' }), reg)
  assert.equal(unknown[0].code, 'INVALID_DOCUMENT')
  assert.equal(unknown[0].path, 'pages.0.kind')
  for (const page of [
    null,
    { ...p, title: 1 },
    { ...p, on: 'yes' },
    { ...p, slug: 'A B' },
    { ...p, id: '' },
    { ...p, root: undefined },
  ])
    assert.ok(codes(withPage(page)).length > 0, JSON.stringify(page))
  assert.ok(
    codes(withPage(p, [{ ...p, slug: '/other' }])).includes('INVALID_DOCUMENT'),
    'same page id twice',
  )
  assert.ok(
    codes(withPage(p, [{ ...p, id: 'two' }])).includes('INVALID_DOCUMENT'),
    'same slug twice',
  )
  assert.deepEqual(
    validateSite(
      withPage(p, [
        { ...p, id: 'two', slug: '/two', root: node('t2', 'column') },
      ]),
      reg,
    ),
    [],
  )
})

test('INVALID_DOCUMENT: a slug is a site path beginning with a slash', () => {
  const p = base().pages[0]
  const at = (slug: string) =>
    validateSite({ ...base(), pages: [{ ...p, slug }] }, reg)
  for (const slug of ['/', '/about', '/a/b', '/a-b/c1'])
    assert.deepEqual(at(slug), [], slug)
  // the slugs that used to map to one file with another page's
  for (const slug of [
    '',
    'about',
    '/about/',
    '//',
    '//a',
    '/a//b',
    '/a b',
    '/a?x=1',
    '/a#top',
    '/About',
    '/a_b',
    '/..',
    '/a/../b',
    '/.',
    '/a\\b',
    '/a/./b',
    'about/',
  ])
    assert.equal(at(slug)[0]?.path, 'pages.0.slug', JSON.stringify(slug))
})

test('INVALID_DOCUMENT: name, header, footer, components, fonts, look, styles and languages', () => {
  const bad = (more: object) => codes({ ...base(), ...more })
  assert.ok(bad({ name: 3 }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ header: null }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ footer: 'x' }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ pages: {} }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ components: {} }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ fonts: ['Arial'] }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ fonts: ['cat:nope'] }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ look: null }).includes('INVALID_DOCUMENT'))
  assert.ok(
    bad({ look: { ...LOOK, brand: 'red' } }).includes('INVALID_DOCUMENT'),
  )
  assert.ok(
    bad({ look: { ...LOOK, headingFont: 'Arial' } }).includes(
      'INVALID_DOCUMENT',
    ),
  )
  assert.ok(bad({ styles: { colors: 1 } }).includes('INVALID_DOCUMENT'))
  assert.ok(bad({ languages: [{ code: 'x y' }] }).includes('INVALID_DOCUMENT'))
  assert.ok(
    bad({ languages: [{ code: 'en' }, { code: 'en' }] }).includes(
      'INVALID_DOCUMENT',
    ),
  )
  assert.ok(
    bad({ languages: [{ code: 'ar', dir: 'up' }] }).includes(
      'INVALID_DOCUMENT',
    ),
  )
  assert.deepEqual(
    validateSite(
      { ...base(), languages: [{ code: 'en' }, { code: 'ar', dir: 'rtl' }] },
      reg,
    ),
    [],
  )
})

test('validateSite never throws, whatever it is given', () => {
  const boom = {
    get schemaVersion(): number {
      throw new Error('x')
    },
  }
  const cyc: Record<string, unknown> = { ...base() }
  cyc.header = cyc
  for (const d of [
    boom,
    cyc,
    new Proxy(
      {},
      {
        get: () => {
          throw new Error('y')
        },
      },
    ),
    { ...base(), pages: [{ root: boom }] },
  ])
    assert.ok(Array.isArray(validateSite(d, reg)))
})

test('site styles are checked: grammar, hex values, unique ids; the look is checked too', () => {
  const ok = own()
  assert.deepEqual(validateSite({ ...base(), styles: ok }, reg), [])
  const bad = (styles: unknown) => validateSite({ ...base(), styles }, reg)
  for (const styles of [
    { ...ok, colors: [{ id: 'A b', name: 'x', value: '#ffffff' }] },
    { ...ok, colors: [{ id: 'a', name: 'x', value: 'red' }] },
    { ...ok, colors: [{ id: 'a', name: 'x', value: '#fff' }] },
    {
      ...ok,
      colors: [
        { id: 'a', name: 'x', value: '#ffffff' },
        { id: 'a', name: 'y', value: '#000000' },
      ],
    },
    {
      ...ok,
      text: [{ id: 't', name: 'T', decl: { color: { style: 'gone' } } }],
    },
    { ...ok, space: { ...ok.space, m: -1 } },
    { ...ok, motion: 'fast' },
    { ...ok, extra: 1 },
  ]) {
    const p = bad(styles)
    assert.ok(
      p.length > 0 &&
        p.every(x => x.code === 'INVALID_DOCUMENT' && x.path === 'styles'),
      JSON.stringify(styles),
    )
  }
  assert.deepEqual(
    validateSite({ ...base(), styles: { ...ok, motion: 'off' } }, reg),
    [],
  )
  assert.deepEqual(
    validateSite(
      {
        ...base(),
        styles: { ...ok, colors: [{ id: 'a', name: 'x', value: '#ff880080' }] },
      },
      reg,
    ),
    [],
  )
  const faint = validateSite(
    { ...base(), look: { ...LOOK, ink: '#fafafa' } },
    reg,
  )
  assert.ok(
    faint.length > 0 &&
      faint.every(x => x.code === 'INVALID_DOCUMENT' && x.path === 'look'),
  )
})

test("a rule's problems are returned with the rule's name, and a rule that throws is reported as POLICY_VIOLATION", () => {
  const r = withRules([
    {
      name: 'no-video',
      check: () => [
        { code: 'POLICY_VIOLATION', message: 'No video on this plan' },
      ],
    },
    {
      name: 'boom',
      check: () => {
        throw new Error('x')
      },
    },
  ])
  const ps = validateSite(emptySite('x', LOOK), r)
  assert.deepEqual(
    ps.map(p => [p.code, p.rule]),
    [
      ['POLICY_VIOLATION', 'no-video'],
      ['POLICY_VIOLATION', 'boom'],
    ],
  )
  assert.equal(ps[0].message, 'No video on this plan')
})

test("a rule sees the document, may name a node and a path, and cannot claim another rule's name", () => {
  const seen: string[] = []
  const r = withRules([
    {
      name: 'videos',
      check: doc => {
        seen.push(doc.name)
        return doc.pages.flatMap(p =>
          (p.root.children ?? [])
            .filter(k => k.kind === 'video')
            .map(k => ({
              code: 'POLICY_VIOLATION' as const,
              message: 'No video.',
              nodeId: k.id,
              path: 'kind',
              rule: 'someone-else',
            })),
        )
      },
    },
  ])
  const d = put({
    id: 'v',
    kind: 'video',
    name: 'V',
    slot: fs(),
    props: { assetId: 'a' },
  })
  const ps = validateSite(d, r)
  assert.deepEqual(seen, ['x'])
  assert.deepEqual(
    ps.map(p => [p.code, p.nodeId, p.path, p.rule]),
    [['POLICY_VIOLATION', 'v', 'kind', 'videos']],
  )
})

test('rules run after the checks of the tree, and not on a document that is not a site', () => {
  let ran = 0
  const r = withRules([
    {
      name: 'count',
      check: () => {
        ran++
        return []
      },
    },
  ])
  const withBadNode = site(
    col(n({ id: 'a', kind: 'carousel', name: 'A', slot: {} })),
  )
  assert.deepEqual(
    validateSite(withBadNode, r).map(p => p.code),
    ['UNKNOWN_KIND'],
  )
  assert.equal(ran, 1, 'a bad node does not stop the rules')
  validateSite({ ...base(), extra: 1 }, r)
  validateSite(null, r)
  assert.equal(ran, 1, 'a document with the wrong shape never reaches them')
})

test('a rule that returns something else than problems is one POLICY_VIOLATION; a rule cannot change the document', () => {
  const r = withRules([
    { name: 'odd', check: (() => 'fine') as never },
    { name: 'odd2', check: (() => [1, null]) as never },
    {
      name: 'mutates',
      check: doc => {
        doc.name = 'changed'
        doc.pages.length = 0
        return []
      },
    },
  ])
  const d = base()
  const before = structuredClone(d)
  const ps = validateSite(d, r)
  assert.deepEqual(
    ps.map(p => [p.code, p.rule]),
    [
      ['POLICY_VIOLATION', 'odd'],
      ['POLICY_VIOLATION', 'odd2'],
    ],
  )
  assert.deepEqual(d, before)
})

test('validateSite never changes the document', () => {
  const d = put(
    holder({}, [
      btn('b1', [{ on: 'click', do: { set: 'tab', to: 'papers' } }]),
      reacts('t1'),
    ]),
    listOver('projects', [item([ttl({ label: row('title') })])]),
    { id: 'bad', kind: 'carousel', name: 'B', slot: fs() },
  )
  const dc = {
    ...d,
    components: [
      comp('card'),
      comp('b', master([inst('x', 'b')]), { props: [] }),
    ],
  }
  const before = structuredClone(dc)
  assert.ok(validateSite(dc, reg).length > 0)
  assert.deepEqual(dc, before)
})

// A rich valid document: text with a bound run and a link, a button with a trigger, a holder with a state and a layer,
// a list over a source, an instance with values and overrides, and a component with a choice property and a look.
const rich = (): SiteDocument => {
  const component = comp(
    'card',
    node('root', 'box', [text('title'), text('badge')]),
    {
      props: [
        {
          key: 'look',
          label: 'Look',
          type: 'choice',
          options: ['default', 'big'],
        },
        {
          key: 'title',
          label: 'Title',
          type: 'text',
          part: 'title',
          field: 'text',
        },
      ],
      variants: [
        {
          when: { look: 'big' },
          patch: { title: { style: { base: { size: 30 } } } },
        },
      ],
    },
  )
  const d = put(
    holder({}, [
      btn('b1', [{ on: 'click', do: { set: 'tab', to: 'papers' } }]),
      reacts('t1'),
    ]),
    listOver('projects', [
      item([
        ttl({ label: row('title') }),
        {
          id: 'rb',
          kind: 'text',
          name: 'R',
          slot: {},
          props: { level: 'p', runs: [{ text: '', bind: row('title') }] },
        },
      ]),
    ]),
    {
      id: 'i1',
      kind: 'instance',
      name: 'Card',
      slot: fs(),
      component: 'card',
      set: { title: 'Hi' },
      overrides: { badge: { props: { runs: [{ text: 'New' }] } } },
    },
  )
  return { ...d, components: [component] }
}

const paths = (
  v: unknown,
  at: (string | number)[] = [],
): (string | number)[][] =>
  v && typeof v === 'object'
    ? Object.entries(v).flatMap(([k, x]) =>
        paths(x, [...at, Array.isArray(v) ? Number(k) : k]),
      )
    : [at]
const setAt = (d: unknown, at: (string | number)[], v: unknown) => {
  let o = d as Record<string | number, unknown>
  for (const k of at.slice(0, -1)) o = o[k] as Record<string | number, unknown>
  o[at[at.length - 1]] = v
}

test('wrong values at every level are reported where they are, never by the catch-all', () => {
  assert.deepEqual(validateSite(rich(), reg2), [])
  const wrong: unknown[] = [
    null,
    0,
    1.5,
    '',
    'x',
    true,
    [],
    {},
    [null],
    { x: 1 },
    { style: null },
    [1, 'a'],
    { toString: 1 },
  ]
  let checked = 0
  for (const at of paths(rich())) {
    if (!at.length) continue
    for (const v of wrong) {
      const d = rich()
      setAt(d, at, structuredClone(v))
      const ps = validateSite(d, reg2)
      checked++
      for (const p of ps) {
        const where = `${at.join('.')} = ${JSON.stringify(v)}`
        assert.notEqual(p.message, 'The document could not be checked.', where)
        assert.ok(
          p.path !== undefined || p.nodeId !== undefined,
          `${where}: ${p.message}`,
        )
      }
    }
  }
  assert.ok(checked > 1000)
})

test('the inputs that used to reach the catch-all are reported with a path', () => {
  const at = (mutate: (d: SiteDocument) => void) => {
    const d = rich()
    mutate(d)
    return validateSite(d, reg2)
  }
  const fine = (ps: ReturnType<typeof validateSite>) =>
    ps.length > 0 &&
    ps.every(
      p =>
        p.message !== 'The document could not be checked.' &&
        (p.path !== undefined || p.nodeId !== undefined),
    )
  assert.ok(
    fine(at(d => void ((d.components[0].props as unknown[])[1] = null))),
  )
  assert.ok(
    fine(
      at(
        d =>
          void ((d.components[0].props[0] as { options: unknown }).options = 1),
      ),
    ),
  )
  assert.ok(
    fine(
      at(
        d =>
          void ((d.components[0].props[1] as { field: unknown }).field = {
            x: 1,
          }),
      ),
    ),
  )
  assert.ok(
    fine(
      at(d => {
        const t = d.pages[0].root.children![0].children![1]
        t.style = { when: null } as never
      }),
    ),
  )
})

test('a look or a site-style entry with a field this version does not know is refused', () => {
  const ok = own()
  const bad = (more: object) => validateSite({ ...base(), ...more }, reg)
  const look = bad({ look: { ...LOOK, extra: 1 } })
  assert.deepEqual(
    look.map(p => [p.code, p.path]),
    [['INVALID_DOCUMENT', 'look.extra']],
  )
  const entry = (key: 'colors' | 'text' | 'shadows', e: object) =>
    bad({ styles: { ...ok, [key]: [{ ...ok[key][0], ...e }] } })
  assert.deepEqual(
    entry('colors', { extra: 1 }).map(p => [p.code, p.path]),
    [['INVALID_DOCUMENT', 'styles.colors.0.extra']],
  )
  assert.deepEqual(
    entry('text', { extra: 1 }).map(p => [p.code, p.path]),
    [['INVALID_DOCUMENT', 'styles.text.0.extra']],
  )
  assert.deepEqual(
    entry('shadows', { extra: 1 }).map(p => [p.code, p.path]),
    [['INVALID_DOCUMENT', 'styles.shadows.0.extra']],
  )
  const space = bad({ styles: { ...ok, space: { ...ok.space, huge: 1 } } })
  assert.ok(space.every(p => p.code === 'INVALID_DOCUMENT'))
  assert.ok(space.some(p => p.path === 'styles.space.huge'))
})

test('a rule problem is copied field by field: only known, short fields of the right type reach the result', () => {
  const r = createRegistry()
  r.use({
    name: 'loud',
    version: 1,
    api: [1],
    rules: [
      {
        name: 'loud',
        check: () =>
          [
            {
              code: 'POLICY_VIOLATION',
              message: 'm'.repeat(5000),
              nodeId: 7,
              path: 'p'.repeat(5000),
              allowed: [1, 2],
              extra: { big: true },
            },
          ] as never,
      },
    ],
  } as never)
  const [p] = validateSite(base(), r)
  assert.equal(p.rule, 'loud')
  assert.equal(p.message.length, 500)
  assert.equal('nodeId' in p, false)
  assert.equal(p.path!.length, 200)
  assert.equal('allowed' in p, false)
  assert.equal('extra' in p, false)
})

test('a page id must be an id', () => {
  const p = base().pages[0]
  for (const id of ['header', 'footer', 'a b/..']) {
    const r = validateSite({ ...base(), pages: [{ ...p, id }] }, reg)
    assert.equal(r[0].code, 'INVALID_DOCUMENT', id)
    assert.equal(r[0].path, 'pages.0.id', id)
  }
})
