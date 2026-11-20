import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupOrder } from '../../src/document/tree.ts'
import type { Node } from '../../src/document/index.ts'
import {
  anyOwnPhone,
  deriveLayout,
  effectiveFreeBoxes,
  ownPhone,
  ownTablet,
  phoneBoxes,
} from '../../src/layout/phone.ts'
import { resolveFreeCollisions } from '../../src/layout/placement.ts'

const c = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  phone?: object,
  tablet?: object,
): Node =>
  ({
    id,
    kind: 'text',
    name: id,
    slot: {
      x,
      y,
      w,
      h,
      z: 0,
      ...(phone ? { phone } : {}),
      ...(tablet ? { tablet } : {}),
    },
  }) as Node
const free = (children: Node[], cols = 24): Node =>
  ({
    id: 'f',
    kind: 'free',
    name: 'F',
    slot: {},
    props: { cols },
    children,
  }) as Node

test('side-by-side children stack on a 24-column phone in reading order', () => {
  const boxes = deriveLayout(
    [c('right', 12, 0, 12, 4), c('left', 0, 0, 12, 4)],
    24,
  )
  assert.deepEqual(boxes.get('left'), { x: 0, y: 0, w: 24, h: 2, z: 0 })
  assert.equal(boxes.get('right')!.y > boxes.get('left')!.y, true)
})

test("a nested Free area's stored boxes don't affect its parent", () => {
  const inner: Node = {
    ...free([c('i1', 0, 0, 6, 4, { x: 0, y: 0, w: 6, h: 2, z: 0 })], 6),
    id: 'inner',
    slot: { x: 0, y: 0, w: 12, h: 8, z: 0 },
  } as Node
  const outer = free([inner, c('o1', 12, 0, 12, 4)])
  assert.equal(phoneBoxes(outer).get('o1')!.w, 24, 'outer is derived')
  assert.deepEqual(phoneBoxes(inner).get('i1'), {
    x: 0,
    y: 0,
    w: 6,
    h: 2,
    z: 0,
  })
  assert.ok(anyOwnPhone(outer))
})

test('reading order follows the XY cut', () => {
  const order = groupOrder([
    c('photo', 16, 0, 8, 10),
    c('bio', 0, 4, 16, 4),
    c('name', 0, 0, 16, 4),
  ])
  assert.deepEqual(
    order.map(w => w.id),
    ['name', 'bio', 'photo'],
  )
})

test('a mixed area keeps stored boxes and stacks the rest below', () => {
  const f = free([
    c('a', 0, 0, 12, 4, { x: 2, y: 0, w: 10, h: 3, z: 0 }),
    c('b', 0, 6, 12, 6),
  ])
  const m = phoneBoxes(f)
  assert.deepEqual(m.get('a'), { x: 2, y: 0, w: 10, h: 3, z: 0 })
  assert.deepEqual(m.get('b'), { x: 0, y: 4, w: 24, h: 3, z: 0 })
})

test('hidden children are skipped', () => {
  const h = { ...c('h', 0, 0, 24, 4), hide: { phone: true as const } } as Node
  assert.equal(deriveLayout([h, c('k', 0, 6, 24, 4)], 24).has('h'), false)
})

test('a phone-only child with a stored box keeps it', () => {
  const p = {
    ...c('p', 0, 0, 12, 4, { x: 1, y: 0, w: 5, h: 2, z: 0 }),
    hide: { desktop: true as const },
  } as Node
  assert.deepEqual(
    phoneBoxes(
      free([p, c('q', 0, 6, 12, 4, { x: 0, y: 3, w: 6, h: 2, z: 0 })]),
    ).get('p'),
    { x: 1, y: 0, w: 5, h: 2, z: 0 },
  )
})

test('a nested Free area keeps side-by-side children on the phone', () => {
  const nested = {
    ...free([c('l', 0, 0, 12, 4), c('r', 12, 0, 12, 4)]),
    id: 'n',
    slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
  } as Node
  const m = phoneBoxes(nested)
  assert.deepEqual(
    [m.get('l')!.x, m.get('l')!.w, m.get('r')!.x, m.get('r')!.w],
    [0, 12, 12, 12],
  )
})

