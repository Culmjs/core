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
import { walk } from '../src/document/index.ts'
import type { KindSpec } from '../src/document/index.ts'

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

// ---- the test plug-in: a kind, a rule, a setting function and a block with an insert function

/** A leaf kind. The compiler writes a plug-in kind's tag and attributes only, so the label is also its `tip`. */
const BADGE: KindSpec = {
  role: 'leaf',
  parents: 'any',
  tag: () => 'span',
  display: () => 'inline-block',
  props: {
    label: { type: 'text', maxLength: 40 },
    tip: { type: 'text', maxLength: 40 },
  },
  styles: [],
  states: [],
  bindable: [],
  repeatable: true,
  label: 'Badge',
  icon: 'tag',
}

/** More than three badges in one tree. */
const MAX_BADGES = {
  name: 'max-badges',
  check(doc: SiteDocument) {
    const roots = [
      doc.header,
      doc.footer,
      ...doc.pages.map(p => p.root),
      ...doc.components.map(c => c.root),
    ]
    return roots.flatMap(root => {
      let n = 0
      walk(root, w => {
        if (w.kind === 'badge') n++
      })
      return n > 3
        ? [
            {
              code: 'POLICY_VIOLATION' as const,
              message: `At most 3 badges in one tree, found ${n}.`,
              nodeId: root.id,
            },
          ]
        : []
    })
  },
}

export const stampTree = (): Node => ({
  id: 'root',
  kind: 'column',
  name: 'Stamp',
  slot: {},
  children: [
    {
      id: 'title',
      kind: 'text',
      name: 'Title',
      slot: {},
      required: true,
      props: { runs: [{ text: 'Stamp' }], sample: true },
    },
    {
      id: 'badge',
      kind: 'badge',
      name: 'Badge',
      slot: {},
      props: { label: 'New', tip: 'New' },
    },
  ],
})

export const STAMP: BlockDef = {
  id: 'stamp',
  version: 1,
  name: 'Stamp',
  category: 'utility',
  looks: [{ id: 'default', name: 'Default', tree: stampTree() }],
  // Differs from the look's tree in the title, so a test can tell the function ran.
  onInsert: () => {
    const t = stampTree()
    t.children![0].props = { runs: [{ text: 'Stamped' }], sample: true }
    return t
  },
  settings: [
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      actions: [{ do: 'set', path: 'title.props.runs.0.text' }],
    },
    { key: 'shout', label: 'Shout', type: 'text', fn: 'shout' },
  ],
}

export const SHOUT: SettingFn = {
  read: root =>
    (find(root, `${root.id}.title`)?.props?.runs as Run[] | undefined)?.[0]
      .text,
  apply(root, value) {
    const out: Node = JSON.parse(JSON.stringify(root))
    find(out, `${out.id}.title`)!.props!.runs = [{ text: `${String(value)}!` }]
    return out
  },
}

export const KIT_PLUGIN: Plugin = {
  name: 'kit',
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  kinds: { badge: BADGE },
  rules: [MAX_BADGES],
  blocks: [STAMP],
  settingFns: { shout: SHOUT },
}

/** DEMO_PLUGIN and KIT_PLUGIN. */
export function kitRegistry(): Registry {
  const r = createRegistry()
  r.use(DEMO_PLUGIN)
  r.use(KIT_PLUGIN)
  return r
}

/** A registry whose `demo` block is at version 2: its look adds a text `sub` and drops `note`; `hidenote` and `upper` are gone with them. */
export function demoV2Registry(): Registry {
  const tree = demoTree()
  tree.children = [
    ...tree.children!.filter(c => c.id !== 'note'),
    { id: 'sub', kind: 'text', name: 'Sub', slot: {} },
  ]
  const r = createRegistry()
  r.use({
    ...DEMO_PLUGIN,
    version: 2,
    settingFns: undefined,
    blocks: [
      {
        ...DEMO,
        version: 2,
        looks: [{ id: 'default', name: 'Default', tree }],
        settings: DEMO.settings.slice(0, 2),
      },
    ],
  })
  return r
}

/** One page whose tree holds exactly `n` nodes (the page's root counts): columns of up to nine texts, each text a distinct word. */
export function bigPage(n: number): SiteDocument {
  const kids: Node[] = []
  let left = n - 1
  let i = 0
  const word = (k: number) => `word${k}`
  while (left > 0) {
    if (left === 1) {
      kids.push(text(`t${i}`, word(i)))
      left = 0
    } else {
      const take = Math.min(10, left) - 1
      kids.push(
        node(
          `c${i}`,
          'column',
          Array.from({ length: take }, (_, j) =>
            text(`t${i}x${j}`, word(i * 10 + j + 1000)),
          ),
        ),
      )
      left -= take + 1
    }
    i++
  }
  return siteWith(kids)
}
