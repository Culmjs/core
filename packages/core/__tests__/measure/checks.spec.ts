import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Layout, Node } from '../../src/document/index.ts'
import type { Problem } from '../../src/document/problems.ts'
import { findingKey, runChecks, THRESHOLDS } from '../../src/measure/checks.ts'
import type {
  ContrastRaw,
  Finding,
  LayoutRaw,
  MeasuredBox,
  NodeRaw,
} from '../../src/measure/types.ts'
import { node, sampleRegistry, text } from '../kit.ts'

type Box = MeasuredBox
const b = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })
const nr = (
  id: string,
  box: Box | null,
  more: Partial<NodeRaw> = {},
): NodeRaw => ({
  id,
  tag: 'div',
  box,
  visible: true,
  bg: null,
  clip: false,
  fixedOrSticky: false,
  ...more,
})
const layout = (
  l: Layout,
  width: number,
  nodes: NodeRaw[],
  wide: LayoutRaw['wide'] = [],
  docWidth = width,
): LayoutRaw => ({ layout: l, width, docWidth, nodes, wide })
const heading = (id: string, words: string, level = 'h2') =>
  text(id, words, { props: { level, runs: [{ text: words }] } })
type Kind = 'row' | 'column' | 'box' | 'text' | 'button' | 'list'
const w = (
  kind: Kind,
  id: string,
  children?: Node[],
  more: Partial<Node> = {},
): Node => ({ ...node(id, kind, children), ...more })
const page = (...children: Node[]): Node => w('column', 'root', children)

type Extra = {
  contrast?: ContrastRaw[]
  fonts?: boolean
  problems?: Problem[]
  dir?: 'ltr' | 'rtl'
}
const run = (layouts: LayoutRaw[], root: Node, x: Extra = {}) =>
  runChecks({
    revision: 7,
    page: 'home',
    dir: x.dir ?? 'ltr',
    layouts,
    contrast: x.contrast ?? [],
    root,
    registry: sampleRegistry(),
    loaded: { fonts: x.fonts ?? true, assets: true },
    ...(x.problems ? { problems: x.problems } : {}),
  })
/** [class, width, nodes] of the findings of one check. */
const only = (f: Finding[], check: string) =>
  f.filter(x => x.check === check).map(x => [x.class, x.width, x.nodes])
const one = (f: Finding[], check: string) => {
  const hits = f.filter(x => x.check === check)
  assert.equal(hits.length, 1)
  return hits[0]
}

test('a box past the phone edge is an off-screen finding with its id, and its children are not repeated', () => {
  const root = page(w('row', 'row1', [w('button', 'btn')], { name: 'links' }))
  const f = run(
    [
      layout(
        'phone',
        390,
        [nr('row1', b(0, 0, 512, 40)), nr('btn', b(400, 0, 100, 40))],
        [
          { id: 'row1', by: 122 },
          { id: 'btn', by: 110 },
        ],
      ),
    ],
    root,
  )
  assert.deepEqual(only(f, 'off-screen'), [[2, 390, ['row1']]])
  const x = one(f, 'off-screen')
  assert.equal(
    x.message,
    'Row "links" is 512 px wide on phone (122 past the screen).',
  )
  assert.equal(x.observed, 122)
  assert.equal(x.expected, 'the block ends within the 390 px window')
  assert.equal(x.theme, 'light')
})

test('a document wider than the window is a horizontal scroll finding', () => {
  const root = page()
  const f = run([layout('phone', 390, [], [], 512)], root)
  assert.deepEqual(only(f, 'h-scroll'), [[2, 390, []]])
  const x = one(f, 'h-scroll')
  assert.equal(x.observed, 122)
  assert.equal(x.expected, 'the page is at most 390 px wide')
  assert.deepEqual(
    only(run([layout('phone', 390, [], [], 390)], root), 'h-scroll'),
    [],
  )
})

test('a child wider than its parent is an overflow finding unless the parent clips; a coloured card is no exception', () => {
  const root = page(w('column', 'sec', [w('box', 'kid')]))
  const nodes = (kid: Partial<NodeRaw>, sec: Partial<NodeRaw> = {}) => [
    nr('sec', b(80, 0, 1120, 400), sec),
    nr('kid', b(60, 0, 1200, 100), kid),
  ]
  const f = run([layout('desktop', 1280, nodes({}))], root)
  assert.deepEqual(only(f, 'overflow'), [[2, 1280, ['kid']]])
  assert.equal(one(f, 'overflow').observed, 60)
  assert.deepEqual(
    only(
      run([layout('desktop', 1280, nodes({}, { clip: true }))], root),
      'overflow',
    ),
    [],
  )
  assert.deepEqual(
    only(
      run([layout('desktop', 1280, nodes({ bg: '#eeeeee' }))], root),
      'overflow',
    ),
    [[2, 1280, ['kid']]],
  )
})

