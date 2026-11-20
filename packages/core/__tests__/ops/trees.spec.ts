import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptySite, type SiteDocument } from '../../src/document/index.ts'
import { rootOf, trees, withRoot } from '../../src/ops/trees.ts'
import type { TreeRef } from '../../src/ops/types.ts'
import { LOOK, node } from '../kit.ts'

const doc = (): SiteDocument => ({
  ...emptySite('s', LOOK),
  components: [
    {
      id: 'card',
      name: 'Card',
      root: node('c1', 'box'),
      props: [],
      variants: [],
    },
  ],
})

test('rootOf finds each of the four kinds of tree and gives undefined for an unknown page, an unknown component and for {}', () => {
  const d = doc()
  assert.equal(rootOf(d, 'header'), d.header)
  assert.equal(rootOf(d, 'footer'), d.footer)
  assert.equal(rootOf(d, { page: 'home' }), d.pages[0].root)
  assert.equal(rootOf(d, { component: 'card' }), d.components[0].root)
  assert.equal(rootOf(d, { page: 'nope' }), undefined)
  assert.equal(rootOf(d, { component: 'nope' }), undefined)
  for (const bad of [{}, 'body', null, 3] as unknown as TreeRef[]) {
    assert.equal(rootOf(d, bad), undefined)
    assert.equal(withRoot(d, bad, node('x', 'box')), d)
  }
})

test('withRoot replaces one root and leaves the input and the other trees the same objects', () => {
  const d = doc()
  const root = node('new', 'box')
  for (const tree of [
    'header',
    'footer',
    { page: 'home' },
    { component: 'card' },
  ] as TreeRef[]) {
    const next = withRoot(d, tree, root)
    assert.notEqual(next, d)
    assert.equal(rootOf(next, tree), root)
    assert.notEqual(rootOf(d, tree), root)
    for (const t of trees(d))
      if (JSON.stringify(t.tree) !== JSON.stringify(tree))
        assert.equal(rootOf(next, t.tree), t.root)
  }
  assert.equal(withRoot(d, 'header', root).pages, d.pages)
})

test('trees lists header, footer, pages, then components', () => {
  assert.deepEqual(
    trees(doc()).map(t => t.tree),
    ['header', 'footer', { page: 'home' }, { component: 'card' }],
  )
})

test('a tree object with both keys or another key is no tree', () => {
  const d = doc()
  for (const t of [
    { page: 'home', component: 'card' },
    { page: 'home', x: 1 },
    { x: 1 },
  ] as unknown as TreeRef[]) {
    assert.equal(rootOf(d, t), undefined)
    assert.equal(withRoot(d, t, node('r', 'box')), d)
  }
})

test('with two pages (or components) of one id, withRoot replaces the one rootOf reads, and only that one', () => {
  const d = doc()
  d.pages.push({ ...d.pages[0], slug: '/again', root: node('again', 'box') })
  d.components.push({ ...d.components[0], root: node('c2', 'box') })
  const root = node('new', 'box')
  const next = withRoot(d, { page: 'home' }, root)
  assert.equal(next.pages[0].root, root)
  assert.equal(next.pages[1], d.pages[1])
  const comp = withRoot(d, { component: 'card' }, root)
  assert.equal(comp.components[0].root, root)
  assert.equal(comp.components[1], d.components[1])
})
