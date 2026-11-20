import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import { requiredRefs } from '../../src/document/required.ts'
import { plan } from '../../src/ops/plan.ts'
import type { ChangeRequest } from '../../src/ops/types.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { kitRegistry, node, text, twoPages } from '../kit.ts'

// Goal 5 through `plan`: what a person cannot do to required content, however it is tried.

const reg = kitRegistry()
const T = { page: 'home' }
const req = (ops: unknown[]): ChangeRequest =>
  ({ site: 's', baseRevision: 0, key: 'k', ops }) as ChangeRequest

const inst = (id: string, more: Partial<Node> = {}): Node => ({
  id,
  kind: 'instance',
  name: id,
  slot: {},
  component: 'card',
  ...more,
})
const prop = (key: string, type: string, field: string, extra = {}) => ({
  key,
  label: key,
  type,
  part: 'title',
  field,
  ...extra,
})
const card = () => ({
  id: 'card',
  name: 'Card',
  root: node('croot', 'box', [text('title', 'Hi', { required: true })]),
  props: [
    prop('words', 'text', 'text'),
    prop('show', 'toggle', 'hidden', { default: true }),
    prop('sz', 'number', 'fontSize', { default: 20 }),
    { key: 'look', label: 'Look', type: 'choice', options: ['a', 'b'] },
  ],
  variants: [] as unknown[],
})
const form = (): Node => ({
  id: 'f',
  kind: 'form',
  name: 'f',
  slot: {},
  props: { formId: 'f' },
  children: [
    {
      id: 'a',
      kind: 'field',
      name: 'a',
      slot: {},
      props: { name: 'email', label: 'Email' },
    },
  ],
})

/** (a) a required text on a page, (b) a required text part of a component used once, (c) a form with a field. */
const start = (): SiteDocument => {
  const d = twoPages(
    [
      node('wrap', 'box', [text('rt', 'Welcome', { required: true })]),
      inst('i1'),
      form(),
    ],
    [text('at', 'About us', { required: true })],
  )
  d.pages[0].root.state = [
    { name: 'tab', values: ['talks', 'papers'], initial: 'talks' },
  ]
  d.components = [card() as never]
  d.styles = { ...defaultSiteStyles(d.look), textRange: { min: 11, max: 96 } }
  return d
}

const when = { when: { state: 'tab', is: 'papers' } }
const hide = (id: string, layout: string) => ({
  op: 'setHidden',
  tree: T,
  id,
  layout,
  hidden: true,
})
const style = (id: string, layer: unknown, decl: object) => ({
  op: 'setStyle',
  tree: T,
  id,
  layer,
  decl,
})
const over = (overrides: object) => ({
  op: 'setInstance',
  tree: T,
  id: 'i1',
  overrides,
})
const set = (values: object) => ({
  op: 'setInstance',
  tree: T,
  id: 'i1',
  set: values,
})

const refusals: [string, unknown[], 'required' | 'textRange'][] = [
  // (a) a required text on a page
  ['remove it', [{ op: 'remove', tree: T, id: 'rt' }], 'required'],
  ['remove its parent', [{ op: 'remove', tree: T, id: 'wrap' }], 'required'],
  ['remove the page', [{ op: 'removePage', page: 'about' }], 'required'],
  ['hide it on desktop', [hide('rt', 'desktop')], 'required'],
  ['hide it on tablet', [hide('rt', 'tablet')], 'required'],
  ['hide it on phone', [hide('rt', 'phone')], 'required'],
  ['hidden in base', [style('rt', 'base', { hidden: true })], 'required'],
  [
    'hidden in a state layer',
    [style('rt', 'hover', { hidden: true })],
    'required',
  ],
  ['hidden in a when layer', [style('rt', when, { hidden: true })], 'required'],
  ['hide its parent on phone', [hide('wrap', 'phone')], 'required'],
  [
    'hidden in its parent base',
    [style('wrap', 'base', { hidden: true })],
    'required',
  ],
  [
    'hidden in its parent state layer',
    [style('wrap', 'dark', { hidden: true })],
    'required',
  ],
  [
    'hidden in its parent when layer',
    [style('wrap', when, { hidden: true })],
    'required',
  ],
  [
    'setText empty',
    [{ op: 'setText', tree: T, id: 'rt', text: '' }],
    'required',
  ],
  [
    'setText spaces',
    [{ op: 'setText', tree: T, id: 'rt', text: '   ' }],
    'required',
  ],
  [
    'setProps with no runs',
    [{ op: 'setProps', tree: T, id: 'rt', props: { runs: [] } }],
    'required',
  ],
  [
    'size 8 on the phone layer',
    [style('rt', 'phone', { size: 8 })],
    'textRange',
  ],
  // (c) a form with a field
  ['remove the form', [{ op: 'remove', tree: T, id: 'f' }], 'required'],
  ['remove the field', [{ op: 'remove', tree: T, id: 'a' }], 'required'],
  ['hide the form on phone', [hide('f', 'phone')], 'required'],
  ['hide the field on tablet', [hide('a', 'tablet')], 'required'],
  [
    'hidden in the form base',
    [style('f', 'base', { hidden: true })],
    'required',
  ],
  [
    'hidden in the field when layer',
    [style('a', when, { hidden: true })],
    'required',
  ],
  // (b) a required text part of a component used once
  [
    'an override that hides the part',
    [over({ title: { hide: { phone: true } } })],
    'required',
  ],
  [
    'an override whose style hides the part',
    [over({ title: { style: { base: { hidden: true } } } })],
    'required',
  ],
  [
    'an override that sets size 8',
    [over({ title: { style: { phone: { size: 8 } } } })],
    'textRange',
  ],
  ['set of the hidden property', [set({ show: false })], 'required'],
  ['set of the fontSize property out of range', [set({ sz: 8 })], 'textRange'],
  ['set of the text property to ""', [set({ words: '' })], 'required'],
  ['set of the text property to spaces', [set({ words: '  ' })], 'required'],
  [
    'remove the only instance',
    [{ op: 'remove', tree: T, id: 'i1' }],
    'required',
  ],
  [
    'detach then remove',
    [
      { op: 'detach', tree: T, id: 'i1' },
      { op: 'remove', tree: T, id: 'i1' },
    ],
    'required',
  ],
  [
    'makeComponent of a subtree holding (a), then remove the instance',
    [
      {
        op: 'makeComponent',
        tree: T,
        id: 'wrap',
        component: 'wc',
        name: 'Wrap',
      },
      { op: 'remove', tree: T, id: 'wrap' },
    ],
    'required',
  ],
]