test('body text at 2.1:1 is a contrast finding tagged with its theme and width; large text needs only 3:1', () => {
  const f = run([], page(), {
    contrast: [
      {
        id: 't1',
        scheme: 'dark',
        width: 834,
        ratio: 2.1,
        large: false,
        sampled: false,
      },
      {
        id: 't2',
        scheme: 'light',
        width: 390,
        ratio: 3.2,
        large: true,
        sampled: false,
      },
      {
        id: 't3',
        scheme: 'light',
        width: 390,
        ratio: 4.6,
        large: false,
        sampled: true,
      },
    ],
  })
  assert.deepEqual(only(f, 'contrast'), [[2, 834, ['t1']]])
  const x = one(f, 'contrast')
  assert.equal(x.theme, 'dark')
  assert.equal(x.observed, 2.1)
  assert.equal(x.expected, 'at least 4.5:1')
  const large = run([], page(), {
    contrast: [
      {
        id: 't',
        scheme: 'light',
        width: 390,
        ratio: 2.5,
        large: true,
        sampled: false,
      },
    ],
  })
  assert.equal(one(large, 'contrast').expected, 'at least 3:1')
})

test('section gaps 48, 48, 96, 48 give one rhythm finding on the 96 gap', () => {
  const root = page(
    w('box', 's1'),
    w('box', 's2'),
    w('box', 's3'),
    w('box', 's4'),
    w('box', 's5'),
  )
  const ys = [0, 248, 496, 792, 1040]
  const f = run(
    [
      layout(
        'desktop',
        1280,
        ys.map((y, i) => nr(`s${i + 1}`, b(80, y, 1120, 200))),
      ),
    ],
    root,
  )
  assert.deepEqual(only(f, 'rhythm'), [[3, 1280, ['s3', 's4']]])
  const x = one(f, 'rhythm')
  assert.equal(x.observed, 96)
  assert.equal(x.expected, 'within 25% of the usual gap (48 px)')
  // A section with a background is a reason for its own gaps.
  const bg = run(
    [
      layout(
        'desktop',
        1280,
        ys.map((y, i) =>
          nr(
            `s${i + 1}`,
            b(80, y, 1120, 200),
            i === 3 ? { bg: '#f0f0f0' } : {},
          ),
        ),
      ),
    ],
    root,
  )
  assert.deepEqual(only(bg, 'rhythm'), [])
})

test('left edges 120 and 126 in one section are an alignment finding; 120 and 123 are not', () => {
  const root = page(w('column', 'sec', [w('text', 'a'), w('text', 'b')]))
  const at = (x: number) => [
    nr('sec', b(80, 0, 1120, 400)),
    nr('a', b(120, 0, 400, 40)),
    nr('b', b(x, 60, 400, 40)),
  ]
  const f = run([layout('desktop', 1280, at(126))], root)
  assert.deepEqual(only(f, 'alignment'), [[3, 1280, ['a', 'b']]])
  assert.equal(one(f, 'alignment').observed, 6)
  assert.equal(
    one(f, 'alignment').expected,
    'left edges within 4 px of the usual edge (120 px)',
  )
  assert.deepEqual(
    only(run([layout('desktop', 1280, at(123))], root), 'alignment'),
    [],
  )
})

test('a block placed in the centre with margins 100 and 110 is a symmetry finding; left-aligned text with margins 40 and 47 is not', () => {
  const center = { style: { base: { place: 'center' as const } } }
  const root = page(
    w('column', 'sec', [w('box', 'c', [], center), w('text', 't')]),
  )
  const nodes = (cRight: number) => [
    nr('sec', b(80, 0, 1120, 400)),
    nr('c', b(180, 0, 1120 - 100 - cRight, 100)),
    nr('t', b(120, 200, 1120 - 40 - 47, 40)),
  ]
  const f = run([layout('desktop', 1280, nodes(110))], root)
  assert.deepEqual(only(f, 'symmetry'), [[3, 1280, ['c']]])
  assert.equal(one(f, 'symmetry').observed, 10)
  assert.equal(one(f, 'symmetry').expected, 'margins within 4 px of each other')
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes(102))], root), 'symmetry'),
    [],
  )
  // A parent that centres its children makes them centred too.
  const byParent = page(
    w('column', 'sec', [w('box', 'c'), w('text', 't')], {
      style: { base: { align: 'center' } },
    }),
  )
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes(110))], byParent), 'symmetry'),
    [
      [3, 1280, ['c']],
      [3, 1280, ['t']],
    ],
  )
})

