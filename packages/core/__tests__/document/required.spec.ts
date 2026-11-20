import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hiddenBy,
  reachingUses,
  isRequired,
  requiredRefs,
  textSizes,
} from '../../src/document/required.ts'
import type { Component, Node } from '../../src/document/types.ts'
import { node, siteWith, text } from '../kit.ts'

const form = (more: Partial<Node> = {}, kids: Node[] = []) => ({
  ...node('f', 'form', kids),
  ...more,
})
const field = (more: Partial<Node> = {}) => ({
  ...node('i', 'field'),
  ...more,
})
const none = {}

// isRequired
test('a node marked true is required', () => {
  assert.equal(isRequired(text('t', 'x', { required: true })), true)
})
test('a form is required without a mark, and not when marked false', () => {
  assert.equal(isRequired(form()), true)
  assert.equal(isRequired(form({ required: false })), false)
})
test('a field is required without a mark; not when marked false; not when its form is marked false', () => {
  assert.equal(isRequired(field()), true)
  assert.equal(isRequired(field({ required: false })), false)
  assert.equal(isRequired(field(), form({ required: false })), false)
  assert.equal(isRequired(field(), form()), true)
})
test('a text with no mark is not required', () => {
  assert.equal(isRequired(text('t', 'x')), false)
  assert.equal(isRequired(text('t', 'x', { required: false })), false)
})

// hiddenBy
test('hide on phone', () => {
  const n = text('a', 'x', { hide: { phone: true } })
  assert.deepEqual(hiddenBy(n, [], none), {
    by: 'a',
    how: 'hide',
    where: 'phone',
  })
})
test('hide on desktop and on tablet', () => {
  assert.deepEqual(
    hiddenBy(text('a', 'x', { hide: { desktop: true } }), [], none),
    {
      by: 'a',
      how: 'hide',
      where: 'desktop',
    },
  )
  assert.deepEqual(
    hiddenBy(text('a', 'x', { hide: { tablet: true } }), [], none),
    {
      by: 'a',
      how: 'hide',
      where: 'tablet',
    },
  )
})
test('hidden: true in base', () => {
  const n = text('a', 'x', { style: { base: { hidden: true } } })
  assert.deepEqual(hiddenBy(n, [], none), {
    by: 'a',
    how: 'hidden',
    where: 'base',
  })
})
test('hidden: true in a state layer (hover)', () => {
  const n = text('a', 'x', { style: { hover: { hidden: true } } })
  assert.deepEqual(hiddenBy(n, [], none), {
    by: 'a',
    how: 'hidden',
    where: 'hover',
  })
})
test('hidden: true in a when layer', () => {
  const n = text('a', 'x', {
    style: { when: [{ state: 's', is: 'on', decl: { hidden: true } }] },
  })
  assert.deepEqual(hiddenBy(n, [], none), {
    by: 'a',
    how: 'hidden',
    where: 'when',
  })
})
test('either of those on an ancestor names the ancestor in `by`', () => {
  const root = node('r', 'column', [], {})
  root.hide = { tablet: true }
  const mid = node('m', 'column', [], {})
  mid.style = { phone: { hidden: true } }
  const leaf = text('a', 'x')
  assert.deepEqual(hiddenBy(leaf, [root, mid], none), {
    by: 'm',
    how: 'hidden',
    where: 'phone',
  })
  assert.deepEqual(hiddenBy(leaf, [root], none), {
    by: 'r',
    how: 'hide',
    where: 'tablet',
  })
})