test('a root Free area stacks side-by-side children through phoneBoxes', () => {
  const m = phoneBoxes(free([c('l', 0, 0, 12, 4), c('r', 12, 0, 12, 4)]))
  assert.deepEqual([m.get('l')!.w, m.get('r')!.w], [24, 24])
  assert.equal(m.get('r')!.y > m.get('l')!.y, true)
})

test("a derived container's phone-only child gets a box", () => {
  const p = {
    ...c('p', 0, 0, 12, 4),
    hide: { desktop: true as const },
  } as Node
  assert.ok(phoneBoxes(free([p, c('q', 0, 6, 12, 4)])).has('p'), 'root')
  const nested = {
    ...free([p, c('q', 12, 0, 12, 4)]),
    id: 'n',
    slot: { x: 0, y: 0, w: 24, h: 4, z: 0 },
  } as Node
  assert.ok(phoneBoxes(nested).has('p'), 'nested')
})

test("tablet boxes are the widget's own tablet box, else its desktop box", () => {
  const f = free([
    c('a', 0, 0, 12, 4, undefined, { x: 0, y: 0, w: 24, h: 4, z: 0 }),
    c('b', 12, 0, 12, 4),
  ])
  assert.ok(ownTablet(f))
  const m = effectiveFreeBoxes(f, 'tablet')
  assert.deepEqual(m.get('a'), { x: 0, y: 0, w: 24, h: 4, z: 0 })
  assert.deepEqual(
    m.get('b')!.x,
    12,
    'b falls back to desktop (collision pushes it down)',
  )
  assert.equal(effectiveFreeBoxes(f, 'desktop').get('a')!.w, 12)
})

test('phone derives from own tablet boxes', () => {
  const side = [
    c('l', 0, 0, 12, 4, undefined, { x: 0, y: 0, w: 24, h: 4, z: 0 }),
    c('r', 12, 0, 12, 4, undefined, { x: 0, y: 6, w: 24, h: 4, z: 0 }),
  ]
  const m = phoneBoxes(free(side))
  assert.deepEqual([m.get('l')!.w, m.get('r')!.w], [24, 24])
  assert.equal(m.get('r')!.y > m.get('l')!.y, true)
  const same = phoneBoxes(free([c('l', 0, 0, 12, 4), c('r', 12, 0, 12, 4)]))
  const tabletKept = phoneBoxes(
    free([
      c('l', 0, 0, 12, 4, undefined, { x: 0, y: 0, w: 12, h: 4, z: 0 }),
      c('r', 12, 0, 12, 4),
    ]),
  )
  assert.deepEqual(
    [...tabletKept],
    [...same],
    'a tablet box equal to the desktop box changes nothing',
  )
})

test('phone derivation is unchanged with no tablet boxes', () => {
  const trees = [
    [c('l', 0, 0, 12, 4), c('r', 12, 0, 12, 4), c('b', 0, 6, 24, 8)],
    [
      c('a', 0, 0, 24, 6),
      c('o1', 2, 8, 10, 6),
      c('o2', 6, 10, 10, 6),
      c('c', 0, 20, 24, 3),
    ],
    [
      c('a', 0, 0, 12, 4, { x: 2, y: 0, w: 10, h: 3, z: 0 }),
      c('b', 0, 6, 12, 6),
    ],
  ]
  for (const kids of trees) {
    const f = free(kids)
    assert.deepEqual([...phoneBoxes(f)], [...effectiveFreeBoxes(f, 'phone')])
    if (!ownPhone(f))
      assert.deepEqual(
        [...phoneBoxes(f)],
        [
          ...resolveFreeCollisions(
            kids,
            deriveLayout(kids, 24),
            true,
            Infinity,
          ),
        ],
      )
  }
})

const phoneOrder = (f: Node) =>
  [...phoneBoxes(f)]
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
    .map(([id]) => id)
const full = (y: number, h = 2) => ({ x: 0, y, w: 24, h, z: 0 })