test('a fill-width child at 40 next to a block at 46 is an alignment finding', () => {
  const root = page(w('column', 'sec', [w('text', 'fill'), w('text', 'b')]))
  const nodes = [
    nr('sec', b(0, 0, 1280, 400)),
    nr('fill', b(40, 0, 1200, 40)),
    nr('b', b(46, 60, 400, 40)),
  ]
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes)], root), 'alignment'),
    [[3, 1280, ['fill', 'b']]],
  )
})

test('a row of equal items with unequal widths is a symmetry finding', () => {
  const root = page(
    w('row', 'cards', [
      w('box', 'k1', [], { name: 'Card' }),
      w('box', 'k2', [], { name: 'Card' }),
    ]),
  )
  const cards = [
    nr('cards', b(80, 500, 1120, 200)),
    nr('k1', b(80, 500, 540, 200)),
    nr('k2', b(640, 500, 560, 200)),
  ]
  const f = run([layout('desktop', 1280, cards)], root)
  assert.deepEqual(only(f, 'symmetry'), [[3, 1280, ['k1', 'k2']]])
  assert.equal(one(f, 'symmetry').observed, 20)
  assert.equal(one(f, 'symmetry').expected, 'widths within 4 px of each other')
})

// wrap(): a full-width outer column around a centred 1120 px column with 40 px side padding.
const wrapped = (id: string, inner = true) =>
  w('column', id, [
    inner
      ? w('column', `${id}c`, [w('text', `${id}t`)], {
          style: { base: { place: 'center' } },
        })
      : w('text', `${id}t`),
  ])
const wrapNodes = (
  id: string,
  y: number,
  h: number,
  inner = true,
  width = 1280,
  more: Partial<NodeRaw> = {},
) => {
  const col = Math.min(1120, width)
  const x = (width - col) / 2
  return inner
    ? [
        nr(id, b(0, y, width, h), more),
        nr(`${id}c`, b(x, y, col, h)),
        nr(`${id}t`, b(x + 40, y + 48, col - 80, h - 96)),
      ]
    : [
        nr(id, b(0, y, width, h), more),
        nr(`${id}t`, b(0, y + 48, width, h - 96)),
      ]
}

test('a wrap()-shaped section has no column finding; a fill column with no inner constraint does', () => {
  const root = page(wrapped('s1'), wrapped('s2', false))
  const f = run(
    [
      layout('desktop', 1280, [
        ...wrapNodes('s1', 0, 300),
        ...wrapNodes('s2', 300, 300, false),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(f, 'column'), [[3, 1280, ['s2']]])
  assert.equal(one(f, 'column').observed, 1280)
  assert.equal(one(f, 'column').expected, '1120 px, within 4 px')
  const tablet = run(
    [layout('tablet', 834, [...wrapNodes('s1', 0, 300, true, 834)])],
    page(wrapped('s1')),
  )
  assert.deepEqual(only(tablet, 'column'), [])
})

test('a side-header root narrower than 1280 is the main column for normal sections', () => {
  const root = page(wrapped('s1'))
  const nodes = [
    nr('root', b(280, 0, 1000, 600)),
    nr('s1', b(280, 0, 1000, 300)),
    nr('s1c', b(280, 0, 1000, 300)),
    nr('s1t', b(320, 48, 920, 204)),
  ]
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes)], root), 'column'),
    [],
  )
})

