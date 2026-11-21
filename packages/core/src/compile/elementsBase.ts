import {
  type Kind,
  type KindSpec,
  type Node,
  type SiteDocument,
} from '../document/index.ts'
import { LAYERS } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { type TabAttrs } from '../document/tabs.ts'
import { type HtmlNode } from './html.ts'
import { ICONS } from './icons.ts'
import { type Links } from './links.ts'

export type ElementCtx = {
  classOf: ReadonlyMap<string, string>
  doc: Pick<SiteDocument, 'pages'>
  links: Links
  mode: 'edit' | 'live'
  /** Measure mode: live output that also writes `data-id`. */
  ids?: boolean
  /** The kinds plug-ins add. */
  kinds?: ReadonlyMap<string, KindSpec>
  mail?: { used: boolean }
  /** The id of the page being shown, so its menu link gets aria-current. */
  current?: string
  /** Nodes a trigger points at, across the page, header and footer; without it the tree's own are used. */
  targets?: ReadonlyMap<string, Node>
  /** This root's states are written on the site wrapper (the header's and the page's), not on the root itself. */
  holds?: boolean
}

/** The context inside the walk: the tree's tab attributes are worked out once. */
export type Inner = ElementCtx & { tabs?: ReadonlyMap<string, TabAttrs> }
export type Attrs = NonNullable<HtmlNode['attrs']>
export type Props = Record<string, unknown>

/** An unrolled id is `<id>.<id>…` through every nested component, plus a `~n` per repeat, so it can run long. */
export const SAFE_ID = /^[a-z0-9.~]{1,2500}$/
/** The DOM id of a node that something points at. The prefix keeps it clear of the page's own ids. */
export const domId = (id: string) => `w-${id}`

/** English words of the markup itself. */
export const UI = {
  menu: 'Menu',
  siteMenu: 'Site menu',
  footerMenu: 'Footer menu',
  breadcrumb: 'Breadcrumb',
  trap: 'Leave this empty',
  name: 'Name',
  email: 'Email',
  message: 'Message',
  subject: 'Subject',
  play: (name: string) => `Play ${name}`,
}

/** A prop's words: a string or a finite number as text, anything else the default. */
export const str = (v: unknown, dflt = ''): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : dflt

export const el = (
  tag: string,
  attrs: Attrs,
  children: (HtmlNode | string | null | false | undefined)[] = [],
): HtmlNode => ({
  tag,
  attrs,
  children: children.filter((c): c is HtmlNode | string => !!c || c === ''),
})

/** An inline icon glyph from the table, or null for a name outside it. */
export function glyph(name: unknown, attrs: Attrs = {}): HtmlNode | null {
  if (typeof name !== 'string' || !Object.hasOwn(ICONS, name)) return null
  return {
    tag: 'svg',
    attrs: {
      viewBox: '0 0 24 24',
      width: '1em',
      height: '1em',
      'aria-hidden': 'true',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      ...attrs,
    },
    raw: { kind: 'icon', content: ICONS[name as keyof typeof ICONS] },
  }
}

/** A popover command also writes the older `popovertarget`, so a browser without invoker commands still opens and closes it. */
const POPOVER_ACTION: Record<string, string> = {
  'show-popover': 'show',
  'hide-popover': 'hide',
  'toggle-popover': 'toggle',
}
export const invoker = (commandfor: string, command: string): Attrs => ({
  commandfor,
  command,
  ...(POPOVER_ACTION[command]
    ? {
        popovertarget: commandfor,
        popovertargetaction: POPOVER_ACTION[command],
      }
    : {}),
})

/** The native command a click on this button gives: the target must be a popover or dialog of this page. */
export function nativeCommand(w: Node, ctx: Inner): Attrs | undefined {
  if (w.kind !== 'button') return undefined
  for (const t of Array.isArray(w.on) ? w.on : []) {
    const d =
      isObj(t) && t.on === 'click' && isObj(t.do)
        ? (t.do as Record<string, unknown>)
        : undefined
    const verb =
      d && ('open' in d ? 'open' : 'close' in d ? 'close' : undefined)
    const id = verb && d[verb]
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue
    const layer = ctx.targets?.get(id)?.props?.layer
    if (typeof layer !== 'string' || !LAYERS.includes(layer)) continue
    return invoker(
      domId(id),
      layer === 'dialog'
        ? verb === 'open'
          ? 'show-modal'
          : 'close'
        : verb === 'open'
          ? 'show-popover'
          : 'hide-popover',
    )
  }
}

/** Everything a kind's builder needs. */
export type Build = {
  w: Node
  p: Props
  ctx: Inner
  parent: Kind | null
  grand: Kind | null
  head: boolean
  /** The attributes every node's element carries. */
  attrs: Attrs
  /** The class every node's element carries, with extras joined. */
  cls: (...extra: (string | false | undefined)[]) => string | undefined
  /** The element a node leaves in edit mode in place of itself: a note that keeps its class, so a Free area keeps its cell. */
  note: (words: string) => HtmlNode | null
  /** The editor's plate for an empty picture or video; the published page leaves it out. */
  plate: (icon: 'photo' | 'video') => HtmlNode | null
  /** The children's elements, each followed in edit mode by the note for a layout it is hidden on. */
  kids: () => (HtmlNode | string)[]
}

/** Every tag a core container can produce. A tag from a prop outside this set becomes a div. */
export const TAGS = new Set(
  'div section article aside nav dialog li ul ol table tr td th h1 h2 h3 h4 h5 h6 p span pre'.split(
    ' ',
  ),
)
