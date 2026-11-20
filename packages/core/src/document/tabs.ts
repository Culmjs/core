import type { Node } from './types.ts'
import { isObj } from './rules.ts'
import { walk } from './tree.ts'

/** What a node's `tabs` setting says it is in a set of tabs. */
export const tabsOf = (w: Node): 'list' | 'tab' | 'panel' | undefined => {
  const t = isObj(w.props) ? w.props.tabs : undefined
  return t === 'list' || t === 'tab' || t === 'panel' ? t : undefined
}

/** The state and value a tab sets: its one click trigger that sets a state. */
export function tabSets(w: Node): { state: string; to: string } | undefined {
  const sets = (Array.isArray(w.on) ? w.on : []).filter(
    t => isObj(t) && t.on === 'click' && isObj(t.do) && 'set' in t.do,
  )
  const d =
    sets.length === 1
      ? (sets[0].do as unknown as Record<string, unknown>)
      : undefined
  return d && typeof d.set === 'string' && typeof d.to === 'string'
    ? { state: d.set, to: d.to }
    : undefined
}

/** The state and value that show a panel: hidden to start with, and one `when` layer that shows it. */
export function panelShows(w: Node): { state: string; is: string } | undefined {
  const style = isObj(w.style) ? w.style : undefined
  const when: unknown[] = Array.isArray(style?.when) ? style.when : []
  const shown = when.filter(
    x => isObj(x) && isObj(x.decl) && x.decl.hidden === false,
  )
  const base = isObj(style?.base) ? style.base : undefined
  const x =
    shown.length === 1 && base?.hidden === true
      ? (shown[0] as Record<string, unknown>)
      : undefined
  return x && typeof x.state === 'string' && typeof x.is === 'string'
    ? { state: x.state, is: x.is }
    : undefined
}

export type TabAttrs = Record<string, string | number>

/**
 * The ARIA attributes (and ids) of the lists, tabs and panels in a tree, by node id. A tab and a panel pair up when the same holder's state
 * is set to a value by the tab and shows the panel on that value. A tab outside a list, or a panel without a showing value, gets nothing.
 * `dom` turns a node id into its DOM id, or undefined when it is not safe to write.
 */
export function tabInfo(
  root: Node,
  dom: (id: string) => string | undefined,
): Map<string, TabAttrs> {
  const out = new Map<string, TabAttrs>()
  const parents = new Map<Node, Node | null>()
  const all: Node[] = []
  walk(root, (w, p) => {
    parents.set(w, p)
    all.push(w)
  })
  if (!all.some(w => tabsOf(w))) return out
  const holder = (w: Node, name: string) => {
    for (let a: Node | null | undefined = w; a; a = parents.get(a)) {
      const s = (Array.isArray(a.state) ? a.state : []).find(
        x => isObj(x) && x.name === name,
      )
      if (s) return { id: a.id, initial: s.initial }
    }
  }
  const listOf = (w: Node) => {
    for (let a = parents.get(w); a; a = parents.get(a))
      if (tabsOf(a) === 'list') return a
  }
  const validLists = new Set<string>()
  const key = (h: { id: string }, state: string, v: string) =>
    `${h.id}\0${state}\0${v}`
  const tabIds = new Map<string, string>()
  const panelIds = new Map<string, string>()
  const pair = (w: Node) => {
    const t = tabsOf(w)
    const s = t === 'tab' && listOf(w) ? tabSets(w) : undefined
    const p = t === 'panel' ? panelShows(w) : undefined
    const id = dom(w.id)
    const h =
      id && (s ? holder(w, s.state) : p ? holder(w, p.state) : undefined)
    return h ? { id, h, s, p } : undefined
  }
  for (const w of all) {
    const x = pair(w)
    if (x?.s) {
      tabIds.set(key(x.h, x.s.state, x.s.to), x.id)
      validLists.add(listOf(w)!.id)
    } else if (x?.p) panelIds.set(key(x.h, x.p.state, x.p.is), x.id)
  }
  for (const w of all) {
    if (tabsOf(w) === 'list' && validLists.has(w.id))
      out.set(w.id, { role: 'tablist' })
    const x = pair(w)
    if (x?.s) {
      const panel = panelIds.get(key(x.h, x.s.state, x.s.to))
      out.set(w.id, {
        role: 'tab',
        id: x.id,
        'aria-selected': String(x.h.initial === x.s.to),
        ...(panel ? { 'aria-controls': panel } : {}),
      })
    } else if (x?.p) {
      const tab = tabIds.get(key(x.h, x.p.state, x.p.is))
      out.set(w.id, {
        role: 'tabpanel',
        id: x.id,
        ...(tab ? { 'aria-labelledby': tab } : {}),
      })
    }
  }
  return out
}
