import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expand } from '../../src/data/index.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import { walk } from '../../src/document/index.ts'
import {
  dropSamples,
  isSample,
  isSampleText,
  touched,
} from '../../src/document/samples.ts'
import type { Node, Run } from '../../src/document/index.ts'
import { LOOK, node } from '../kit.ts'
import { emptySite } from '../../src/document/index.ts'

// Untouched sample text is hidden by provenance (`props.sample`), never by comparing words.
const text = (id: string, ...runs: (string | Run)[]): Node => ({
  ...node(id, 'text'),
  props: {
    level: 'p',
    runs: runs.map(r => (typeof r === 'string' ? { text: r } : r)),
  },
})
const sample = (id: string, t: string): Node => ({
  ...text(id, t),
  props: { level: 'p', runs: [{ text: t }], sample: true },
})
const chrome = (id: string, t: string): Node => ({
  ...text(id, t),
  props: { level: 'h2', runs: [{ text: t }], chrome: true },
})
const owned = (id: string, t: string): Node => ({
  ...text(id, t),
  props: { level: 'p', runs: [{ text: t }], sample: false },
})
const group = (id: string, kids: Node[]): Node => node(id, 'column', kids)
const texts = (w: Node): string[] => {
  const out: string[] = []
  walk(w, x => {
    for (const r of (x.props?.runs as { text?: string }[] | undefined) ?? [])
      if (r.text) out.push(r.text)
  })
  return out
}

test('isSampleText and isSample read the mark', () => {
  assert.ok(isSampleText(sample('a', 'x')) && !isSampleText(owned('a', 'x')))
  const button = {
    ...node('b', 'button'),
    props: { label: 'Go', sample: true },
  }
  assert.ok(isSample(button) && !isSampleText(button))
})

test('a document with no marks comes back as the very same tree', () => {
  const tree = group('block', [
    text('a', 'Book title'),
    text('b', 'Write the days and times.'),
  ])
  assert.equal(dropSamples(tree), tree)
})

test('text the owner wrote that equals a sample line is kept: the mark decides, not the words', () => {
  const tree = group('page', [
    group('block', [
      chrome('title', 'Books'),
      owned('name', 'Book title'),
      sample('blurb', 'A few lines about the book.'),
    ]),
  ])
  assert.deepEqual(texts(dropSamples(tree)), ['Books', 'Book title'])
  // an unmarked text (an older document, or one typed later) is the owner's too
  const older = group('page', [
    group('block', [
      text('name', 'Book title'),
      sample('blurb', 'A few lines about the book.'),
    ]),
  ])
  assert.deepEqual(texts(dropSamples(older)), ['Book title'])
})

test('a block whose values are all samples goes, with its own heading; a block with one filled value stays and loses only the rest', () => {
  const empty = group('block', [
    chrome('title', 'Office hours'),
    sample('times', 'Write the days and times.'),
    sample('place', 'Write where to come.'),
  ])
  const filled = group('block2', [
    chrome('title2', 'Office hours'),
    owned('times2', 'Tuesdays, 10 to 12'),
    sample('place2', 'Write where to come.'),
  ])
  const page = group('page', [empty, filled])
  assert.deepEqual(texts(dropSamples(page)), [
    'Office hours',
    'Tuesdays, 10 to 12',
  ])
  assert.equal(dropSamples(page).children!.length, 1, 'the empty block is gone')
})

test('something else a person put in a block keeps it: a picture, a control, a typed text', () => {
  const image: Node = {
    ...node('img', 'image'),
    props: { src: '/f.png', alt: '' },
  }
  const button: Node = { ...node('go', 'button'), props: { label: 'Email me' } }
  const blockWith = (extra: Node) =>
    dropSamples(
      group('page', [group('block', [sample('s', 'Write a quote.'), extra])]),
    )
  for (const extra of [image, button, text('t', 'Dr. Ada Lovelace')]) {
    const out = blockWith(extra)
    assert.equal(out.children!.length, 1, extra.id)
    assert.ok(!texts(out).includes('Write a quote.'))
  }
  // an image with no file is not the owner's
  assert.equal(
    blockWith({ ...node('img', 'image'), props: { alt: '' } }).children!.length,
    0,
  )
})

