import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Layout, Node, SiteDocument } from '../../src/document/index.ts'
import type { Problem } from '../../src/document/problems.ts'
import {
  FIX,
  findingKey,
  runChecks,
  THRESHOLDS,
} from '../../src/measure/checks.ts'
import { RECIPES } from '../../src/ops/recipes.ts'
import type {
  ContrastRaw,
  Finding,
  LayoutRaw,
  MeasuredBox,
  NodeRaw,
} from '../../src/measure/types.ts'
import { search } from '../../src/ops/read.ts'
import { node, sampleRegistry, siteWith, text } from '../kit.ts'

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
type Kind =
  | 'row'
  | 'column'
  | 'box'
  | 'text'
  | 'button'
  | 'list'
  | 'instance'
  | 'shape'
  | 'menu'
  | 'form'
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
  doc?: SiteDocument
  dir?: 'ltr' | 'rtl'
}
const docOf = (root: Node, more: Partial<SiteDocument> = {}): SiteDocument => {
  const d = siteWith([], more)
  d.pages[0]!.root = root
  return d
}
const run = (layouts: LayoutRaw[], root: Node, x: Extra = {}) =>
  runChecks({
    revision: 7,
    page: 'home',
    dir: x.dir ?? 'ltr',
    layouts,
    contrast: x.contrast ?? [],
    doc: x.doc ?? docOf(root),
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
      text: { lines: 3, longest, last: longest, size: 16, weight: 400 },
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

test('the thresholds keep their old values, and add the design ones', () => {
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
    shapeParts: 16,
    shapePath: 3000,
    accentHue: 20,
    accentText: 20,
    chroma: 32,
    stripeSide: 2,
    stripeFlat: 3,
    stripeEdge: [3, 12],
    emojiCount: 3,
    stretchShare: 0.8,
    stretchMin: 280,
    stretchLabel: 2.5,
    charEm: 0.55,
    heroInk: 0.75,
    heroOut: 0.25,
    visualArea: 0.04,
    coverShare: 0.9,
    orphanShare: 0.25,
    gutter: 56,
    longForm: 0.7,
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

test('an overflow inside the header and inside a component instance is found, with the node ids the page draws', () => {
  const lay = (ids: string[]) => [
    layout('phone', 390, [
      ...ids.flatMap(id => [
        nr(`${id}.row`, b(16, 0, 100, 40)),
        nr(`${id}.title`, b(16, 0, 400, 40)),
      ]),
    ]),
  ]
  const strip = (id: string) =>
    w('column', id, [w('row', `${id}.row`, [w('text', `${id}.title`)])])
  const header = strip('hdr')
  const doc = docOf(page(), { header })
  const f = run(lay(['hdr']), page(), { doc })
  const hit = f.filter(x => x.check === 'overflow')
  assert.deepEqual(
    hit.map(x => x.nodes),
    [['hdr.title']],
  )
  const comp = {
    id: 'c1',
    name: 'C',
    root: strip('cr'),
    props: [],
    variants: [],
  }
  const inst = w('instance', 'inst', undefined, { component: 'c1' })
  const withInst = docOf(page(inst), { components: [comp] })
  const g = run(lay(['inst.cr']), page(inst), { doc: withInst })
  assert.deepEqual(
    g.filter(x => x.check === 'overflow').map(x => x.nodes),
    [['inst.cr.title']],
  )
})

// Task 4: shape findings and `fix`.
const shapeNode = (
  id: string,
  props: Record<string, unknown>,
  more: Partial<Node> = {},
  children?: Node[],
): Node =>
  ({
    id,
    kind: 'shape',
    name: id,
    slot: {},
    props,
    ...(children ? { children } : {}),
    ...more,
  }) as Node
const rect = { geometry: { type: 'rect' } }
const req = (id: string, words: string, more: Partial<Node> = {}): Node => ({
  ...heading(id, words),
  required: true,
  ...more,
})
const textBox = (id: string, bx: Box) =>
  nr(id, bx, {
    tag: 'h2',
    text: { lines: 1, longest: 10, last: 10, size: 24, weight: 700 },
  })

test('a front shape over a required heading is shape-covers at each layout where the boxes meet, and not where they do not', () => {
  const root = page(
    req('h', 'Welcome'),
    shapeNode('s', rect, { placement: { mode: 'front' } }),
  )
  const at = (l: Layout, wd: number, sx: number) =>
    layout(l, wd, [
      textBox('h', b(0, 0, 200, 40)),
      nr('s', b(sx, 10, 100, 100)),
    ])
  const f = run(
    [at('desktop', 1280, 50), at('tablet', 834, 50), at('phone', 390, 400)],
    root,
  )
  assert.deepEqual(only(f, 'shape-covers'), [
    [2, 1280, ['s', 'h']],
    [2, 834, ['s', 'h']],
  ])
})

test('the same shape behind, or over a text that is not required, gives no shape-covers', () => {
  const boxes = [textBox('h', b(0, 0, 200, 40)), nr('s', b(50, 10, 100, 100))]
  const behind = page(
    req('h', 'Welcome'),
    shapeNode('s', rect, { placement: { mode: 'behind' } }),
  )
  assert.deepEqual(
    only(run([layout('desktop', 1280, boxes)], behind), 'shape-covers'),
    [],
  )
  const loose = page(
    heading('h', 'Welcome'),
    shapeNode('s', rect, { placement: { mode: 'front' } }),
  )
  assert.deepEqual(
    only(run([layout('desktop', 1280, boxes)], loose), 'shape-covers'),
    [],
  )
})

test('a text inside a required column counts as required', () => {
  const root = page(
    w('column', 'c', [heading('h', 'Welcome')], { required: true }),
    shapeNode('s', rect, { placement: { mode: 'front' } }),
  )
  const f = run(
    [
      layout('desktop', 1280, [
        nr('c', b(0, 0, 300, 60)),
        textBox('h', b(0, 0, 200, 40)),
        nr('s', b(50, 10, 100, 100)),
      ]),
    ],
    root,
  )
  assert.deepEqual(only(f, 'shape-covers'), [[2, 1280, ['s', 'h']]])
})

test('a root shape of 17 parts, or with 3,001 characters of path, is one shape-complex finding at 1280 light; 16 and 3,000 are not', () => {
  const parts = (n: number) =>
    shapeNode(
      'g',
      { geometry: { type: 'group' } },
      {},
      Array.from({ length: n }, (_, i) => shapeNode(`p${i}`, rect)),
    )
  const path = (n: number) =>
    shapeNode('p', { geometry: { type: 'path', d: 'M'.padEnd(n, '0') } })
  const found = (n: Node) =>
    only(run([layout('desktop', 1280, [])], page(n)), 'shape-complex')
  assert.deepEqual(found(parts(17)), [[2, 1280, ['g']]])
  assert.deepEqual(found(parts(16)), [])
  assert.deepEqual(found(path(3001)), [[2, 1280, ['p']]])
  assert.deepEqual(found(path(3000)), [])
  assert.equal(THRESHOLDS.shapeParts, 16)
  assert.equal(THRESHOLDS.shapePath, 3000)
})

test('a shape with a #ff0000 fill, gradient stop or stroke is one raw-colour finding; site colours give none', () => {
  const found = (props: Record<string, unknown>) =>
    only(
      run(
        [layout('desktop', 1280, [])],
        page(shapeNode('s', { ...rect, ...props })),
      ),
      'raw-colour',
    )
  const one1 = [[2, 1280, ['s']]]
  assert.deepEqual(found({ fill: '#ff0000' }), one1)
  assert.deepEqual(found({ fill: { from: 'brand', to: '#ff0000' } }), one1)
  assert.deepEqual(
    found({ fill: '#ff0000', stroke: { color: '#00ff00', width: 2 } }),
    one1,
  )
  assert.deepEqual(found({ stroke: { color: '#00ff00', width: 2 } }), one1)
  assert.deepEqual(
    found({ fill: 'brand', stroke: { color: 'ink', width: 2 } }),
    [],
  )
})

test('every class 2 finding carries the fix of decision 11', () => {
  const root = page(
    w('box', 'a'),
    w('box', 'b'),
    heading('h', 'Hi'),
    shapeNode(
      's',
      { ...rect, fill: '#ff0000' },
      { placement: { mode: 'front' } },
    ),
  )
  const f = run(
    [
      layout(
        'phone',
        390,
        [
          nr('a', b(0, 0, 500, 300)),
          nr('b', b(100, 100, 100, 100), { tap: { w: 30, h: 30 } }),
          textBox('h', b(0, 0, 10, 10)),
        ],
        [{ id: 'a', by: 110 }],
        500,
      ),
    ],
    root,
    {
      contrast: [
        {
          id: 'h',
          scheme: 'light',
          width: 390,
          ratio: 2,
          large: false,
          sampled: false,
        },
      ],
    },
  )
  const FIX: Record<string, string> = {
    'off-screen': 'Let it wrap, or give it a smaller width on phone.',
    overflow: 'Let its row wrap, or shrink it to fit its parent.',
    'h-scroll':
      'Find the widest block at this width and let it wrap or shrink.',
    overlap: 'Space the two blocks apart, or place one behind.',
    'tap-target': 'Give it at least 44 px each way, with padding.',
    contrast: 'Use a site colour with more contrast, or change the background.',
    'shape-covers': 'Place the shape behind, or move it off the text.',
    'shape-complex': 'Use a preset geometry or fewer parts.',
    'raw-colour': 'Use a site colour by name, so dark mode follows.',
    'no-accent':
      'Use the brand colour once below the hero: on a large heading, a divider, a short bar above a heading, or a button.',
  }
  const seen = new Set<string>()
  for (const x of f) {
    if (x.class !== 2) continue
    seen.add(x.check)
    assert.equal(x.fix, FIX[x.check], x.check)
  }
  for (const c of ['off-screen', 'h-scroll', 'tap-target', 'contrast'])
    assert.ok(seen.has(c), c)
  for (const x of f) if (x.class !== 2) assert.equal(x.fix, undefined)
  const o = run(
    [
      layout('desktop', 1280, [
        nr('a', b(0, 0, 100, 100)),
        nr('b', b(50, 50, 100, 100)),
      ]),
    ],
    page(w('box', 'a'), w('box', 'b')),
  )
  assert.equal(one(o, 'overlap').fix, FIX.overlap)
})

test('a labelled shape has no text in the probe and is not found by search text', () => {
  const root = page(
    req('h', ''),
    shapeNode('s', { ...rect, label: 'Welcome' }, { name: 'Wave' }),
  )
  const hits = search({ doc: docOf(root), revision: 1 }, { text: 'Welcome' })
  assert.ok(hits.ok)
  assert.deepEqual(
    hits.rows.filter(r => r.kind === 'shape'),
    [],
  )
})

// Document design findings: no-accent and the AI tells.
const hsl = (h: number) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(
      255 * (0.5 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    )
  }
  return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}`
}
const DOC_FIND = [
  'no-accent',
  'starter-chrome',
  'side-stripe',
  'gradient-text',
  'glow',
  'emoji-icon',
]
const designOf = (root: Node, more: Partial<SiteDocument> = {}) =>
  run([], root, { doc: docOf(root, more) }).filter(f =>
    DOC_FIND.includes(f.check),
  )
const sect = (
  id: string,
  base: Record<string, unknown> = {},
  kids: Node[] = [],
) =>
  w('column', id, [heading(`${id}h`, 'Words'), ...kids], {
    style: { base },
  } as Partial<Node>)
const plain = (...extra: Node[]) =>
  page(sect('s1'), sect('s2'), sect('s3'), ...extra)
const kinds = (f: Finding[]) => f.map(x => x.check)
const BORDER = (width: number, color: string, side: string) => ({
  border: { width, style: 'solid', color, sides: [side] },
})
const card = (base: Record<string, unknown>, id = 'card') =>
  page(
    sect('s1'),
    sect('s2', {}, [
      w('box', id, [text(`${id}t`, 'hi')], {
        style: { base },
      } as Partial<Node>),
    ]),
  )

test('no-accent fires on a page whose sections below the first and footer carry no accent paint; nodes [root]', () => {
  const f = designOf(plain())
  assert.deepEqual(only(f, 'no-accent'), [[2, 1280, ['root']]])
  assert.equal(one(f, 'no-accent').fix?.includes('brand colour'), true)
})

test('no-accent clears with a brand bg block, a 2 px brand border, a shape with no fill, or a brand h2; not with a brand 16 px p or a brand menu', () => {
  const base = (b: Record<string, unknown>, kids: Node[] = []) =>
    page(sect('s1'), sect('s2', b, kids), sect('s3'))
  const clears = (r: Node) => assert.deepEqual(kinds(designOf(r)), [])
  clears(base({ bg: 'brand' }))
  clears(base({ border: { width: 2, style: 'solid', color: 'brand' } }))
  clears(
    base({}, [
      w('shape', 'sh', undefined, { props: { geometry: { type: 'rect' } } }),
    ]),
  )
  clears(
    base({}, [
      text('h', 'Hello', {
        props: { level: 'h2', runs: [{ text: 'Hello' }] },
        style: { base: { color: 'brand' } },
      }),
    ]),
  )
  const fires = (r: Node) => assert.deepEqual(kinds(designOf(r)), ['no-accent'])
  fires(
    base({}, [
      text('p', 'Body', { style: { base: { color: 'brand', size: 16 } } }),
    ]),
  )
  fires(
    base({}, [
      w('menu', 'm', undefined, {
        style: { base: { color: 'brand', size: 30 } },
      }),
    ]),
  )
  fires(base({ border: { width: 1, style: 'solid', color: 'brand' } }))
})

test('a site colour within 20 degrees of the brand hue counts as accent; 21 degrees does not; look.accent equal to ink stands down', () => {
  const brandHue = 217.5
  const tint = (deg: number) =>
    page(sect('s1'), sect('s2', { bg: hsl(brandHue + deg) }), sect('s3'))
  assert.deepEqual(kinds(designOf(tint(19))), [])
  assert.deepEqual(kinds(designOf(tint(-19))), [])
  assert.deepEqual(kinds(designOf(tint(22))), ['no-accent'])
  assert.deepEqual(kinds(designOf(tint(-22))), ['no-accent'])
  const look = { ...docOf(plain()).look, accent: '#111111' as const }
  assert.deepEqual(kinds(designOf(plain(), { look })), [])
})

test('a page with one section gives no no-accent', () => {
  assert.deepEqual(kinds(designOf(page(sect('s1')))), [])
})

test('side-stripe: left 2 px brand border on a card fires; 1 px, a line-coloured side, a full border, a page section and a button do not; radius 0 needs 3 px', () => {
  const fires = (base: Record<string, unknown>, n = 1) =>
    assert.equal(
      kinds(designOf(card(base))).filter(c => c === 'side-stripe').length,
      n,
    )
  fires({ radius: 8, ...BORDER(2, 'brand', 'left') })
  fires({ radius: 8, ...BORDER(1, 'brand', 'left') }, 0)
  fires({ radius: 8, ...BORDER(2, 'line', 'left') }, 0)
  fires({ radius: 8, border: { width: 2, style: 'solid', color: 'brand' } }, 0)
  fires({ radius: 0, ...BORDER(2, 'brand', 'left') }, 0)
  fires({ radius: 0, ...BORDER(3, 'brand', 'left') })
  fires({ radius: 8, ...BORDER(2, 'brand', 'right') })
  const sec = page(
    sect('s1'),
    sect('s2', { radius: 8, ...BORDER(4, 'brand', 'left') }),
  )
  assert.equal(kinds(designOf(sec)).includes('side-stripe'), false)
  const btn = sect('s2', {}, [
    w('button', 'b', undefined, {
      style: { base: { radius: 8, ...BORDER(4, 'brand', 'left') } },
    } as Partial<Node>),
  ])
  assert.equal(
    kinds(designOf(page(sect('s1'), btn))).includes('side-stripe'),
    false,
  )
})

test('side-stripe top or bottom fires at 3 to 12 px on a block with bg or radius, not at 2 or 13', () => {
  const at = (width: number, extra: Record<string, unknown>) =>
    kinds(
      designOf(card({ ...extra, ...BORDER(width, 'brand', 'top') })),
    ).includes('side-stripe')
  assert.equal(at(3, { bg: 'bg' }), true)
  assert.equal(at(12, { radius: 6 }), true)
  assert.equal(at(2, { radius: 6 }), false)
  assert.equal(at(13, { radius: 6 }), false)
  assert.equal(at(4, {}), false)
})

test('gradient-text fires on a text or a button with textFill at any layout', () => {
  const fill = { from: 'brand', to: 'ink', angle: 90 }
  const t = text('g', 'Loud', {
    style: { phone: { textFill: fill } },
  } as Partial<Node>)
  const bt = w('button', 'gb', undefined, {
    style: { base: { textFill: fill } },
  } as Partial<Node>)
  const f = designOf(page(sect('s1'), sect('s2', {}, [t, bt])))
  assert.deepEqual(
    only(f, 'gradient-text').map(x => x[2]),
    [['g'], ['gb']],
  )
})

test('glow fires on look.shadow glow (nodes []) and on a zero-offset blurred brand shadow; a soft offset shadow and a zero-offset grey one do not', () => {
  const look = { ...docOf(plain()).look, shadow: 'glow' as const }
  assert.deepEqual(only(designOf(plain(), { look }), 'glow'), [[2, 1280, []]])
  const sh = (s: unknown) =>
    only(designOf(card({ shadow: s })), 'glow').map(x => x[2])
  assert.deepEqual(sh({ x: 0, y: 0, blur: 24, spread: 0, color: 'brand' }), [
    ['card'],
  ])
  assert.deepEqual(sh({ x: 0, y: 4, blur: 24, spread: 0, color: 'brand' }), [])
  assert.deepEqual(
    sh({ x: 0, y: 0, blur: 24, spread: 0, color: '#888888' }),
    [],
  )
  assert.deepEqual(sh('soft'), [])
  const tx = designOf(
    card({ textShadow: { x: 0, y: 0, blur: 8, color: '#ff00aa' } }),
  )
  assert.deepEqual(
    only(tx, 'glow').map(x => x[2]),
    [['card']],
  )
})

test('emoji-icon fires on a text whose words are only emoji and on each text of a page with 3 emoji; two emoji in a sentence do not', () => {
  const t = (id: string, words: string) => text(id, words)
  const on = (...ts: Node[]) =>
    only(designOf(page(sect('s1'), sect('s2', {}, ts))), 'emoji-icon').map(
      x => x[2],
    )
  assert.deepEqual(on(t('a', '🚀 ✨')), [['a']])
  assert.deepEqual(on(t('a', 'Fast 🚀 and new ✨')), [])
  assert.deepEqual(on(t('a', 'Fast 🚀'), t('b', 'New ✨'), t('c', 'Hot 🔥')), [
    ['a'],
    ['b'],
    ['c'],
  ])
  assert.deepEqual(on(t('a', 'Fast 🚀'), t('b', 'New ✨')), [])
})

test('each design finding is class 2 and carries the fix of decision 14', () => {
  const look = { ...docOf(plain()).look, shadow: 'glow' as const }
  const fill = { from: 'brand', to: 'ink', angle: 90 }
  const r = page(
    sect('s1'),
    sect('s2', {}, [
      text('g', '🚀', { style: { base: { textFill: fill } } } as Partial<Node>),
      w('box', 'c', [], {
        style: { base: { radius: 6, ...BORDER(3, 'brand', 'left') } },
      } as Partial<Node>),
    ]),
  )
  const f = designOf(r, { look })
  assert.deepEqual([...new Set(kinds(f))].sort(), [
    'emoji-icon',
    'glow',
    'gradient-text',
    'side-stripe',
  ])
  for (const x of f) {
    assert.equal(x.class, 2)
    assert.ok(x.fix && x.fix.length > 20, x.check)
  }
  assert.equal(
    one(f, 'glow').fix,
    'Use a shadow with an offset, such as soft, or none.',
  )
})

test('document design rows come once per direction at 1280 light, the same in ltr and rtl', () => {
  const r = page(sect('s1'), sect('s2', {}, [text('g', '🚀')]), sect('s3'))
  const rows = (dir: 'ltr' | 'rtl') =>
    run([], r, { doc: docOf(r), dir })
      .filter(f => DOC_FIND.includes(f.check))
      .map(f => [f.check, f.width, f.theme, f.nodes, f.observed])
  assert.deepEqual(rows('ltr'), rows('rtl'))
  assert.ok(rows('ltr').length >= 2)
  assert.ok(rows('ltr').every(x => x[1] === 1280 && x[2] === 'light'))
  const all = run([layout('desktop', 1280, []), layout('phone', 390, [])], r, {
    doc: docOf(r),
  })
  assert.equal(all.filter(f => f.check === 'no-accent').length, 1)
})

// ---- probe design findings (stage 3b task 3)
const tx = (
  id: string,
  box: Box,
  more: Partial<NodeRaw> = {},
  lines = 1,
  size = 16,
): NodeRaw =>
  nr(id, box, {
    tag: 'p',
    text: { lines, longest: 20, last: 10, size, weight: 400 },
    ...more,
  })
const desk = (nodes: NodeRaw[], width = 1280) =>
  layout(width === 1280 ? 'desktop' : 'tablet', width, nodes)
const ids = (f: Finding[], check: string) =>
  f.filter(x => x.check === check).map(x => x.nodes.join())

test('stretched-button: 1120 px for a 12-character label at 1280 fires; at 390 not; inside a form not; 279 px not; 0.79 of the parent not', () => {
  const btn = () =>
    w('button', 'b', undefined, { props: { label: 'Visit a shop' } })
  const at = (tapW: number, parentW: number, lw = 1280) => {
    const nodes = [
      nr('c', b(80, 0, parentW, 100)),
      tx('b', b(80, 0, tapW, 48), { tap: { w: tapW, h: 48 } }),
    ]
    return layout(
      lw === 390 ? 'phone' : lw === 1280 ? 'desktop' : 'tablet',
      lw,
      nodes,
    )
  }
  const root = (inner: Node) => page(w('column', 'c', [inner]))
  const f = run([at(1120, 1120)], root(btn()))
  const hit = one(f, 'stretched-button')
  assert.deepEqual(hit.nodes, ['b'])
  assert.equal(hit.observed, 1120)
  assert.equal(hit.class, 2)
  assert.equal(
    hit.fix,
    'Set its slot align to start or center, or its width to fit, so it is as wide as its label (recipe buttons).',
  )
  assert.equal(
    only(run([at(700, 700, 834)], root(btn())), 'stretched-button').length,
    1,
  )
  assert.deepEqual(
    only(run([at(300, 300, 390)], root(btn())), 'stretched-button'),
    [],
  )
  assert.deepEqual(
    only(
      run([at(1120, 1120)], page(w('form', 'c', [btn()]))),
      'stretched-button',
    ),
    [],
  )
  assert.deepEqual(
    only(run([at(279, 279)], root(btn())), 'stretched-button'),
    [],
  )
  assert.deepEqual(
    only(run([at(1185, 1500)], root(btn())), 'stretched-button'),
    [],
  )
})

/** A header 'hd' with one text 'hl', and two sections with one text each, at the given left edges. */
const edges = (
  header: [number, number],
  secs: [number, number],
  width = 1280,
) => {
  const root = page(
    w('column', 's1', [text('t1', 'One')]),
    w('column', 's2', [text('t2', 'Two')]),
  )
  const doc = docOf(root, {
    header: w('row', 'hd', [text('hl', 'Logo')]),
  })
  const nodes = [
    nr('root', b(0, 100, width, 600)),
    nr('s1', b(0, 100, width, 200)),
    tx('t1', b(secs[0], 100, 300, 40)),
    nr('s2', b(0, 300, width, 200)),
    tx('t2', b(secs[1], 300, 300, 40)),
    nr('hd', b(0, 0, width, 60)),
    tx('hl', b(header[0], 10, header[1], 40)),
  ]
  return { doc, nodes, root }
}

test('header-edge: header ink at 16 against sections at 32 fires at 1280 and 834; 35 does not; a centred header does not; one section sharing no edge skips', () => {
  const go = (header: [number, number], secs: [number, number]) => {
    const e = edges(header, secs)
    const e2 = edges(header, secs, 834)
    return run([desk(e.nodes), desk(e2.nodes, 834)], e.root, { doc: e.doc })
  }
  const f = go([16, 200], [32, 32])
  assert.deepEqual(
    f
      .filter(x => x.check === 'header-edge')
      .map(x => [x.width, x.nodes, x.observed]),
    [
      [1280, ['hd'], 16],
      [834, ['hd'], 16],
    ],
  )
  assert.equal(
    one(
      f.filter(x => x.width === 1280),
      'header-edge',
    ).fix,
    'Give it the side padding of the sections, or hold its content in a centred column with their max width.',
  )
  assert.deepEqual(ids(go([35, 200], [32, 32]), 'header-edge'), [])
  const c = edges([490, 300], [32, 32])
  assert.deepEqual(
    ids(run([desk(c.nodes)], c.root, { doc: c.doc }), 'header-edge'),
    [],
  )
  assert.deepEqual(ids(go([16, 200], [32, 40]), 'header-edge'), [])
})

test('header-edge in rtl compares right edges', () => {
  // sections end at 1248; the header text starts where they do and ends at 1264
  const e = edges([948, 316], [948, 948])
  assert.deepEqual(
    ids(
      run([desk(e.nodes)], e.root, { doc: e.doc, dir: 'rtl' }),
      'header-edge',
    ),
    ['hd'],
  )
  assert.deepEqual(
    ids(run([desk(e.nodes)], e.root, { doc: e.doc }), 'header-edge'),
    [],
  )
})

test('the footer is judged as the header is', () => {
  const root = page(
    w('column', 's1', [text('t1', 'One')]),
    w('column', 's2', [text('t2', 'Two')]),
  )
  const doc = docOf(root, { footer: w('row', 'ft', [text('fl', 'Foot')]) })
  const nodes = [
    nr('s1', b(0, 100, 1280, 200)),
    tx('t1', b(32, 100, 300, 40)),
    nr('s2', b(0, 300, 1280, 200)),
    tx('t2', b(32, 300, 300, 40)),
    nr('ft', b(0, 600, 1280, 60)),
    tx('fl', b(16, 610, 200, 40)),
  ]
  assert.deepEqual(ids(run([desk(nodes)], root, { doc }), 'header-edge'), [
    'ft',
  ])
})

test('hero-bare: text ink 54% of the column with nothing on the right fires; a shape on the right of 4% area clears; a full-cover behind shape does not; bgImage clears; no h1 in secs[0] skips', () => {
  const hero = (kids: Node[], more: Partial<Node> = {}) =>
    page(
      w('column', 's1', [heading('h', 'Welcome', 'h1'), ...kids], more),
      w('column', 's2', [text('t2', 'x')]),
    )
  const base = [
    nr('s1', b(0, 0, 1280, 600), { bg: '#fafafa' }),
    tx('h', b(80, 100, 604, 80), { tag: 'h1' }),
    nr('s2', b(0, 600, 1280, 100)),
    tx('t2', b(80, 600, 300, 40)),
  ]
  const shape = (id: string, box: Box, mode?: 'behind') =>
    w('shape', id, undefined, {
      props: { geometry: { type: 'rect' } },
      ...(mode ? { placement: { mode } } : {}),
    })
  const f = run([desk(base)], hero([]))
  const hit = one(f, 'hero-bare')
  assert.deepEqual(hit.nodes, ['s1'])
  assert.equal(hit.observed, '54%')
  assert.equal(
    hit.fix,
    'Give the hero a visual on its empty side: an image, shapes placed on that side, or a split into two columns (recipe hero).',
  )
  // a shape on the right: 300 x 104 is 4.06% of the 1280 x 600 section
  assert.deepEqual(
    ids(
      run(
        [desk([...base, nr('sh', b(780, 100, 300, 104))])],
        hero([shape('sh', b(0, 0, 0, 0))]),
      ),
      'hero-bare',
    ),
    [],
  )
  // a full-cover shape behind is a background, not a visual
  assert.deepEqual(
    ids(
      run(
        [desk([...base, nr('sh', b(0, 0, 1280, 600))])],
        hero([shape('sh', b(0, 0, 0, 0), 'behind')]),
      ),
      'hero-bare',
    ),
    ['s1'],
  )
  // a group behind that covers the hero draws its own parts, so it is a visual
  assert.deepEqual(
    ids(
      run(
        [desk([...base, nr('sh', b(0, 0, 1280, 600))])],
        hero([
          w('shape', 'sh', undefined, {
            props: { geometry: { type: 'group' } },
            placement: { mode: 'behind' },
          }),
        ]),
      ),
      'hero-bare',
    ),
    [],
  )
  // a shape of 3% area does not count as a visual
  assert.deepEqual(
    ids(
      run(
        [desk([...base, nr('sh', b(780, 100, 300, 76))])],
        hero([shape('sh', b(0, 0, 0, 0))]),
      ),
      'hero-bare',
    ),
    ['s1'],
  )
  assert.deepEqual(
    ids(
      run(
        [desk(base)],
        hero([], { style: { base: { bgImage: 'photo' } } } as Partial<Node>),
      ),
      'hero-bare',
    ),
    [],
  )
  const noH1 = page(
    w('column', 's1', [heading('h', 'Welcome', 'h2')]),
    w('column', 's2', [text('t2', 'x')]),
  )
  assert.deepEqual(
    ids(
      run(
        [
          desk([
            ...base.slice(0, 1),
            tx('h', b(80, 100, 604, 80), { tag: 'h2' }),
            ...base.slice(2),
          ]),
        ],
        noH1,
      ),
      'hero-bare',
    ),
    [],
  )
})

test('broken-word: a text whose word is split across lines fires with its two-device fix; a whole-word text does not', () => {
  const at = (broken: boolean) =>
    run(
      [
        desk([
          nr('h', b(80, 0, 400, 100), {
            tag: 'p',
            text: {
              lines: 2,
              longest: 10,
              last: 1,
              broken,
              size: 16,
              weight: 400,
            },
          }),
        ]),
      ],
      page(heading('h', 'Permissions', 'h2')),
    )
  const hit = one(at(true), 'broken-word')
  assert.equal(hit.class, 2)
  assert.deepEqual(hit.nodes, ['h'])
  assert.equal(
    hit.fix,
    'Give the column more room, or use a smaller size on phone.',
  )
  assert.deepEqual(ids(at(false), 'broken-word'), [])
})

test('orphan-heading: last line one word fires; last 5 of longest 21 fires; last 6 of 21 with two words does not; one line does not; h3 does not', () => {
  const at = (words: string, last: number, lines = 3, tag = 'h2') =>
    run(
      [
        desk([
          nr('h', b(80, 0, 400, 100), {
            tag,
            text: { lines, longest: 21, last, size: 32, weight: 700 },
          }),
        ]),
      ],
      page(heading('h', words, tag)),
    )
  const hit = one(at('abcdefghij abcdefghij abcdef', 6), 'orphan-heading')
  assert.equal(hit.observed, 6)
  assert.deepEqual(hit.nodes, ['h'])
  assert.equal(
    hit.fix,
    'Set balance on the heading, or change its max width or its words, so the last line holds more than one word.',
  )
  assert.deepEqual(
    ids(at('abcdefghij abcdefghij ab cd', 5), 'orphan-heading'),
    ['h'],
  )
  assert.deepEqual(
    ids(at('abcdefghij abcdefghij ab cde', 6), 'orphan-heading'),
    [],
  )
  assert.deepEqual(
    ids(at('abcdefghij abcdefghij ab', 2, 1), 'orphan-heading'),
    [],
  )
  assert.deepEqual(
    ids(at('abcdefghij abcdefghij abcdef', 1, 3, 'h3'), 'orphan-heading'),
    [],
  )
})

test('bleed-gutter: a bleed section with text at 32 px fires; at 56 not; a non-bleed section never; column and bleed-gutter never name one section', () => {
  const at = (x: number, bg: string | null) => {
    const f = run(
      [
        desk([
          nr('s1', b(0, 0, 1280, 300), { bg }),
          tx('t', b(x, 40, 400, 40)),
        ]),
      ],
      page(w('column', 's1', [text('t', 'Words')])),
    )
    return f
  }
  const f = at(32, '#eeeeee')
  const hit = one(f, 'bleed-gutter')
  assert.deepEqual(hit.nodes, ['s1'])
  assert.equal(hit.observed, 32)
  assert.equal(
    hit.fix,
    'Hold the content in an inner column of max width 1120, centred, or give the section at least 56 px of side padding.',
  )
  assert.deepEqual(ids(f, 'column'), [])
  assert.deepEqual(ids(at(56, '#eeeeee'), 'bleed-gutter'), [])
  assert.deepEqual(ids(at(32, null), 'bleed-gutter'), [])
})

test('all-stacked: a page of stacked sections fires with nodes [root]; one split row clears; a row of buttons or a nav row does not clear; a long-form page skips', () => {
  const sec = (id: string, kids?: Node[]) =>
    w('column', id, kids ?? [heading(`${id}h`, 'Head'), text(`${id}p`, 'Body')])
  const stacked = (y: number) => [
    nr(`s${y}`, b(0, y * 200, 1280, 200), { bg: '#fafafa' }),
    tx(`s${y}h`, b(80, y * 200, 400, 40), { tag: 'h2' }),
    tx(`s${y}p`, b(80, y * 200 + 60, 400, 40)),
  ]
  const base = [...stacked(0), ...stacked(1)]
  const f = run([desk(base)], page(sec('s0'), sec('s1')))
  const hit = one(f, 'all-stacked')
  assert.deepEqual(hit.nodes, ['root'])
  assert.equal(hit.observed, 2)
  assert.equal(
    hit.fix,
    'Set one section as two columns: a grid with the heading beside its text, or text beside an image or a shape (recipe split).',
  )
  // one row with two items side by side clears
  const split = [
    nr('s0', b(0, 0, 1280, 200), { bg: '#fafafa' }),
    tx('s0h', b(80, 0, 400, 40), { tag: 'h2' }),
    tx('s0p', b(700, 0, 400, 40)),
    ...stacked(1),
  ]
  assert.deepEqual(
    ids(run([desk(split)], page(sec('s0'), sec('s1'))), 'all-stacked'),
    [],
  )
  // buttons beside each other are not a split
  const buttons = (as?: string) => [
    nr('s0', b(0, 0, 1280, 200), { bg: '#fafafa' }),
    tx('s0h', b(80, 0, 400, 40), { tag: 'h2' }),
    nr('r', b(80, 60, 400, 48)),
    tx('b1', b(80, 60, 150, 48)),
    tx('b2', b(250, 60, 150, 48)),
    ...stacked(1),
    ...(as ? [] : []),
  ]
  assert.deepEqual(
    ids(
      run(
        [desk(buttons())],
        page(
          sec('s0', [
            heading('s0h', 'Head'),
            w('row', 'r', [w('button', 'b1'), w('button', 'b2')]),
          ]),
          sec('s1'),
        ),
      ),
      'all-stacked',
    ),
    ['root'],
  )
  assert.deepEqual(
    ids(
      run(
        [desk(buttons())],
        page(
          sec('s0', [
            heading('s0h', 'Head'),
            w('row', 'r', [text('b1', 'Home'), text('b2', 'Work')], {
              props: { as: 'nav' },
            }),
          ]),
          sec('s1'),
        ),
      ),
      'all-stacked',
    ),
    ['root'],
  )
  // a page of long paragraphs is long form
  const long = [
    nr('s0', b(0, 0, 1280, 800), { bg: '#fafafa' }),
    tx('s0h', b(80, 0, 400, 40), { tag: 'h2' }),
    tx('s0p', b(80, 60, 600, 700), {}, 8),
    ...stacked(1).slice(0, 1),
    tx('s1h', b(80, 800, 400, 40), { tag: 'h2' }),
    tx('s1p', b(80, 860, 400, 40)),
  ]
  assert.deepEqual(
    ids(run([desk(long)], page(sec('s0'), sec('s1'))), 'all-stacked'),
    [],
  )
  // fewer than two sections: nothing to compare
  assert.deepEqual(
    ids(run([desk(stacked(0))], page(sec('s0'))), 'all-stacked'),
    [],
  )
})

test('header-edge fires on a header with its end button shown and on a full-width footer note, against sections at 32', () => {
  const root = page(
    w('column', 's1', [text('t1', 'One')]),
    w('column', 's2', [text('t2', 'Two')]),
  )
  const secs = [
    nr('s1', b(0, 100, 1280, 200)),
    tx('t1', b(32, 100, 300, 40)),
    nr('s2', b(0, 300, 1280, 200)),
    tx('t2', b(32, 300, 300, 40)),
  ]
  const head = docOf(root, {
    header: w('row', 'hd', [
      text('hl', 'Logo'),
      w('button', 'hb', undefined, { props: { label: 'Order' } }),
    ]),
  })
  const f = run(
    [
      desk([
        ...secs,
        nr('hd', b(0, 0, 1280, 60)),
        tx('hl', b(16, 10, 200, 40)),
        tx('hb', b(1114, 10, 150, 40), { tag: 'a' }),
      ]),
    ],
    root,
    { doc: head },
  )
  assert.deepEqual(ids(f, 'header-edge'), ['hd'])
  const foot = docOf(root, { footer: w('row', 'ft', [text('fl', 'Foot')]) })
  const g = run(
    [
      desk([
        ...secs,
        nr('ft', b(0, 600, 1280, 60)),
        tx('fl', b(16, 610, 1248, 40)),
      ]),
    ],
    root,
    { doc: foot },
  )
  assert.deepEqual(ids(g, 'header-edge'), ['ft'])
})

test('hero-bare reads a stretched button as its label: it fires before and after the button is narrowed', () => {
  const hero = page(
    w('column', 's1', [
      heading('h', 'Welcome', 'h1'),
      w('button', 'bt', undefined, { props: { label: 'Visit a shop' } }),
    ]),
    w('column', 's2', [text('t2', 'x')]),
  )
  const at = (bw: number) =>
    run(
      [
        desk([
          nr('s1', b(0, 0, 1280, 600), { bg: '#fafafa' }),
          tx('h', b(80, 100, 604, 80), { tag: 'h1' }),
          tx('bt', b(80, 200, bw, 48), { tag: 'a', tap: { w: bw, h: 48 } }),
          nr('s2', b(0, 600, 1280, 100)),
          tx('t2', b(80, 600, 300, 40)),
        ]),
      ],
      hero,
    )
  assert.deepEqual(ids(at(1120), 'hero-bare'), ['s1'])
  assert.deepEqual(ids(at(150), 'hero-bare'), ['s1'])
})

test('all-stacked: text beside a shape of visual size clears it; beside a 64 x 4 bar it does not', () => {
  const sec = (id: string, bar: Box) => [
    nr(id, b(0, id === 's0' ? 0 : 300, 1280, 300), { bg: '#fafafa' }),
    tx(`${id}h`, b(80, id === 's0' ? 0 : 300, 400, 40), { tag: 'h2' }),
    nr(`${id}s`, bar),
  ]
  const root = page(
    w('column', 's0', [heading('s0h', 'Head'), w('shape', 's0s')]),
    w('column', 's1', [heading('s1h', 'Head'), text('s1p', 'Body')]),
  )
  const more = [tx('s1p', b(80, 360, 400, 40))]
  const art = (bar: Box) => [
    ...sec('s0', bar),
    ...sec('s1', b(0, 0, 0, 0)).slice(0, 2),
    ...more,
  ]
  assert.deepEqual(
    ids(run([desk(art(b(700, 0, 240, 240)))], root), 'all-stacked'),
    [],
  )
  assert.deepEqual(
    ids(run([desk(art(b(700, 0, 64, 4)))], root), 'all-stacked'),
    ['root'],
  )
})

// Review Focus 2: a fix names devices, never a colour, a geometry or a font, so repaired sites do not converge on one look.
test('every design fix names two devices of its row in DEVICES, names only recipes in RECIPES, and holds no #hex, no geometry type and no font id', () => {
  const DEVICES: Record<string, string[]> = {
    'stretched-button': ['slot align', 'width'],
    'header-edge': ['side padding', 'centred column'],
    'hero-bare': ['image', 'split'],
    'orphan-heading': ['balance', 'max width'],
    'bleed-gutter': ['inner column', 'side padding'],
    'all-stacked': ['grid', 'image'],
    'no-accent': ['divider', 'button'],
    'starter-chrome': ['padding', 'divider'],
    'side-stripe': ['tint', 'hairline'],
    'gradient-text': ['weight', 'shape behind'],
    glow: ['offset', 'none'],
    'emoji-icon': ['icon kind', 'small shape'],
  }
  const ids = new Set(RECIPES.map(r => r.id))
  for (const [check, devices] of Object.entries(DEVICES)) {
    const fix = FIX[check as keyof typeof FIX]!
    for (const d of devices) assert.ok(fix.includes(d), `${check}: ${d}`)
    for (const m of fix.matchAll(/recipe ([a-z-]+)/g))
      assert.ok(ids.has(m[1]!), `${check}: ${m[1]}`)
    assert.doesNotMatch(
      fix,
      /#[0-9a-f]{3,6}|\b(rect|ellipse|polygon|star|blob|path)\b|sys:/i,
      check,
    )
  }
})

test('side-stripe fires on a card with borderLeft {width:3,color:"brand"} and not with borderLeft line-coloured', () => {
  const n = (c: string) =>
    kinds(
      designOf(card({ radius: 8, borderLeft: { width: 3, color: c } })),
    ).filter(k => k === 'side-stripe').length
  assert.equal(n('brand'), 1)
  assert.equal(n('line'), 0)
})

test('no-accent clears with borderBottom {width:2,color:"brand"} and with borderColor brand and borderWidth 2', () => {
  const base = (b: Record<string, unknown>) =>
    page(sect('s1'), sect('s2', b), sect('s3'))
  assert.deepEqual(
    kinds(designOf(base({ borderBottom: { width: 2, color: 'brand' } }))),
    [],
  )
  assert.deepEqual(
    kinds(designOf(base({ borderColor: 'brand', borderWidth: 2 }))),
    [],
  )
  assert.deepEqual(kinds(designOf(base({ borderColor: 'brand' }))), [
    'no-accent',
  ])
})
