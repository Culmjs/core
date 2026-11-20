import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hiddenBy,
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

// hiddenBy
const pageDoc = (n: Node) => siteWith([n])
const why = (n: Node, id = n.id) => hiddenBy(pageDoc(n), { page: 'home' }, id)

test('hide on phone', () => {
  assert.deepEqual(why(text('a', 'x', { hide: { phone: true } })), {
    by: 'a',
    how: 'hide',
    where: 'phone',
  })
})
test('hide on desktop and on tablet', () => {
  for (const l of ['desktop', 'tablet'] as const)
    assert.deepEqual(why(text('a', 'x', { hide: { [l]: true } })), {
      by: 'a',
      how: 'hide',
      where: l,
    })
})
test('hidden: true in base', () => {
  assert.deepEqual(why(text('a', 'x', { style: { base: { hidden: true } } })), {
    by: 'a',
    how: 'hidden',
    where: 'base',
  })
})
test('hidden: true in a state layer (hover)', () => {
  assert.deepEqual(
    why(text('a', 'x', { style: { hover: { hidden: true } } })),
    { by: 'a', how: 'hidden', where: 'hover' },
  )
})
test('hidden: true in a when layer', () => {
  const n = text('a', 'x', {
    style: { when: [{ state: 's', is: 'on', decl: { hidden: true } }] },
  })
  assert.deepEqual(why(n), { by: 'a', how: 'hidden', where: 'when' })
})
test('either of those on an ancestor names the ancestor in `by`', () => {
  const leaf = text('a', 'x')
  const mid = {
    ...node('m', 'column', [leaf]),
    style: { phone: { hidden: true } },
  }
  const root = {
    ...node('r', 'column', [mid]),
    hide: { tablet: true } as const,
  }
  assert.deepEqual(why(root, 'a'), {
    by: 'm',
    how: 'hidden',
    where: 'phone',
  })
  assert.deepEqual(why({ ...root, children: [leaf] }, 'a'), {
    by: 'r',
    how: 'hide',
    where: 'tablet',
  })
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
const inC = (d: ReturnType<typeof withComps>, c: string, id: string) =>
  hiddenBy(d, { component: c }, id)

test('an instance override that sets hide or hidden on the part', () => {
  const c = comp('c', [text('p', 'x')])
  for (const [o, where] of [
    [{ hide: { phone: true as const } }, 'phone'],
    [{ style: { base: { hidden: true } } }, 'base'],
  ] as const)
    assert.deepEqual(
      inC(withComps([inst('i', 'c', { overrides: { p: o } })], [c]), 'c', 'p'),
      { by: 'i', how: 'override', where },
    )
  // on the part's ancestor: the component root
  assert.equal(
    inC(
      withComps(
        [inst('i', 'c', { overrides: { croot: { hide: { desktop: true } } } })],
        [c],
      ),
      'c',
      'p',
    )?.by,
    'i',
  )
  assert.equal(
    inC(withComps([inst('i', 'c', { overrides: { p: {} } })], [c]), 'c', 'p'),
    undefined,
  )
})
test('a component variant patch that sets hide or hidden on the part', () => {
  const d = (patch: Component['variants'][0]['patch']) =>
    withComps(
      [inst('i', 'c')],
      [comp('c', [text('p', 'x')], [{ when: {}, patch }])],
    )
  assert.deepEqual(inC(d({ p: { hide: { phone: true } } }), 'c', 'p'), {
    by: 'c',
    how: 'variant',
    where: 'phone',
  })
  assert.deepEqual(
    inC(d({ p: { style: { base: { hidden: true } } } }), 'c', 'p'),
    {
      by: 'c',
      how: 'variant',
      where: 'base',
    },
  )
})
test('hidden: false and an empty hide give undefined', () => {
  const n = text('a', 'x', {
    hide: {},
    style: {
      base: { hidden: false },
      when: [{ state: 's', is: 'on', decl: { hidden: false } }],
    },
  })
  assert.equal(why(n), undefined)
  // show conditions are not hiding
  assert.equal(
    why(text('b', 'x', { showIf: { from: 'site', field: 'x' } })),
    undefined,
  )
})
test('an override on one component does not hide a same-named part of another, and a stale key hides nothing', () => {
  const c = comp('c', [text('p', 'x')])
  const o = comp('o', [inst('n', 'c'), text('p', 'y')])
  const hide = { hide: { phone: true as const } }
  const d = withComps(
    [inst('oi', 'o', { overrides: { p: hide, 'n.p': hide, 'gone.p': hide } })],
    [c, o],
  )
  assert.equal(inC(d, 'o', 'p')?.by, 'oi')
  // `n.p` reaches c's p, by the nested route
  assert.equal(inC(d, 'c', 'p')?.by, 'oi')
  // an override that only names o's own p does not reach c's p
  const e = withComps([inst('oi', 'o', { overrides: { p: hide } })], [c, o])
  assert.equal(inC(e, 'c', 'p'), undefined)
  assert.equal(inC(e, 'o', 'p')?.by, 'oi')
  // stale key
  const f = withComps(
    [inst('oi', 'o', { overrides: { 'zz.p': hide } })],
    [c, o],
  )
  assert.equal(inC(f, 'c', 'p'), undefined)
  assert.equal(inC(f, 'o', 'p'), undefined)
})
test('a part is hidden when the instance that uses its component is hidden', () => {
  const c = comp('c', [node('f', 'form')])
  const d = withComps([inst('i', 'c', { hide: { phone: true } })], [c])
  assert.deepEqual(inC(d, 'c', 'f'), { by: 'i', how: 'hide', where: 'phone' })
  const g = withComps(
    [
      {
        ...node('col', 'column', [inst('i', 'c')]),
        style: { base: { hidden: true } },
      },
    ],
    [c],
  )
  assert.deepEqual(inC(g, 'c', 'f'), {
    by: 'col',
    how: 'hidden',
    where: 'base',
  })
})
test('hiding follows nested instances: hidden in the outer tree, by an outer override, by an outer variant', () => {
  const c = comp('c', [node('f', 'form')])
  const hide = { hide: { phone: true as const } }
  const mk = (
    n: Node,
    variants: Component['variants'] = [],
    over: Node['overrides'] = undefined,
  ) =>
    withComps(
      [inst('oi', 'o', over ? { overrides: over } : {})],
      [c, comp('o', [n], variants)],
    )
  assert.deepEqual(inC(mk(inst('n', 'c', hide)), 'c', 'f'), {
    by: 'n',
    how: 'hide',
    where: 'phone',
  })
  assert.deepEqual(inC(mk(inst('n', 'c'), [], { n: hide }), 'c', 'f'), {
    by: 'oi',
    how: 'override',
    where: 'phone',
  })
  assert.deepEqual(
    inC(mk(inst('n', 'c'), [{ when: {}, patch: { n: hide } }]), 'c', 'f'),
    { by: 'o', how: 'variant', where: 'phone' },
  )
  // and the outer instance itself hidden on the page
  const d = withComps([inst('oi', 'o', hide)], [c, comp('o', [inst('n', 'c')])])
  assert.equal(inC(d, 'c', 'f')?.by, 'oi')
})
test('a component cycle, a missing component and a malformed document do not loop or throw', () => {
  const a = comp('a', [inst('x', 'b'), node('f', 'form')])
  const b = comp('b', [inst('y', 'a')])
  assert.equal(inC(withComps([inst('i', 'a')], [a, b]), 'a', 'f'), undefined)
  assert.equal(inC(withComps([inst('i', 'zz')], []), 'zz', 'f'), undefined)
  const bad = { pages: 5, components: null, header: null } as never
  assert.equal(hiddenBy(bad, 'header', 'x'), undefined)
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
test('a hidden instance inside a component nobody uses hides nothing; used, it hides', () => {
  const a = comp('A', [inst('ib', 'B', { hide: { phone: true } })])
  const b = comp('B', [node('f', 'form')])
  assert.equal(inC(withComps([], [a, b]), 'B', 'f'), undefined)
  assert.deepEqual(inC(withComps([inst('ia', 'A')], [a, b]), 'B', 'f'), {
    by: 'ib',
    how: 'hide',
    where: 'phone',
  })
})
