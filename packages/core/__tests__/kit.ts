import { emptySite, find } from '../src/document/index.ts'
import type { Look, Node, Run, SiteDocument } from '../src/document/index.ts'
import { createRegistry } from '../src/registry/index.ts'
import type {
  BlockDef,
  DataSource,
  Plugin,
  Registry,
  SettingFn,
} from '../src/registry/index.ts'

export const LOOK: Look = {
  id: 'plain',
  name: 'Plain',
  family: 'Minimal',
  brand: '#2255aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'sys:serif',
  bodyFont: 'sys:sans',
  corners: 4,
  dark: 'auto',
}

export const node = (
  id: string,
  kind: Node['kind'],
  children?: Node[],
  slot: Node['slot'] = {},
): Node => ({ id, kind, name: id, slot, ...(children ? { children } : {}) })

export const PROJECTS: DataSource = {
  name: 'projects',
  fields: { title: 'text', kind: 'text' },
  sample: [],
}

/** The DEMO block's only look, with local ids (`title`, `list`, `item`, `note`) as a block author writes them. */
export const demoTree = (): Node => ({
  id: 'root',
  kind: 'column',
  name: 'Demo',
  slot: {},
  children: [
    {
      id: 'title',
      kind: 'text',
      name: 'Title',
      slot: {},
      props: { runs: [{ text: 'Old' }], sample: true },
    },
    {
      id: 'list',
      kind: 'list',
      name: 'List',
      slot: {},
      repeat: { source: 'projects', max: 6 },
      children: [
        {
          id: 'item',
          kind: 'column',
          name: 'Item',
          slot: {},
          style: { base: { gap: 12, width: { n: 31, unit: '%' } } },
        },
      ],
    },
    { id: 'note', kind: 'text', name: 'Note', slot: {} },
  ],
})

export const DEMO: BlockDef = {
  id: 'demo',
  version: 1,
  name: 'Demo',
  category: 'utility',
  looks: [{ id: 'default', name: 'Default', tree: demoTree() }],
  settings: [
    {
      key: 'heading',
      label: 'Heading',
      type: 'text',
      actions: [{ do: 'set', path: 'title.props.runs.0.text' }],
    },
    {
      key: 'limit',
      label: 'How many',
      type: 'number',
      min: 1,
      max: 200,
      actions: [{ do: 'set', path: 'list.repeat.max' }],
    },
    {
      key: 'hidenote',
      label: 'Hide note',
      type: 'switch',
      invert: true,
      actions: [{ do: 'set', path: 'note.style.base.hidden' }],
    },
    { key: 'upper', label: 'Upper', type: 'text', fn: 'upper' },
  ],
}

const titleOf = (root: Node) => find(root, `${root.id}.title`)

export const UPPER: SettingFn = {
  read: root => (titleOf(root)?.props?.runs as Run[] | undefined)?.[0].text,
  apply(root, value) {
    const out: Node = JSON.parse(JSON.stringify(root))
    titleOf(out)!.props!.runs = [{ text: String(value).toUpperCase() }]
    return out
  },
}

export const DEMO_PLUGIN: Plugin = {
  name: 'demo',
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  blocks: [DEMO],
  sources: [PROJECTS],
  settingFns: { upper: UPPER },
}

/** A registry holding the DEMO block, its `upper` function and the `projects` source. */
export function sampleRegistry(): Registry {
  const r = createRegistry()
  r.use(DEMO_PLUGIN)
  return r
}

/** A text node holding one line. */
export const text = (
  id: string,
  words: string,
  more: Partial<Node> = {},
): Node => ({
  id,
  kind: 'text',
  name: id,
  slot: {},
  props: { level: 'p', runs: [{ text: words }] },
  ...more,
})

/** A site with one page ("home", slug "/") whose root column holds `children`; `more` overrides fields of the site, and `title` the page's. */
export function siteWith(
  children: Node[] = [],
  more: Partial<SiteDocument> & { title?: string } = {},
): SiteDocument {
  const { title, ...rest } = more
  const doc = emptySite('Ada', LOOK)
  doc.pages[0] = {
    ...doc.pages[0],
    ...(title === undefined ? {} : { title }),
    root: { ...doc.pages[0].root, children },
  }
  return { ...doc, ...rest }
}

/** A list over the `projects` source: one column per row, holding the row's title. */
export const projectsList = (id = 'plist'): Node => ({
  id,
  kind: 'list',
  name: id,
  slot: {},
  repeat: { source: 'projects' },
  children: [
    {
      id: `${id}item`,
      kind: 'column',
      name: 'Item',
      slot: {},
      children: [
        text(`${id}title`, '', {
          props: {
            level: 'p',
            runs: [{ text: '', bind: { from: 'item', field: 'title' } }],
          },
        }),
      ],
    },
  ],
})

export const siteWithProjectsList = (
  more: Partial<SiteDocument> & { title?: string } = {},
): SiteDocument => siteWith([projectsList()], more)

/** A site whose home page has a second page, "about" (slug "/about"), holding `children`. */
export function twoPages(
  home: Node[],
  about: Node[],
  more: Partial<SiteDocument> = {},
): SiteDocument {
  const doc = siteWith(home, more)
  doc.pages.push({
    id: 'about',
    title: 'About',
    slug: '/about',
    icon: 'info',
    on: true,
    inMenu: true,
    inFooter: false,
    root: {
      id: 'aboutroot',
      kind: 'column',
      name: 'Page',
      slot: {},
      children: about,
    },
  })
  return doc
}

/** A node that declares a state and a click trigger that sets it. */
export const stateful = (id = 'tabs'): Node => ({
  id,
  kind: 'column',
  name: id,
  slot: {},
  state: [{ name: 'tab', values: ['talks', 'papers'], initial: 'talks' }],
  children: [
    {
      id: `${id}go`,
      kind: 'button',
      name: 'Go',
      slot: {},
      props: { label: 'Papers', link: { url: 'https://x.org/p' } },
      on: [{ on: 'click', do: { set: 'tab', to: 'papers' } }],
    },
  ],
})