test("phone reads desktop row by row, and a row's columns left to right, even when their tops differ", () => {
  // A left column of two blocks beside a taller block on the right that starts a row higher: the left column reads first.
  const f = free([
    c('about', 0, 2, 16, 6),
    c('papers', 0, 9, 16, 8),
    c('news', 16, 1, 8, 16),
    c('footer', 0, 20, 24, 3),
  ])
  assert.deepEqual(phoneOrder(f), ['about', 'papers', 'news', 'footer'])
  assert.deepEqual(
    phoneOrder(f),
    groupOrder(f.children!).map(w => w.id),
    "the page's own reading order",
  )
  assert.deepEqual(
    phoneOrder(free([c('right', 12, 0, 12, 4), c('left', 0, 1, 12, 4)])),
    ['left', 'right'],
  )
  // The same holds when phone derives from tablet boxes.
  const t = free([
    c('a', 0, 0, 24, 4, undefined, { x: 12, y: 0, w: 12, h: 4, z: 0 }),
    c('b', 0, 6, 24, 4, undefined, { x: 0, y: 1, w: 12, h: 4, z: 0 }),
  ])
  assert.deepEqual(phoneOrder(t), ['b', 'a'])
})

test('in an area with its own phone layout, a block added on desktop since goes where desktop reads it, not at the bottom', () => {
  const f = free([
    c('a', 0, 2, 24, 4, full(0)),
    c('b', 0, 10, 24, 4, full(3)),
    c('top', 0, 0, 24, 2),
    c('mid', 0, 6, 24, 4),
    c('end', 0, 20, 24, 4),
  ])
  assert.deepEqual(phoneOrder(f), ['top', 'a', 'mid', 'b', 'end'])
  const m = phoneBoxes(f)
  assert.deepEqual(
    [
      m.get('top')!.y,
      m.get('a')!.y,
      m.get('mid')!.y,
      m.get('b')!.y,
      m.get('end')!.y,
    ],
    [0, 2, 5, 8, 11],
  )
  assert.deepEqual(
    m.get('a'),
    { ...full(0), y: 2 },
    'a stored box keeps its own size and moves down to make room',
  )
  // A phone-only block's desktop box is its phone box, not a desktop place: a desktop block never follows it, and it keeps its own place.
  const only = {
    ...c('only', 0, 7, 24, 1, full(6)),
    hide: { desktop: true as const },
  } as Node
  assert.deepEqual(
    phoneOrder(
      free([
        c('a', 0, 0, 24, 4, full(0)),
        c('b', 0, 6, 24, 4, full(3)),
        only,
        c('new', 0, 10, 24, 4),
      ]),
    ),
    ['a', 'b', 'new', 'only'],
  )
})

test('an own phone order is kept: stored boxes keep their order and places, and a new block follows the one before it on desktop', () => {
  const f = free([
    c('a', 0, 0, 24, 4, { x: 0, y: 5, w: 24, h: 2, z: 0 }),
    c('b', 0, 6, 24, 4, { x: 2, y: 0, w: 20, h: 4, z: 0 }),
  ])
  assert.deepEqual(phoneBoxes(f).get('a'), { x: 0, y: 5, w: 24, h: 2, z: 0 })
  assert.deepEqual(phoneBoxes(f).get('b'), { x: 2, y: 0, w: 20, h: 4, z: 0 })
  // n comes after b on desktop, so it comes right after b on phone too, and a stays where the person put it.
  assert.deepEqual(phoneOrder(free([...f.children!, c('n', 0, 12, 24, 4)])), [
    'b',
    'n',
    'a',
  ])
  // Blocks put side by side on phone stay together: a new block after the left one goes after both.
  const side = phoneBoxes(
    free([
      c('l', 0, 0, 12, 4, { x: 0, y: 0, w: 12, h: 3, z: 0 }),
      c('r', 12, 0, 12, 4, { x: 12, y: 0, w: 12, h: 3, z: 0 }),
      c('n', 0, 5, 12, 2),
    ]),
  )
  assert.deepEqual(
    [side.get('l')!.y, side.get('r')!.y, side.get('n')!.y],
    [0, 0, 4],
  )
})
