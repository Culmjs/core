import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emptySite,
  migrate,
  MigrationError,
  previewMigration,
  SCHEMA_VERSION,
  type MigrationStep,
} from '../../src/document/index.ts'
import { LOOK, node, siteWith, text } from '../kit.ts'

const v = (n: number, more = {}) => ({ schemaVersion: n, name: 'x', ...more })
const steps: MigrationStep[] = [
  { from: 1, migrate: (d: object) => ({ ...d, schemaVersion: 2, a: true }) },
  { from: 2, migrate: (d: object) => ({ ...d, schemaVersion: 3, b: true }) },
]

test('a current document comes back equal and is a different object', () => {
  const d = emptySite('x', LOOK)
  const r = migrate(d)
  assert.ok(r.ok)
  assert.deepEqual(r.doc, d)
  assert.notEqual(r.doc, d)
  assert.equal(r.from, SCHEMA_VERSION)
})

test("steps run in order from the document's version to the target", () => {
  const r = migrate(v(1), steps, 3)
  assert.ok(r.ok)
  assert.deepEqual(r.doc, { schemaVersion: 3, name: 'x', a: true, b: true })
  assert.equal(r.from, 1)
})

test('the input is never changed, even by a step that writes to its argument', () => {
  const mutating: MigrationStep[] = [
    {
      from: 1,
      migrate: (d: unknown) => {
        const o = d as Record<string, unknown>
        o.a = true
        o.schemaVersion = 2
        return o
      },
    },
  ]
  const d = v(1)
  const r = migrate(d, mutating, 2)
  assert.ok(r.ok)
  assert.deepEqual(d, v(1))
  assert.ok(migrate(Object.freeze(v(1)), mutating, 2).ok)
})

test('a document that cannot be copied is refused, not thrown', () => {
  const r = migrate(v(1, { f: () => 1 }))
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
})

test('a step that returns a non-object or the wrong version is refused', () => {
  for (const out of [null, 5, { schemaVersion: 1 }, { schemaVersion: 3 }]) {
    const r = migrate(v(1), [{ from: 1, migrate: () => out }], 2)
    assert.ok(!r.ok)
    assert.equal(r.problem.code, 'INVALID_DOCUMENT')
    assert.match(r.problem.message, /version 1/)
  }
})

test('a thrown non-Error keeps its message', () => {
  const r = migrate(
    v(1),
    [
      {
        from: 1,
        migrate: () => {
          throw 'oops'
        },
      },
    ],
    2,
  )
  assert.ok(!r.ok)
  assert.match(r.problem.message, /oops/)
})

test('a newer document is refused', () => {
  const r = migrate(v(9))
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  assert.match(r.problem.message, /newer/)
})

test('a missing or non-integer version, or a non-object, is refused', () => {
  for (const d of [null, 3, 'x', {}, v(1.5), v(0)]) {
    const r = migrate(d)
    assert.ok(!r.ok)
    assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  }
})

test('a missing step is refused and names the version it stopped at', () => {
  const r = migrate(v(1), [steps[1]], 3)
  assert.ok(!r.ok)
  assert.match(r.problem.message, /1/)
})

test("a step that cannot migrate a node reports that node's path", () => {
  const bad: MigrationStep[] = [
    {
      from: 1,
      migrate: () => {
        throw new MigrationError('pages.0.root.children.2', 'no such kind')
      },
    },
  ]
  const r = migrate(v(1), bad, 2)
  assert.ok(!r.ok)
  assert.equal(r.problem.path, 'pages.0.root.children.2')
})

test('any other throw from a step becomes a problem with an empty path', () => {
  const bad: MigrationStep[] = [
    {
      from: 1,
      migrate: () => {
        throw new Error('boom')
      },
    },
  ]
  const r = migrate(v(1), bad, 2)
  assert.ok(!r.ok)
  assert.equal(r.problem.code, 'INVALID_DOCUMENT')
  assert.equal(r.problem.path, '')
})

test('previewMigration is migrate, and emptySite uses SCHEMA_VERSION', () => {
  assert.equal(previewMigration, migrate)
  assert.equal(emptySite('x', LOOK).schemaVersion, SCHEMA_VERSION)
})

test('a document whose schemaVersion throws, or a step that throws a bare object, is a problem and not a throw', () => {
  const trap = {
    get schemaVersion(): number {
      throw new Error('boom')
    },
  }
  const r = migrate(trap)
  assert.equal(r.ok, false)
  const bare = migrate(
    v(1),
    [
      {
        from: 1,
        migrate: () => {
          throw Object.create(null)
        },
      },
    ],
    2,
  )
  assert.equal(bare.ok, false)
})