test('owner text that shows only on phones keeps its block; a sample that shows only on phones is dropped there too', () => {
  const phoneOnly: Node = {
    ...text('ph', 'Owner phone note'),
    style: { base: { hidden: true }, phone: { hidden: false } },
  }
  assert.ok(
    texts(
      dropSamples(
        group('root', [
          group('blk', [sample('s', 'Write a quote.'), phoneOnly]),
        ]),
      ),
    ).includes('Owner phone note'),
  )
  const phoneSample: Node = {
    ...sample('s', 'Write a quote.'),
    style: { base: { hidden: true }, phone: { hidden: false } },
  }
  assert.deepEqual(
    texts(
      dropSamples(
        group('root', [group('blk', [owned('o', 'Mine'), phoneSample])]),
      ),
    ),
    ['Mine'],
  )
})

test('a block whose only owner text is hidden everywhere goes with its sample', () => {
  const hidden: Node = {
    ...owned('o', 'Hidden words'),
    style: { base: { hidden: true } },
  }
  assert.equal(
    dropSamples(
      group('root', [group('blk', [sample('s', 'Write a quote.'), hidden])]),
    ).children!.length,
    0,
  )
})

test('a sample inside a details or a form is removed, and the block keeps its other content', () => {
  const details: Node = {
    ...node('d', 'details', [sample('a', 'Write the answer here.')]),
    props: { summary: 'Question' },
  }
  const form: Node = node('f', 'form', [sample('fa', 'Write a line.')])
  const out = dropSamples(group('root', [group('blk', [details, form])]))
  assert.deepEqual(texts(out), [])
  assert.equal(out.children!.length, 1)
  assert.equal(out.children![0].children!.length, 2)
})

test("owner text that only a state reveals counts as the owner's: a block holding it is never dropped", () => {
  const panel: Node = {
    ...owned('p', 'Owner panel'),
    style: {
      base: { hidden: true },
      when: [{ state: 'open', is: 'on', decl: { hidden: false } }],
    },
  }
  const tree = group('root', [
    group('blk', [sample('s', 'Write a quote.'), group('wrap', [panel])]),
  ])
  assert.deepEqual(texts(dropSamples(tree)), ['Owner panel'])
})

// Rows are made by `expand`: a copy's id has a `~`.
const rows = [
  { title: 'One', venue: 'V' },
  { title: 'Two', venue: '' },
]
const expanded = (root: Node) =>
  expand(root, {
    data: { rows: { papers: rows } },
    components: [],
    fonts: [],
    styles: defaultSiteStyles(emptySite('x', LOOK).look),
  }).tree
const bound = (id: string, field: string, sampled = false): Node => ({
  ...text(id, { text: '', bind: { from: 'item', field } }),
  props: {
    level: 'p',
    runs: [{ text: '', bind: { from: 'item', field } }],
    ...(sampled ? { sample: true } : {}),
  },
})
const list = (row: Node): Node => ({
  ...node('l', 'list', [row]),
  repeat: { source: 'papers' },
})

test('repeats: a sample inside a repeated row is dropped in every copy, and a connected text is never a sample', () => {
  const row = group('row', [
    sample('note', 'Write a name.'),
    bound('who', 'title', true),
  ])
  const out = texts(
    dropSamples(expanded(group('root', [group('block', [list(row)])]))),
  )
  assert.ok(!out.includes('Write a name.'))
  assert.deepEqual(out, ['One', 'Two'])
})

test('a repeated row keeps what it shows and loses only its sample; rows with nothing but samples are not kept', () => {
  const row = group('row', [
    sample('note', 'Write a note.'),
    bound('t', 'title'),
    bound('v', 'venue'),
  ])
  const tree = dropSamples(
    expanded(
      group('root', [group('blk', [owned('intro', 'My papers'), list(row)])]),
    ),
  )
  let copies = 0
  walk(tree, x => void (x.id.startsWith('row~') && copies++))
  assert.equal(copies, 2)
  assert.ok(!texts(tree).includes('Write a note.'))
  const empty = group('row', [
    sample('note', 'Write a note.'),
    bound('v', 'nothing'),
  ])
  const none = dropSamples(
    expanded(
      group('root', [group('blk', [owned('intro', 'My papers'), list(empty)])]),
    ),
  )
  assert.deepEqual(texts(none), ['My papers'])
  let rest = 0
  walk(none, x => void (x.id.startsWith('row~') && rest++))
  assert.equal(rest, 0)
})

test("touched flips a sample to the owner's and takes the block's own wording off the heading", () => {
  assert.deepEqual(touched({ level: 'p', sample: true }), {
    level: 'p',
    sample: false,
  })
  assert.deepEqual(touched({ level: 'h2', chrome: true }), { level: 'h2' })
  assert.deepEqual(touched({ level: 'p' }), { level: 'p' })
})