test('rhythm across wrap()-shaped sections uses the gaps between their visible content', () => {
  const root = page(wrapped('s1'), wrapped('s2'), wrapped('s3'), wrapped('s4'))
  // The outer boxes touch; the text inside is 96, 96 and (with s4's text pushed down) 192 px apart.
  const nodes = [
    ...wrapNodes('s1', 0, 300),
    ...wrapNodes('s2', 300, 300),
    ...wrapNodes('s3', 600, 300),
    ...wrapNodes('s4', 900, 300),
  ]
  nodes.find(n => n.id === 's4t')!.box!.y += 96
  const f = run([layout('desktop', 1280, nodes)], root)
  assert.deepEqual(only(f, 'rhythm'), [[3, 1280, ['s3', 's4']]])
  assert.equal(one(f, 'rhythm').observed, 192)
  // A section with a background is a reason for the gaps around it.
  const bg = [
    ...wrapNodes('s1', 0, 300),
    ...wrapNodes('s2', 300, 300),
    ...wrapNodes('s3', 600, 300, true, 1280, { bg: '#f0f0f0' }),
    ...wrapNodes('s4', 900, 300),
  ]
  bg.find(n => n.id === 's4t')!.box!.y += 96
  assert.deepEqual(only(run([layout('desktop', 1280, bg)], root), 'rhythm'), [])
})

