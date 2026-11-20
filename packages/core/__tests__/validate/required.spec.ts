import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from '../../src/document/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { dv, fs, n, put, reg, text as t0 } from './helpers.ts'

const text = (id: string, extra: object = {}) =>
  t0(id, { slot: fs(), ...extra })
const withRange = (d: ReturnType<typeof put>, min = 11, max = 96) => ({
  ...d,
  styles: { ...defaultSiteStyles(d.look), textRange: { min, max } },
})
const form = (extra: object = {}) =>
  n({
    id: 'f',
    kind: 'form',
    name: 'f',
    slot: fs(),
    props: { formId: 'f' },
    children: [
      n({
        id: 'a',
        kind: 'field',
        name: 'a',
        slot: {},
        props: { name: 'email', label: 'A' },
      }),
    ],
    ...extra,
  })

test('a required title hidden on phone: POLICY_VIOLATION, rule required, nodeId the title, path hide.phone', () => {
  const p = validateSite(
    put(text('title', { required: true, hide: { phone: true } })),
    reg,
  )
  assert.deepEqual(
    p.map(x => [x.code, x.rule, x.nodeId, x.path]),
    [['POLICY_VIOLATION', 'required', 'title', 'hide.phone']],
  )
})

test('a required text with no run that has text or a binding: rule required, path props.runs', () => {
  const empty = put(
    n({
      ...text('t', { required: true }),
      props: { level: 'p', runs: [{ text: '' }] },
    }),
  )
  const p = validateSite(empty, reg)
  assert.deepEqual(
    p.map(x => [x.code, x.rule, x.nodeId, x.path]),
    [['POLICY_VIOLATION', 'required', 't', 'props.runs']],
  )
  const bound = put(
    n({
      ...text('t', { required: true }),
      props: {
        level: 'p',
        runs: [{ text: '', bind: { from: 'site', field: 'title' } }],
      },
    }),
  )
  assert.deepEqual(validateSite(bound, reg), [])
})

test('size 8 on the phone layer with textRange 11..96: rule textRange, path style.phone.size, allowed ["11","96"]', () => {
  const d = withRange(put(text('t', { style: { phone: { size: 8 } } })))
  const p = validateSite(d, reg)
  assert.equal(p.length, 1)
  assert.equal(p[0].code, 'POLICY_VIOLATION')
  assert.equal(p[0].rule, 'textRange')
  assert.equal(p[0].nodeId, 't')
  assert.equal(p[0].path, 'style.phone.size')
  assert.deepEqual(p[0].allowed, ['11', '96'])
})

test('a form hidden on phone is refused; the same form with required: false is accepted', () => {
  const hidden = validateSite(put(form({ hide: { phone: true } })), reg)
  assert.ok(hidden.some(x => x.rule === 'required' && x.nodeId === 'f'))
  assert.ok(hidden.some(x => x.rule === 'required' && x.nodeId === 'a'))
  assert.deepEqual(
    validateSite(put(form({ hide: { phone: true }, required: false })), reg),
    [],
  )
})

test('no textRange: no size is refused', () => {
  assert.deepEqual(
    validateSite(put(text('t', { style: { phone: { size: 9 } } })), reg),
    [],
  )
})

test('a showIf on a required node is accepted', () => {
  const d = put(
    text('t', { required: true, showIf: { from: 'site', field: 'title' } }),
  )
  assert.deepEqual(validateSite(d, reg), [])
  // the same document without the condition and with no text is refused, so the check ran
  const twin = put(
    text('t', { required: true, props: { level: 'p', runs: [{ text: '' }] } }),
  )
  assert.equal(validateSite(twin, reg)[0]?.rule, 'required')
})

test('a divider needs no content and is not required without a mark', () => {
  assert.deepEqual(
    validateSite(put(dv('d', { hide: { phone: true } })), reg),
    [],
  )
})

test('a version 1 document with a form hidden on phone has no problems after migrate', () => {
  const d = { ...put(form({ hide: { phone: true } })), schemaVersion: 1 }
  const r = migrate(d)
  assert.ok(r.ok)
  assert.deepEqual(validateSite(r.doc, reg), [])
})

const empty = n({
  id: 'root',
  kind: 'box',
  name: 'root',
  slot: {},
  children: [
    n({
      id: 'title',
      kind: 'text',
      name: 'title',
      slot: {},
      required: true,
      props: { level: 'p', runs: [{ text: '' }] },
    }),
  ],
})
const withInstance = (inst: object, prop: object = {}, used = true) => ({
  ...put(
    ...(used
      ? [
          n({
            id: 'i1',
            kind: 'instance',
            name: 'i1',
            slot: fs(),
            component: 'c1',
            ...inst,
          }),
        ]
      : []),
  ),
  components: [
    {
      id: 'c1',
      name: 'c1',
      root: empty,
      props: [
        {
          key: 'title',
          label: 'Title',
          type: 'text' as const,
          part: 'title',
          field: 'text' as const,
          ...prop,
        },
      ],
      variants: [],
    },
  ],
})
const refused = (d: object) =>
  validateSite(d, reg).map(x => [x.rule, x.nodeId, x.path])

test('a required text filled by a property: unset with no default, or set to "", is refused at the instance', () => {
  for (const inst of [{}, { set: { title: '' } }])
    assert.deepEqual(refused(withInstance(inst)), [
      ['required', 'i1', 'set.title'],
    ])
})

test('a required text filled by a property: a set value, a binding and a default are accepted', () => {
  assert.deepEqual(
    validateSite(withInstance({ set: { title: 'Hi' } }), reg),
    [],
  )
  assert.deepEqual(
    validateSite(
      withInstance({ bind: { title: { from: 'site', field: 'title' } } }),
      reg,
    ),
    [],
  )
  assert.deepEqual(
    validateSite(withInstance({}, { default: 'Hello' }), reg),
    [],
  )
})

test('a component nobody uses raises nothing', () => {
  assert.deepEqual(validateSite(withInstance({}, {}, false), reg), [])
})
