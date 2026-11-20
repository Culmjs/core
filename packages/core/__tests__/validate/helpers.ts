import {
  KINDS,
  emptySite,
  type Node,
  type SiteDocument,
  type SiteStyles,
} from '../../src/document/index.ts'
import { defaultSiteStyles } from '../../src/style/index.ts'
import {
  createRegistry,
  type Plugin,
  type Registry,
} from '../../src/registry/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import { LOOK, node, sampleRegistry } from '../kit.ts'

export const reg = sampleRegistry()
export const base = () => emptySite('x', structuredClone(LOOK))
/** A site whose only page has `root` as its top block. */
export const site = (
  root: Node,
  more: Partial<SiteDocument> = {},
): SiteDocument => ({
  ...base(),
  pages: [{ ...base().pages[0], root }],
  ...more,
})
export const col = (...children: Node[]) => node('r', 'column', children)
export const text = (id: string, extra: Partial<Node> = {}): Node => ({
  id,
  kind: 'text',
  name: id,
  slot: {},
  props: { level: 'p', runs: [{ text: id }] },
  ...extra,
})
export const codes = (d: unknown, r: Registry = reg) =>
  validateSite(d, r).map(p => p.code)
export const ids = (d: unknown, r: Registry = reg) =>
  new Set(validateSite(d, r).map(p => p.nodeId))
export const messages = (d: unknown, r: Registry = reg) =>
  validateSite(d, r).map(p => p.message)

export const n = (o: object) => o as Node
export const fs = (x = 0) => ({ x, y: 0, w: 6, h: 4, z: 0 })
/** A site whose page is a free layout holding `children`. */
export const put = (...children: unknown[]) =>
  site(n({ id: 'r', kind: 'free', name: 'Page', slot: {}, children }), {
    fonts: ['sys:serif', 'sys:sans', 'cat:inter'],
  })
export const dv = (id: string, extra: object = {}) =>
  n({ id, kind: 'divider', name: id, slot: fs(), ...extra })
export const hostile = { toString: 1 }

export function calloutPlugin(): Plugin {
  return {
    name: 'callout',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    kinds: { callout: { ...KINDS.box, label: 'Callout' } },
  }
}

export function card(
  id: string,
  root?: Node,
): SiteDocument['components'][number] {
  return {
    id,
    name: id,
    root: root ?? node('root', 'box', [text('title'), text('badge')]),
    props: [
      {
        key: 'title',
        label: 'Title',
        type: 'text',
        part: 'title',
        field: 'text',
      },
    ],
    variants: [],
  }
}

export const holder = (extra: object = {}, kids: unknown[] = []) => ({
  id: 'tabs',
  kind: 'box',
  name: 'Tabs',
  slot: fs(),
  state: [{ name: 'tab', values: ['talks', 'papers'], initial: 'talks' }],
  children: kids,
  ...extra,
})
export const btn = (
  id: string,
  on: unknown,
  props: object = { label: 'Go', link: { url: 'https://x.org' } },
) => ({
  id,
  kind: 'button',
  name: id,
  slot: {},
  props,
  on,
})
export const reacts = (
  id: string,
  state = 'tab',
  is = 'papers',
  slot: object = {},
) => ({
  id,
  kind: 'text',
  name: 'T',
  slot,
  props: { level: 'p', runs: [] },
  style: { when: [{ state, is, decl: { color: 'brand' } }] },
})
export const okPage = (...r: unknown[]) =>
  validateSite(put(...r), reg).length === 0

export const okFooter = (footer: Node) =>
  validateSite({ ...base(), footer }, reg).length === 0

export const chain = (depth: number): Node => {
  let top: Node = node('leaf', 'box')
  for (let i = depth - 2; i >= 0; i--) top = node(`b${i}`, 'box', [top])
  return top
}
export const wide = (count: number): Node =>
  node(
    'r',
    'column',
    Array.from({ length: count }, (_, i) => node(`n${i}`, 'divider')),
  )

export const PEOPLE = {
  name: 'people',
  fields: {
    name: 'text' as const,
    years: 'number' as const,
    open: 'boolean' as const,
    tags: 'list' as const,
    links: { rows: { label: 'text' as const, href: 'text' as const } },
  },
  sample: [],
}
export const reg2 = (() => {
  const r = sampleRegistry()
  r.use({
    name: 'more',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    sources: [PEOPLE],
  })
  return r
})()
export const item = (kids: unknown[] = [], extra: object = {}) => ({
  id: 'i',
  kind: 'box',
  name: 'I',
  slot: {},
  children: kids,
  ...extra,
})
export const listOver = (
  source: unknown,
  kids: unknown[] = [item()],
  extra: object = {},
) => ({
  id: 'l',
  kind: 'list',
  name: 'L',
  slot: fs(),
  repeat: { source, ...extra },
  children: kids,
})
export const ttl = (bind: object, extra: object = {}) => ({
  id: 't',
  kind: 'button',
  name: 'T',
  slot: {},
  props: { label: '' },
  bind,
  ...extra,
})
export const row = (field: string, outer?: number) => ({
  from: 'item',
  field,
  ...(outer === undefined ? {} : { outer }),
})
export const pc = (p: ReturnType<typeof validateSite>) =>
  p.map(x => [x.code, x.nodeId, x.path])

export type Comp = SiteDocument['components'][number]
export const txt = (id: string) => text(id)
export const master = (children: Node[] = [txt('title'), txt('badge')]) =>
  node('root', 'box', children)
export const comp = (
  id: string,
  root: Node = master(),
  extra: Partial<Comp> = {},
): Comp => ({ ...card(id, root), ...extra })
export const using = (extra: object = {}) => ({
  id: 'i1',
  kind: 'instance',
  name: 'Card',
  slot: fs(),
  component: 'card',
  ...extra,
})
export const withComps = (kids: unknown[], ...components: Comp[]) => ({
  ...put(...kids),
  components,
})
export const inst = (id: string, of: string) =>
  n({ id, kind: 'instance', name: id, slot: {}, component: of })

export function more_(): Partial<Comp> {
  return { root: master([txt('title'), txt('title')]) }
}

export const tx = (id: string, extra: object = {}) => ({
  id,
  kind: 'text',
  name: id,
  slot: fs(),
  props: { level: 'p', runs: [] },
  ...extra,
})
export const own = (): SiteStyles => ({
  ...defaultSiteStyles(LOOK),
  colors: [{ id: 'accent', name: 'Accent', value: '#ff8800' }],
})

export const withRules = (rules: Plugin['rules']): Registry => {
  const r = createRegistry()
  r.use({
    name: 'rules',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    rules,
  })
  return r
}