test('an empty 120 px tall box with nothing visible is an empty band; a 40 px one is not', () => {
  const root = page(w('box', 'e', [w('box', 'inner')]))
  const f = run(
    [
      layout('desktop', 1280, [
        nr('e', b(80, 0, 1120, 120), { visible: false }),
        nr('inner', b(80, 0, 1120, 120), { visible: false }),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(f, 'empty-band'), [[3, 1280, ['e']]])
  assert.equal(one(f, 'empty-band').observed, 120)
  assert.equal(
    one(f, 'empty-band').expected,
    'a block taller than 48 px shows something',
  )
  assert.equal(one(f, 'empty-band').cause, undefined)
  assert.deepEqual(
    only(
      run(
        [
          layout('desktop', 1280, [
            nr('e', b(80, 0, 1120, 40), { visible: false }),
          ]),
        ],
        root,
      ),
      'empty-band',
    ),
    [],
  )
})

test('a paragraph with lines over 90 characters on desktop is a line-length finding', () => {
  const root = page(w('text', 'p'))
  const at = (longest: number) => [
    nr('p', b(80, 0, 1120, 100), {
      tag: 'p',
      text: { lines: 3, longest, size: 16, weight: 400 },
    }),
  ]
  const f = run([layout('desktop', 1280, at(120))], root)
  assert.deepEqual(only(f, 'line-length'), [[3, 1280, ['p']]])
  assert.equal(one(f, 'line-length').observed, 120)
  assert.equal(one(f, 'line-length').expected, 'at most 90 characters per line')
  assert.deepEqual(
    only(run([layout('desktop', 1280, at(80))], root), 'line-length'),
    [],
  )
})

test('h1 then h3 is a heading-order finding; two h1 on a page is one too', () => {
  const root = page(
    heading('a', 'Name', 'h1'),
    heading('b', 'Bio', 'h3'),
    heading('c', 'Again', 'h1'),
  )
  const f = run(
    [
      layout('desktop', 1280, [
        nr('a', b(80, 0, 400, 40), { tag: 'h1' }),
        nr('b', b(80, 100, 400, 40), { tag: 'h3' }),
        nr('c', b(80, 200, 400, 40), { tag: 'h1' }),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(f, 'heading-order'), [
    [3, 1280, ['a', 'b']],
    [3, 1280, ['a', 'c']],
  ])
  const hits = f.filter(x => x.check === 'heading-order')
  assert.equal(hits[0].observed, 'h1 then h3')
  assert.equal(
    hits[0].expected,
    'a heading is at most one level below the one before it',
  )
  assert.equal(hits[1].observed, 2)
  assert.equal(hits[1].expected, 'one h1 on the page')
  const fine = run(
    [
      layout('desktop', 1280, [
        nr('a', b(80, 0, 400, 40), { tag: 'h1' }),
        nr('b', b(80, 100, 400, 40), { tag: 'h2' }),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(fine, 'heading-order'), [])
})

test('two headings with the same words one after another are a duplicate', () => {
  const root = page(
    heading('a', 'Short bio'),
    heading('b', 'short  BIO!'),
    heading('c', 'Education'),
  )
  const nodes = ['a', 'b', 'c'].map((id, i) =>
    nr(id, b(80, i * 100, 400, 40), { tag: 'h2' }),
  )
  const f = run([layout('desktop', 1280, nodes)], root)
  assert.deepEqual(only(f, 'duplicate-heading'), [[3, 1280, ['a', 'b']]])
  assert.equal(one(f, 'duplicate-heading').observed, 'short bio')
  assert.equal(
    one(f, 'duplicate-heading').expected,
    'consecutive headings say different words',
  )
})

test('a 30 x 30 phone link is a tap-target finding; a 44 x 44 one is not', () => {
  const root = page(w('button', 'l1'), w('button', 'l2'))
  const nodes = [
    nr('l1', b(0, 0, 30, 30), { tag: 'a', tap: { w: 30, h: 30 } }),
    nr('l2', b(0, 40, 44, 44), { tag: 'a', tap: { w: 44, h: 44 } }),
  ]
  const f = run([layout('phone', 390, nodes)], root)
  assert.deepEqual(only(f, 'tap-target'), [[2, 390, ['l1']]])
  assert.equal(one(f, 'tap-target').observed, '30 x 30')
  assert.equal(one(f, 'tap-target').expected, 'at least 44 x 44 px')
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes)], root), 'tap-target'),
    [],
  )
})

test('a section narrower than 1120 with no background is a column finding; one with a background is not', () => {
  const root = page(w('box', 's1'), w('box', 's2'))
  const f = run(
    [
      layout('desktop', 1280, [
        nr('s1', b(240, 0, 800, 200)),
        nr('s2', b(240, 300, 800, 200), { bg: '#f0f0f0' }),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(f, 'column'), [[3, 1280, ['s1']]])
  assert.equal(one(f, 'column').observed, 800)
})

test('a see-through full-width wrapper is judged by the sections inside it', () => {
  const root = page(w('column', 'wrap', [w('column', 's1'), w('column', 's2')]))
  const nodes = [
    nr('wrap', b(0, 0, 1280, 500)),
    nr('s1', b(80, 0, 1120, 200), { visible: true }),
    nr('s2', b(80, 248, 1120, 200), { visible: true }),
  ]
  assert.deepEqual(
    only(run([layout('desktop', 1280, nodes)], root), 'column'),
    [],
  )
})

test('a row whose children each take the full width at desktop is a stacked-row finding', () => {
  const root = page(w('row', 'r', [w('button', 'x'), w('button', 'y')]))
  const nodes = [
    nr('r', b(80, 0, 1120, 100)),
    nr('x', b(80, 0, 1120, 40)),
    nr('y', b(80, 50, 1120, 40)),
  ]
  const f = run([layout('desktop', 1280, nodes)], root)
  assert.deepEqual(only(f, 'stacked-row'), [[3, 1280, ['r']]])
  assert.equal(one(f, 'stacked-row').observed, 2)
  assert.equal(
    one(f, 'stacked-row').expected,
    'the blocks of a row do not each take its full width',
  )
})

test('overlapping boxes are a finding unless layered front or behind', () => {
  const over = (placement?: Node['placement']) =>
    page(w('box', 'a'), w('box', 'b', [], placement ? { placement } : {}))
  const nodes = [nr('a', b(80, 0, 600, 300)), nr('b', b(400, 100, 600, 300))]
  const f = run([layout('desktop', 1280, nodes)], over())
  assert.deepEqual(only(f, 'overlap'), [[2, 1280, ['a', 'b']]])
  assert.equal(one(f, 'overlap').observed, '280 x 200')
  assert.deepEqual(
    only(
      run([layout('desktop', 1280, nodes)], over({ mode: 'front' })),
      'overlap',
    ),
    [],
  )
  assert.deepEqual(
    only(
      run(
        [
          layout('desktop', 1280, [
            nodes[0],
            { ...nodes[1], fixedOrSticky: true },
          ]),
        ],
        over(),
      ),
      'overlap',
    ),
    [],
  )
  // a list's parts are each the union of every row, so their boxes cross without any row overlapping
  assert.deepEqual(
    only(
      run(
        [layout('desktop', 1280, [{ ...nodes[0], merged: true }, nodes[1]])],
        over(),
      ),
      'overlap',
    ),
    [],
  )
})

test('a heading that moves away from its content on phone is a phone-order finding', () => {
  const sec = (phoneFirst: string) =>
    page(
      w(
        'column',
        'sec',
        ['h', 'p', 'q'].map(id => ({
          ...(id === 'h' ? heading('h', 'Bio') : w('text', id)),
          ...(id === phoneFirst ? { style: { phone: { order: -1 } } } : {}),
        })),
      ),
    )
  const nodes = [
    nr('h', b(80, 0, 400, 40), { tag: 'h2' }),
    nr('p', b(80, 50, 400, 40)),
    nr('q', b(80, 100, 400, 40)),
  ]
  const both = (root: Node) =>
    run([layout('desktop', 1280, nodes), layout('phone', 390, [])], root)
  // Phone order q, h, p keeps the heading next to its paragraph; p, h, q splits them.
  assert.deepEqual(only(both(sec('q')), 'phone-order'), [])
  const f = both(sec('p'))
  assert.deepEqual(only(f, 'phone-order'), [[3, 390, ['h', 'p']]])
  assert.equal(one(f, 'phone-order').observed, 'q')
  assert.equal(
    one(f, 'phone-order').expected,
    'the block after the heading on desktop (p) follows it on phone',
  )
})

test('a blank page has no findings', () => {
  assert.deepEqual(run([layout('desktop', 1280, [])], page()), [])
})

test('rhythm needs at least 3 gaps and a usual gap of 8 px: gaps 0 and 468, or 0, 0 and 468, are no finding', () => {
  const root = page(
    w('box', 's1'),
    w('box', 's2'),
    w('box', 's3'),
    w('box', 's4'),
  )
  const at = (ys: number[]) =>
    run(
      [
        layout(
          'desktop',
          1280,
          ys.map((y, i) => nr(`s${i + 1}`, b(80, y, 1120, 200))),
        ),
      ],
      root,
    )
  assert.deepEqual(only(at([0, 200, 868]), 'rhythm'), [])
  assert.deepEqual(only(at([0, 200, 400, 1068]), 'rhythm'), [])
})

test('an empty band made by a list with no items yet says so in its cause, with no column finding; an empty box has none', () => {
  const list: Node = {
    ...w('list', 'lst', [w('text', 'item')]),
    repeat: { source: 'awards' },
  }
  const root = page(
    w('column', 'sec', [w('column', 'col', [list])]),
    w('column', 'plain', [w('box', 'gap')]),
  )
  const nodes = [
    nr('sec', b(0, 0, 1280, 96), { visible: false }),
    nr('col', b(80, 0, 1120, 0), { visible: false }),
    nr('plain', b(0, 200, 1280, 120), { visible: false }),
    nr('gap', b(80, 200, 1120, 120), { visible: false }),
  ]
  const f = run([layout('desktop', 1280, nodes)], root)
  assert.deepEqual(only(f, 'empty-band'), [
    [3, 1280, ['sec']],
    [3, 1280, ['plain']],
  ])
  const sec = f.find(x => x.nodes[0] === 'sec')!
  assert.match(sec.message, /\(no items yet\)/)
  assert.equal(sec.cause, 'no items yet')
  assert.equal(f.find(x => x.nodes[0] === 'plain')!.cause, undefined)
  assert.deepEqual(only(f, 'column'), [])
})

test("a row's align: center centres vertically, so a wrapped row has no symmetry finding from it; justify does, and on phone the row stacks and align does", () => {
  const kids = () => [w('text', 'name'), w('box', 'menu')]
  const desk = [
    nr('hdr', b(0, 0, 1280, 100)),
    nr('name', b(0, 0, 272, 40)),
    nr('menu', b(1040, 60, 240, 40)),
  ]
  assert.deepEqual(
    only(
      run(
        [layout('desktop', 1280, desk)],
        page(w('row', 'hdr', kids(), { style: { base: { align: 'center' } } })),
      ),
      'symmetry',
    ),
    [],
  )
  assert.equal(
    only(
      run(
        [layout('desktop', 1280, desk)],
        page(
          w('row', 'hdr', kids(), { style: { base: { justify: 'center' } } }),
        ),
      ),
      'symmetry',
    ).length,
    2,
  )
  const phone = [
    nr('hdr', b(0, 0, 390, 100)),
    nr('name', b(0, 0, 272, 40)),
    nr('menu', b(0, 60, 240, 40)),
  ]
  assert.deepEqual(
    only(
      run(
        [layout('phone', 390, phone)],
        page(w('row', 'hdr', kids(), { style: { base: { align: 'center' } } })),
      ),
      'symmetry',
    ),
    [
      [3, 390, ['name']],
      [3, 390, ['menu']],
    ],
  )
})

test('an empty menu beside the name in a header row is no alignment or symmetry finding', () => {
  const root = page(
    w('row', 'hdr', [w('text', 'name'), w('box', 'menu')], {
      style: { base: { align: 'center' } },
    }),
  )
  const f = run(
    [
      layout('desktop', 1280, [
        nr('hdr', b(0, 0, 1280, 64)),
        nr('name', b(120, 12, 272, 40)),
        nr('menu', b(1160, 32, 0, 0)),
      ]),
    ],
    root,
  )
  assert.deepEqual([...only(f, 'alignment'), ...only(f, 'symmetry')], [])
})

test('an overflow finding at phone names the node, the overflow in pixels and the condition', () => {
  const root = page(w('column', 'sec', [w('text', 'title')]))
  const f = run(
    [
      layout('phone', 390, [
        nr('sec', b(16, 0, 100, 200)),
        nr('title', b(16, 0, 312, 40)),
      ]),
    ],
    root,
  )
  const x = one(f, 'overflow')
  assert.equal(x.class, 2)
  assert.equal(x.width, 390)
  assert.deepEqual(x.nodes, ['title'])
  assert.equal(x.observed, 212)
  assert.equal(x.expected, 'a block reaches at most 1 px past its parent')
})

test('a compile problem becomes a class 1 finding', () => {
  const f = run([], page(), {
    problems: [{ code: 'INVALID_OPERATION', message: 'nope', nodeId: 'title' }],
  })
  assert.equal(f.length, 1)
  assert.equal(f[0].check, 'invalid')
  assert.equal(f[0].class, 1)
  assert.deepEqual(f[0].nodes, ['title'])
  assert.equal(f[0].observed, 'INVALID_OPERATION')
  assert.equal(f[0].expected, 'no compile problems')
  assert.equal(f[0].message, 'nope')
})

test('findingKey is the same for two runs and differs by width, theme, direction and node', () => {
  const k = {
    check: 'overflow',
    page: 'home',
    nodes: ['b', 'a'],
    width: 390,
    theme: 'light' as const,
    dir: 'ltr' as const,
  }
  assert.equal(findingKey(k), 'overflow|home|a,b|390|light|ltr')
  assert.equal(findingKey({ ...k }), findingKey(k))
  const keys = new Set([
    findingKey(k),
    findingKey({ ...k, width: 834 }),
    findingKey({ ...k, theme: 'dark' }),
    findingKey({ ...k, dir: 'rtl' }),
    findingKey({ ...k, nodes: ['a'] }),
  ])
  assert.equal(keys.size, 5)
  const root = page(w('column', 'sec', [w('text', 'title')]))
  const lay = () => [
    layout('phone', 390, [
      nr('sec', b(16, 0, 100, 200)),
      nr('title', b(16, 0, 312, 40)),
    ]),
  ]
  assert.equal(
    one(run(lay(), root), 'overflow').key,
    one(run(lay(), root), 'overflow').key,
  )
  assert.notEqual(
    one(run(lay(), root), 'overflow').key,
    one(run(lay(), root, { dir: 'rtl' }), 'overflow').key,
  )
})

test('fonts: false is carried into every finding of the call', () => {
  const root = page(w('column', 'sec', [w('text', 'title')]))
  const f = run(
    [
      layout(
        'phone',
        390,
        [nr('sec', b(16, 0, 100, 200)), nr('title', b(16, 0, 312, 40))],
        [],
        512,
      ),
    ],
    root,
    {
      fonts: false,
      contrast: [
        {
          id: 't',
          scheme: 'light',
          width: 390,
          ratio: 2,
          large: false,
          sampled: false,
        },
      ],
    },
  )
  assert.ok(f.length >= 3)
  assert.ok(f.every(x => x.fonts === false && x.assets === true))
  assert.ok(
    run([layout('phone', 390, [], [], 512)], root).every(x => x.fonts === true),
  )
})

test('the thresholds keep their old values', () => {
  assert.deepEqual(THRESHOLDS, {
    align: 4,
    symmetry: 4,
    rhythm: 0.25,
    emptyBand: 48,
    lineChars: 90,
    tap: 44,
    column: 1120,
    contrastBody: 4.5,
    contrastLarge: 3,
    largePx: 24,
    largeBoldPx: 19,
  })
})

test('contrast observed rounds down, so 4.46 never reads as 4.5', () => {
  const f = run([], page(), {
    contrast: [
      {
        id: 't',
        scheme: 'light',
        width: 390,
        ratio: 4.46,
        large: false,
        sampled: false,
      },
    ],
  })
  assert.equal(one(f, 'contrast').observed, 4.4)
})