test('the starting document is valid', () => {
  assert.deepEqual(validateSite(start(), reg), [])
  assert.deepEqual(
    requiredRefs(start())
      .map(r => r.id)
      .sort(),
    ['a', 'at', 'f', 'rt', 'title'],
  )
})

for (const [name, ops, rule] of refusals)
  test(`refused through plan (${rule}): ${name}`, () => {
    const r = plan(start(), reg, req(ops))
    assert.ok(!r.ok, 'expected a refusal')
    assert.ok(
      r.problems.some(p => p.rule === rule),
      JSON.stringify(r.problems),
    )
  })

test('refused: a variant patch that hides the part (no operation edits variants, so the document is built directly)', () => {
  const d = start()
  d.components[0].variants = [
    { when: { look: 'b' }, patch: { title: { hide: { phone: true } } } },
  ]
  d.pages[0].root.children![1] = inst('i1', { set: { look: 'b' } })
  const p = validateSite(d, reg)
  assert.ok(
    p.some(x => x.rule === 'required'),
    JSON.stringify(p),
  )
})

test('refused: a variant patch that sets size 8', () => {
  const d = start()
  d.components[0].variants = [
    {
      when: { look: 'b' },
      patch: { title: { style: { phone: { size: 8 } } } },
    },
  ]
  d.pages[0].root.children![1] = inst('i1', { set: { look: 'b' } })
  assert.ok(validateSite(d, reg).some(x => x.rule === 'textRange'))
})

test("detach keeps the instance's own required mark: [detach, remove] is refused and detach alone leaves the root required", () => {
  const d = start()
  d.components[0].root.children![0] = text('title', 'Hi')
  d.pages[0].root.children![1] = inst('i1', { required: true })
  assert.deepEqual(validateSite(d, reg), [])
  assert.ok(requiredRefs(d).some(r => r.id === 'i1'))
  const both = plan(
    d,
    reg,
    req([
      { op: 'detach', tree: T, id: 'i1' },
      { op: 'remove', tree: T, id: 'i1' },
    ]),
  )
  assert.ok(!both.ok)
  assert.equal(both.problems[0].code, 'POLICY_VIOLATION')
  assert.equal(both.problems[0].rule, 'required')
  const one = plan(d, reg, req([{ op: 'detach', tree: T, id: 'i1' }]))
  assert.ok(one.ok)
  assert.equal(one.doc.pages[0].root.children![1].required, true)
  assert.ok(requiredRefs(one.doc).some(r => r.id === 'i1'))
})

test('accepted: lifting the mark and removing in one batch (2a allows it; the default allow of the next checkpoint will refuse it)', () => {
  const r = plan(
    start(),
    reg,
    req([
      { op: 'setRequired', tree: T, id: 'rt', required: null },
      { op: 'remove', tree: T, id: 'wrap' },
    ]),
  )
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
})

test('accepted: a show condition on data, and turning the page off', () => {
  const cond = plan(
    start(),
    reg,
    req([
      {
        op: 'bindData',
        tree: T,
        id: 'rt',
        showIf: { from: 'site', field: 'title' },
      },
    ]),
  )
  assert.ok(cond.ok, JSON.stringify(!cond.ok && cond.problems))
  const off = plan(
    start(),
    reg,
    req([{ op: 'setPage', page: 'about', on: false }]),
  )
  assert.ok(off.ok, JSON.stringify(!off.ok && off.problems))
})