const comp = (root: Node, variants: Component['variants'] = []): Component => ({
  id: 'c',
  name: 'c',
  root,
  props: [],
  variants,
})
test('an instance override that sets hide or hidden on the part', () => {
  const part = text('p', 'x')
  const c = comp(node('cr', 'column', [part]))
  const inst = (overrides: Node['overrides']): Node => ({
    ...node('inst', 'instance'),
    component: 'c',
    overrides,
  })
  assert.deepEqual(
    hiddenBy(part, [c.root], {
      component: c,
      uses: [inst({ p: { hide: { phone: true } } })],
    }),
    { by: 'inst', how: 'override', where: 'phone' },
  )
  assert.deepEqual(
    hiddenBy(part, [c.root], {
      component: c,
      uses: [inst({ p: { style: { base: { hidden: true } } } })],
    }),
    { by: 'inst', how: 'override', where: 'base' },
  )
  // an override on the part's ancestor hides it too
  assert.equal(
    hiddenBy(part, [c.root], {
      component: c,
      uses: [inst({ cr: { hide: { desktop: true } } })],
    })?.by,
    'inst',
  )
  assert.equal(
    hiddenBy(part, [c.root], { component: c, uses: [inst({ p: {} })] }),
    undefined,
  )
})
test('a component variant patch that sets hide or hidden on the part', () => {
  const part = text('p', 'x')
  const c = comp(node('cr', 'column', [part]), [
    { when: { size: 'small' }, patch: { p: { hide: { phone: true } } } },
  ])
  assert.deepEqual(hiddenBy(part, [c.root], { component: c }), {
    by: 'c',
    how: 'variant',
    where: 'phone',
  })
  const d = comp(node('cr', 'column', [part]), [
    { when: {}, patch: { p: { style: { base: { hidden: true } } } } },
  ])
  assert.deepEqual(hiddenBy(part, [d.root], { component: d }), {
    by: 'c',
    how: 'variant',
    where: 'base',
  })
})
test('hidden: false and an empty hide give undefined', () => {
  const n = text('a', 'x', {
    hide: {},
    style: {
      base: { hidden: false },
      when: [{ state: 's', is: 'on', decl: { hidden: false } }],
    },
  })
  assert.equal(hiddenBy(n, [], none), undefined)
  // show conditions are not hiding
  assert.equal(
    hiddenBy(
      text('b', 'x', { showIf: { from: 'site', field: 'x' } }),
      [],
      none,
    ),
    undefined,
  )
})

// textSizes
test('yields size from a node layer, a run style, a named text style, and the min of a fluidSize, each with its path', () => {
  const doc = siteWith([
    text('a', 'x', { style: { phone: { size: 14 } } }),
    {
      ...text('b', 'x'),
      props: { level: 'p', runs: [{ text: 'x', style: { size: 20 } }] },
    },
    text('c', 'x', {
      style: {
        when: [{ state: 's', is: 'on', decl: { size: 30 } }],
        base: { fluidSize: { min: 16, max: 40 } },
      },
    }),
  ])
  doc.styles = {
    colors: [],
    text: [{ id: 't1', name: 't', decl: { size: 18 } }],
    space: { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 },
    shadows: [],
  }
  const got = [...textSizes(doc)]
  const has = (size: number, nodeId: string | undefined) =>
    got.find(g => g.size === size && g.nodeId === nodeId)
  assert.ok(has(14, 'a')?.path)
  assert.ok(has(20, 'b'))
  assert.ok(has(30, 'c'))
  assert.ok(has(16, 'c'))
  assert.equal(has(40, 'c'), undefined)
  const named = has(18, undefined)
  assert.equal(named?.path, 'styles.text[0].decl.size')
  assert.equal(got.length, 5)
  assert.ok(got.every(g => typeof g.path === 'string' && g.path.length > 0))
})
test('does not yield fitWidth, scale or the look type scale', () => {
  const doc = siteWith([
    text('a', 'x', {
      style: { base: { fitWidth: true, scale: 1.5 } } as never,
    }),
  ])
  assert.deepEqual([...textSizes(doc)], [])
})

// requiredRefs
test('lists a required node of a page, the header, the footer, and of a component that an instance uses', () => {
  const doc = siteWith([text('pt', 'x', { required: true }), text('free', 'x')])
  doc.header = node('header', 'column', [text('ht', 'x', { required: true })])
  doc.footer = node('footer', 'column', [form({ id: 'ff' })])
  doc.components = [
    comp(node('cr', 'column', [text('ct', 'x', { required: true })])),
    {
      ...comp(node('dr', 'column', [text('dt', 'x', { required: true })])),
      id: 'unused',
    },
  ]
  doc.pages[0].root.children!.push({
    ...node('inst', 'instance'),
    component: 'c',
  })
  const refs = requiredRefs(doc)
  assert.deepEqual(
    refs.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { tree: { component: 'c' }, id: 'ct' },
      { tree: 'footer', id: 'ff' },
      { tree: 'header', id: 'ht' },
      { tree: { page: 'home' }, id: 'pt' },
    ],
  )
})

test('an outer instance override keyed `<nestedInstanceId>.<partId>` hides the part', () => {
  const part = text('p', 'x')
  const inner = comp(node('ir', 'column', [part]))
  const outerRoot = node('or', 'column', [
    { ...node('n', 'instance'), component: 'c' },
  ])
  const outer: Component = { ...comp(outerRoot), id: 'outer' }
  const o: Node = {
    ...node('o', 'instance'),
    component: 'outer',
    overrides: { 'n.p': { hide: { phone: true } } },
  }
  const doc = siteWith([o])
  doc.components = [inner, outer]
  assert.deepEqual(
    hiddenBy(part, [inner.root], {
      component: inner,
      uses: reachingUses(doc, 'c'),
    }),
    {
      by: 'o',
      how: 'override',
      where: 'phone',
    },
  )
})
