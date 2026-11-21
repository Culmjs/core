import type { CompileOptions } from '../../src/compile/index.ts'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import {
  node,
  projectsList,
  sampleRegistry,
  siteWith,
  siteWithProjectsList,
  stateful,
  text,
} from '../kit.ts'

export const openPopover = (id = 'pop'): Node => {
  const close = node(`${id}x`, 'button')
  close.props = { label: 'Close', command: 'hide-popover', opens: id }
  const pop = node(id, 'box', [text(`${id}t`, 'Inside'), close])
  pop.props = { layer: 'popover-manual', open: true }
  return pop
}

export const mail = (id = 'm'): Node =>
  text(id, '', {
    props: {
      level: 'p',
      runs: [{ text: 'ada@lab.example', link: { email: 'ada@lab.example' } }],
    },
  })
export const mailButton: Node = node('mb', 'button')
mailButton.props = { label: 'Write to me', link: { email: 'ada@lab.example' } }

const sample = (id: string, words: string) =>
  text(id, words, {
    props: { level: 'p', runs: [{ text: words }], sample: true },
  })
const withSamples = siteWith([
  node('blk', 'column', [text('own', 'Mine'), sample('s1', 'Write a quote.')]),
])
withSamples.header = node('header', 'column', [
  text('hown', 'Menu'),
  sample('s2', 'Write a tagline.'),
])
withSamples.footer = node('footer', 'column', [
  text('fown', 'Foot'),
  sample('s3', 'Write a note.'),
])

const registry = sampleRegistry()
const rows = { rows: { projects: [{ title: 'Alpha' }, { title: 'Beta' }] } }

/** Every document the page tests compile, as [name, document, options]; the tools' schema test reads this list too. */
export const FIXTURES: [string, SiteDocument, CompileOptions][] = [
  ['plain page', siteWith([text('t', 'Hello')]), { registry }],
  ['states', siteWith([text('t', 'Hello'), stateful()]), { registry }],
  ['open popover', siteWith([openPopover()]), { registry }],
  ['hidden address', siteWith([mail(), mailButton]), { registry }],
  ['repeated list', siteWithProjectsList(), { registry, data: rows }],
  ['nested lists', siteWith([projectsList('out')]), { registry, data: rows }],
  ['untouched samples', withSamples, { registry }],
]
