import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emptySite,
  type Node,
  type SiteDocument,
} from '../../src/document/index.ts'
import { nextIds } from '../../src/ops/ids.ts'
import { LOOK, node } from '../kit.ts'

const siteWith = (kids: Node[]): SiteDocument => {
  const d = emptySite('s', LOOK)
  d.pages[0].root = node('homeroot', 'column', kids)
  return d
}

test('the lowest unused n-ids', () => {
  const doc = siteWith([node('n1', 'box'), node('n3', 'box')])
  assert.deepEqual(nextIds(doc, { page: 'home' }, 3), ['n2', 'n4', 'n5'])
})

test('an id used in the footer or on another page is not given to a page tree', () => {
  const doc = siteWith([node('n1', 'box')])
  doc.footer = node('footer', 'column', [node('n2', 'box')])
  doc.pages.push({
    ...doc.pages[0],
    id: 'about',
    slug: '/about',
    root: node('aboutroot', 'column', [node('n3', 'box', [node('n4', 'box')])]),
  })
  assert.deepEqual(nextIds(doc, { page: 'home' }, 2), ['n5', 'n6'])
  assert.deepEqual(nextIds(doc, 'header', 1), ['n5'])
})

test('a component tree has its own id space', () => {
  const doc = siteWith([node('n1', 'box'), node('n2', 'box')])
  doc.components.push({
    id: 'card',
    name: 'Card',
    root: node('c', 'box', [node('n2', 'box')]),
    props: [],
    variants: [],
  })
  assert.deepEqual(nextIds(doc, { component: 'card' }, 2), ['n1', 'n3'])
  assert.deepEqual(nextIds(doc, { page: 'home' }, 1), ['n3'])
})

test('only an exact n-id counts as used', () => {
  const doc = siteWith([
    node('b1.n1', 'box'),
    node('n12', 'box'),
    node('n01', 'box'),
  ])
  assert.deepEqual(nextIds(doc, { page: 'home' }, 2), ['n1', 'n2'])
})

test('two calls with the same document and count return equal ids', () => {
  const doc = siteWith([node('n2', 'box')])
  assert.deepEqual(
    nextIds(doc, { page: 'home' }, 4),
    nextIds(doc, { page: 'home' }, 4),
  )
})

test('an unknown component or a count of zero gives what is expected', () => {
  const doc = siteWith([])
  assert.deepEqual(nextIds(doc, { component: 'nope' }, 2), ['n1', 'n2'])
  assert.deepEqual(nextIds(doc, { page: 'home' }, 0), [])
})
