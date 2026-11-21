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
const links = {
  page: (slug: string) => `/${slug}`,
  file: (id: string) => `/f/${id}`,
  form: () => '/_forms',
}
const withProps = (
  id: string,
  kind: Node['kind'],
  props: Node['props'],
  kids: Node[] = [],
): Node => {
  const n = node(id, kind, kids)
  n.props = props
  return n
}
const switchHeader = (): Node => ({
  ...node('header', 'column', [withProps('hb', 'button', { label: 'Dark' })]),
  state: [{ name: 'mode', values: ['light', 'dark'], initial: 'light' }],
})
const react = (id: string): Node =>
  text(id, id, {
    style: { when: [{ state: 'mode', is: 'dark', decl: { color: 'brand' } }] },
  })
const withHeader = siteWith([react('pr')])
withHeader.header = switchHeader()
withHeader.header.children!.push(react('hr'))
withHeader.header.children![0].on = [
  { on: 'click', do: { set: 'mode', to: 'dark' } },
]
withHeader.pages[0].root.state = [
  { name: 'pg', values: ['a', 'b'], initial: 'b' },
]
const formDoc = siteWith([
  node('fm', 'form', [
    withProps('fb', 'button', { label: 'Submit' }),
    withProps('fo', 'button', {
      label: 'Open',
      command: 'show-modal',
      opens: 'dlg',
    }),
  ]),
  withProps('dlg', 'box', { layer: 'dialog' }, [text('dt', 'Hi')]),
])
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
  ['header with states', withHeader, { registry }],
  ['form with buttons', formDoc, { registry, links }],
  [
    'image through links.file',
    siteWith([withProps('im', 'image', { assetId: 'a1', alt: 'Me' })]),
    { registry, links },
  ],
  [
    'menu',
    siteWith([withProps('mn', 'menu', { which: 'menu' })]),
    { registry, links },
  ],
  [
    'right-to-left',
    siteWith([text('t', 'x')], {
      languages: [{ code: 'en' }, { code: 'fa', dir: 'rtl' }],
    }),
    { registry, lang: 'fa' },
  ],
]
