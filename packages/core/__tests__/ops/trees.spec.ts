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