const v1 = () => {
  const d = siteWith([
    { ...node('f', 'form', [node('i', 'field')]), hide: { phone: true } },
    node('f2', 'form'),
    text('t', 'x', { hide: { phone: true } }),
  ])
  d.schemaVersion = 1
  d.header = node('header', 'column', [
    { ...node('hf', 'form'), style: { hover: { hidden: true } } },
  ])
  d.components = [
    {
      id: 'c',
      name: 'c',
      props: [],
      root: node('cr', 'column', [node('cf', 'form'), node('cg', 'field')]),
      variants: [{ when: {}, patch: { cf: { hide: { desktop: true } } } }],
    },
  ]
  d.pages[0].root.children!.push({
    ...node('inst', 'instance'),
    component: 'c',
    overrides: { cg: { style: { base: { hidden: true } } } },
  })
  return d as unknown as Record<string, unknown>
}

test('a version 1 document migrates, and the input is unchanged', () => {
  const d = v1()
  const before = structuredClone(d)
  const r = migrate(d)
  assert.ok(r.ok)
  assert.equal(r.from, 1)
  assert.equal(r.doc.schemaVersion, 2)
  assert.deepEqual(d, before)
})

test('a version 1 form hidden on phone carries required: false after migration', () => {
  const r = migrate(v1())
  assert.ok(r.ok)
  const page = r.doc.pages[0].root.children!
  // hidden form, and the field inside it (hidden through its ancestor)
  assert.equal(page[0].required, false)
  assert.equal(page[0].children![0].required, false)
  // a form that is not hidden gets no field; a hidden text is not a form
  assert.equal('required' in page[1], false)
  assert.equal('required' in page[2], false)
  // header, and a component's parts (variant patch, instance override)
  assert.equal(r.doc.header.children![0].required, false)
  const parts = r.doc.components[0].root.children!
  assert.equal(parts[0].required, false)
  assert.equal(parts[1].required, false)
})

test('a version 1 form hidden by a look: required: false only when a use selects the look', () => {
  const make = (set?: object) => {
    const d = siteWith([
      {
        ...node('inst', 'instance'),
        component: 'c',
        ...(set ? { set } : {}),
      } as never,
    ])
    d.schemaVersion = 1
    d.components = [
      {
        id: 'c',
        name: 'c',
        props: [
          { key: 'look', label: 'Look', type: 'choice', options: ['a', 'b'] },
        ],
        root: node('cr', 'column', [node('cf', 'form')]),
        variants: [
          { when: { look: 'b' }, patch: { cf: { hide: { phone: true } } } },
        ],
      },
    ]
    return d as unknown as Record<string, unknown>
  }
  const formOf = (d: Record<string, unknown>) => {
    const r = migrate(d)
    assert.ok(r.ok)
    return r.doc.components[0].root.children![0]
  }
  assert.equal(formOf(make({ look: 'b' })).required, false)
  assert.equal('required' in formOf(make()), false)
  assert.equal('required' in formOf(make({ look: 'a' })), false)
})

test('a version 1 form that is not hidden gets no required field', () => {
  const d = siteWith([node('f', 'form')])
  d.schemaVersion = 1
  const r = migrate(d)
  assert.ok(r.ok)
  assert.equal('required' in r.doc.pages[0].root.children![0], false)
})

test('a version 2 document passes through, and a version 3 document is refused', () => {
  const d = emptySite('x', LOOK)
  const ok = migrate(d)
  assert.ok(ok.ok)
  assert.deepEqual(ok.doc, d)
  const r = migrate({ ...d, schemaVersion: 3 })
  assert.ok(!r.ok)
  assert.match(r.problem.message, /newer/)
})

test('a malformed version 1 document migrates without a throw, and validation reports it later', () => {
  const base = () =>
    ({ ...siteWith([]), schemaVersion: 1 }) as Record<string, unknown>
  const docs = [
    { ...base(), pages: 5 },
    { ...base(), pages: [{ id: 'p', root: null }] },
    (() => {
      const d = base()
      delete d.components
      return d
    })(),
    {
      ...base(),
      header: null,
      components: [null, { id: 'c', root: { children: {} } }],
    },
    { ...base(), pages: [{ id: 'p', root: { id: 'r', children: [null, 3] } }] },
  ]
  for (const d of docs) {
    const r = migrate(d)
    assert.ok(r.ok, JSON.stringify(d).slice(0, 60))
    assert.equal(r.doc.schemaVersion, 2)
  }
})

test('a form is not made optional by a same-named part of another component', () => {
  const d = siteWith([
    {
      ...node('i', 'instance'),
      component: 'o',
      overrides: { p: { hide: { phone: true } } },
    },
    { ...node('j', 'instance'), component: 'c' },
  ])
  d.schemaVersion = 1
  d.components = [
    {
      id: 'c',
      name: 'c',
      props: [],
      variants: [],
      root: node('cr', 'column', [node('p', 'form')]),
    },
    {
      id: 'o',
      name: 'o',
      props: [],
      variants: [],
      root: node('or', 'column', [node('p', 'text')]),
    },
  ]
  const r = migrate(d)
  assert.ok(r.ok)
  assert.equal('required' in r.doc.components[0].root.children![0], false)
})
