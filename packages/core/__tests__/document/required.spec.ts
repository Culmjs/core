import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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

const comp = (
  id: string,
  kids: Node[],
  variants: Component['variants'] = [],
): Component => ({
  id,
  name: id,
  root: node(`${id}root`, 'column', kids),
  props: [],
  variants,
})
const inst = (
  id: string,
  component: string,
  more: Partial<Node> = {},
): Node => ({
  ...node(id, 'instance'),
  component,
  ...more,
})
const withComps = (page: Node[], components: Component[]) => {
  const d = siteWith(page)
  d.components = components
  return d
}
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
  assert.deepEqual(
    [...textSizes(doc)].sort((x, y) => x.size - y.size),
    [
      { size: 14, nodeId: 'a', path: 'style.phone.size' },
      { size: 16, nodeId: 'c', path: 'style.base.fluidSize.min' },
      { size: 18, path: 'styles.text.0.decl.size' },
      { size: 20, nodeId: 'b', path: 'props.runs.0.style.size' },
      { size: 30, nodeId: 'c', path: 'style.when.0.size' },
    ],
  )
})
test('reads the min of a fluidSize in a named text style and in a run style, and only the runs prop', () => {
  const doc = siteWith([
    {
      ...text('b', 'x'),
      props: {
        level: 'p',
        runs: [
          { text: 'x' },
          { text: 'y', style: { fluidSize: { min: 11, max: 20 } } },
        ] as never,
        other: [{ style: { size: 99 } }] as never,
      },
    },
  ])
  doc.styles = {
    colors: [],
    text: [
      {
        id: 't',
        name: 't',
        decl: { fluidSize: { min: 12, max: 30 } } as never,
      },
    ],
    space: { xs: 1, s: 2, m: 3, l: 4, xl: 5, '2xl': 6 },
    shadows: [],
  }
  assert.deepEqual(
    [...textSizes(doc)].sort((x, y) => x.size - y.size),
    [
      { size: 11, nodeId: 'b', path: 'props.runs.1.style.fluidSize.min' },
      { size: 12, path: 'styles.text.0.decl.fluidSize.min' },
    ],
  )
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
    comp('c', [text('ct', 'x', { required: true })]),
    comp('unused', [text('dt', 'x', { required: true })]),
  ]
  doc.pages[0].root.children!.push(inst('inst', 'c'))
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

// reachability of uses
const reqIn = (id: string) => text(id, 'x', { required: true })
test('a component used only inside another used component counts; once the outer is unused, it does not', () => {
  const a = comp('A', [inst('ib', 'B')])
  const b = comp('B', [reqIn('breq')])
  const used = withComps([inst('ia', 'A')], [a, b])
  assert.deepEqual(
    requiredRefs(used).filter(r => r.id === 'breq'),
    [{ tree: { component: 'B' }, id: 'breq' }],
  )
  const gone = withComps([], [a, b])
  assert.deepEqual(requiredRefs(gone), [])
})
test('a component that contains an instance of itself and is used nowhere else is not listed', () => {
  const a = comp('A', [inst('self', 'A'), reqIn('areq')])
  assert.deepEqual(requiredRefs(withComps([], [a])), [])
  assert.equal(requiredRefs(withComps([inst('i', 'A')], [a])).length, 1)
})
