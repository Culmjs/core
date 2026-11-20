import {
  type Code,
  type Component,
  type Node,
  type StateDecl,
} from '../document/index.ts'
import { LAYERS } from '../document/kinds.ts'
import { panelShows, tabSets, tabsOf } from '../document/tabs.ts'
import { isObj } from '../document/rules.ts'
import { RESERVED, STATE_NAME, stateNameOk } from '../style/decl.ts'
import {
  add,
  oneOf,
  only,
  type Ctx,
  type Entry,
  type Obj,
  type TCtx,
  type Tree,
} from './common.ts'
import { linkBad } from './tree.ts'

export const EVENTS = ['click', 'hover', 'enter-view', 'leave-view', 'submit']
export const MAX_STATES = 8
export const MAX_TRIGGERS = 8
export const MAX_STATE_VALUES = 16

export const declIn = (list: unknown, name: unknown): StateDecl | undefined =>
  Array.isArray(list) ? list.find(x => isObj(x) && x.name === name) : undefined

/** The states a component's master holds, through the masters nested in it, with their names. They are local to the use: only its slot children see them. Computed once per component. */
export function masterStates(
  c: Ctx,
  comp: Component | undefined,
): { list: StateDecl[]; names: ReadonlySet<string> } {
  const none = { list: [], names: new Set<string>() }
  if (!comp) return none
  const known = c.stateMemo.get(comp.id)
  if (known) return known
  const list: StateDecl[] = []
  const seen = new Set<string>()
  const visit = (k: Component | undefined) => {
    const tree = k && c.compTrees.get(k.id)
    if (!k || !tree || seen.has(k.id)) return
    seen.add(k.id)
    for (const { w } of tree.entries) {
      if (Array.isArray(w.state))
        for (const s of w.state) if (isObj(s)) list.push(s as StateDecl)
      if (w.kind === 'instance') visit(c.comps.get(w.component as string))
    }
  }
  visit(comp)
  const out = { list, names: new Set(list.map(s => s.name)) }
  c.stateMemo.set(comp.id, out)
  return out
}

/** Whether any node in a tree holds a state of that name, or uses a component whose master does. */
export const heldIn = (c: Ctx, t: Tree | undefined, name: string) =>
  !!t?.entries.some(
    ({ w }) =>
      !!declIn(w.state, name) ||
      (w.kind === 'instance' &&
        masterStates(c, c.comps.get(w.component as string)).names.has(name)),
  )

/**
 * The nearest state of that name held by this node or an ancestor, with its values. A use's slot children also see the states of its component.
 * The header root's states are site-wide, so a page or the footer sees them too.
 */
export function stateIn(
  c: Ctx,
  t: Tree,
  e: Entry | null,
  name: unknown,
): { s: StateDecl; values: string[] } | undefined {
  const found = (s: StateDecl) => ({
    s,
    values:
      s.values === 'on-off'
        ? ['on', 'off']
        : Array.isArray(s.values)
          ? s.values
          : [],
  })
  for (let a = e; a; a = a.parent) {
    const s =
      declIn(a.w.state, name) ??
      (a.w.kind === 'instance'
        ? masterStates(c, c.comps.get(a.w.component as string)).list.find(
            x => x.name === name,
          )
        : undefined)
    if (s) return found(s)
  }
  const site =
    t.which === 'page' || t.which === 'footer'
      ? declIn(c.header?.root.state, name)
      : undefined
  if (site) return found(site)
}

export function checkStates(
  c: Ctx,
  t: TCtx,
  e: Entry,
  say: (message: string, path?: string, code?: Code) => void,
) {
  const { w } = e
  if (w.kind === 'instance') {
    const comp = c.comps.get(w.component as string)
    for (const name of masterStates(c, comp).names)
      if (stateIn(c, t, e.parent, name))
        say(
          `${comp!.name} has a state called ${name}, which this part of the page already has.`,
          'state',
        )
  }
  if (w.state !== undefined) {
    const list = w.state as unknown
    if (!Array.isArray(list) || list.length > MAX_STATES)
      say(`Its states are not a list of at most ${MAX_STATES}.`, 'state')
    else {
      const names = new Set<string>()
      for (const s of list) {
        const v = isObj(s) ? s.values : undefined
        const values =
          v === 'on-off'
            ? ['on', 'off']
            : Array.isArray(v) &&
                v.length >= 2 &&
                v.length <= MAX_STATE_VALUES &&
                v.every(x => typeof x === 'string' && STATE_NAME.test(x)) &&
                new Set(v).size === v.length
              ? (v as string[])
              : null
        if (
          isObj(s) &&
          typeof s.name === 'string' &&
          STATE_NAME.test(s.name) &&
          RESERVED.has(s.name)
        ) {
          say(
            `${s.name} is a word the site uses itself; pick another name.`,
            'state',
          )
          continue
        }
        if (
          !isObj(s) ||
          !only(s, ['name', 'values', 'initial']) ||
          !stateNameOk(s.name) ||
          !values ||
          typeof s.initial !== 'string' ||
          !values.includes(s.initial)
        ) {
          say(
            'A state it holds needs a name, 2 to 16 values and a starting value, all of 1 to 32 lowercase letters, digits and dashes.',
            'state',
          )
          continue
        }
        const name = s.name
        if (names.has(name)) say(`It holds the state "${name}" twice.`, 'state')
        // The header root's names are site-wide: no page or footer holder, nested or not, may reuse one, and the header can't take a name they hold.
        else if (
          (t.which === 'page' || t.which === 'footer') &&
          declIn(c.header?.root.state, name)
        )
          say(`The header already has a state called ${name}.`, 'state')
        else if (
          t.which === 'header' &&
          !e.parent &&
          [...c.pages, c.footer].some(x => heldIn(c, x, name))
        )
          say(
            `A page or the footer already has a state called ${name}.`,
            'state',
          )
        else if (stateIn(c, t, e.parent, name))
          say(
            `The state "${name}" is already held by a node around it.`,
            'state',
          )
        else if (
          w.kind === 'instance' &&
          masterStates(c, c.comps.get(w.component as string)).names.has(name)
        )
          say(`Its state "${name}" is already held by its component.`, 'state')
        names.add(name)
      }
    }
  }
  if (w.on !== undefined) {
    if (!Array.isArray(w.on) || w.on.length > MAX_TRIGGERS)
      say(`Its triggers are not a list of at most ${MAX_TRIGGERS}.`, 'on')
    else
      w.on.forEach((trig, i) => {
        const m = triggerBad(c, t, e, trig)
        if (m) say(m, `on.${i}`)
      })
  }
}

export function triggerBad(
  c: Ctx,
  t: TCtx,
  e: Entry,
  trig: unknown,
): string | null {
  const { w } = e
  if (
    !isObj(trig) ||
    !only(trig, ['on', 'do']) ||
    !oneOf(trig.on, EVENTS) ||
    !isObj(trig.do)
  )
    return 'A trigger needs an event and an action.'
  if (trig.on === 'click' && w.kind !== 'button')
    return 'Click can only go on a button or a link, so everything stays reachable by keyboard.'
  if (trig.on === 'submit' && w.kind !== 'form')
    return 'Submit can only go on a form.'
  // The action's own key, whatever order stored JSON keeps its keys in.
  const d = trig.do
  const verb = Object.keys(d).find(
    k => k !== 'to' && k !== 'by' && k !== 'over',
  )
  if ((verb === 'open' || verb === 'close') && trig.on !== 'click')
    return 'Open and close work on a click.'
  if (verb === 'goTo' && trig.on !== 'click' && trig.on !== 'submit')
    return 'Going to another page works on a click or when a form is sent.'
  const target = (id: unknown) =>
    typeof id === 'string' ? t.targets.get(id) : undefined
  switch (verb) {
    case 'set': {
      const st = only(d, ['set', 'to']) ? stateIn(c, t, e, d.set) : undefined
      if (!st)
        return 'A trigger sets a state that this node and the nodes around it do not hold.'
      return typeof d.to === 'string' && st.values.includes(d.to)
        ? null
        : 'A trigger sets a state to a value it does not have.'
    }
    case 'step': {
      const st = only(d, ['step', 'by', 'over'])
        ? stateIn(c, t, e, d.step)
        : undefined
      if (!st || st.s.values === 'on-off')
        return 'A step moves a list state that this node and the nodes around it hold.'
      const same =
        Array.isArray(d.over) &&
        d.over.length === st.values.length &&
        d.over.every((x, i) => x === st.values[i])
      return (d.by === 1 || d.by === -1) && same
        ? null
        : "A step goes one value forward or back, over the state's own values."
    }
    case 'toggle': {
      const st = only(d, ['toggle']) ? stateIn(c, t, e, d.toggle) : undefined
      return st?.s.values === 'on-off'
        ? null
        : 'A trigger can switch only an on or off state that this node or the nodes around it hold.'
    }
    case 'scrollTo':
      return only(d, ['scrollTo']) && target(d.scrollTo)
        ? null
        : 'A trigger scrolls to a node that does not exist.'
    case 'goTo':
      return only(d, ['goTo']) && !linkBad(d.goTo)
        ? null
        : 'A trigger goes to a page or address that is not valid.'
    case 'open':
    case 'close': {
      const id = d[verb]
      const layer =
        only(d, [verb]) &&
        typeof id === 'string' &&
        isObj(t.here.get(id)?.props)
          ? (t.here.get(id)!.props as Obj).layer
          : undefined
      if (typeof layer !== 'string' || !LAYERS.includes(layer))
        return `A trigger ${verb}s a node that is not a popover or dialog in this tree.`
      if (trig.on === 'click') {
        const p = isObj(w.props) ? w.props : {}
        const commands = (w.on ?? []).filter(
          x =>
            x?.on === 'click' &&
            isObj(x.do) &&
            ('open' in x.do || 'close' in x.do),
        ).length
        if (
          p.link !== undefined ||
          p.command !== undefined ||
          p.action !== undefined ||
          commands > 1
        )
          return 'A button that opens or closes a layer can have only that one command, and no link.'
      }
      return null
    }
    case 'play':
    case 'pause': {
      const id = d[verb]
      return only(d, [verb]) &&
        typeof id === 'string' &&
        target(id)?.kind === 'video'
        ? null
        : `A trigger ${verb}s a node that is not a video.`
    }
    default:
      return 'A trigger has an action this site does not know.'
  }
}

// ---- tabs ----

/** Tabs: a tab sits in a list and sets a state; a panel hides to start with and shows on one value; one list per state holder; each value has one tab and one panel. */
export function checkTabs(c: Ctx, t: Tree) {
  if (!t.entries.some(e => tabsOf(e.w))) return
  const say = (w: Node, message: string, path = 'props.tabs') =>
    add(c, w, message, path)
  const listOf = new Map<StateDecl, Node>()
  const stateOf = new Map<Node, StateDecl>()
  const tabsOn = new Map<StateDecl, { w: Node; to: string }[]>()
  const panelsOn = new Map<StateDecl, { w: Node; is: string }[]>()
  // A state held by the header's root is site-wide: a tab or panel that relies on it would pair across the header and the page.
  const sitewide = (s: StateDecl) =>
    t.which !== 'header' &&
    Array.isArray(c.header?.root.state) &&
    c.header.root.state.includes(s)
  for (const e of t.entries) {
    const w = e.w
    const kind = tabsOf(w)
    if (kind === 'tab') {
      let list: Entry | undefined
      for (let a = e.parent; a && !list; a = a.parent)
        if (tabsOf(a.w) === 'list') list = a
      const bp = isObj(w.props) ? w.props : {}
      if (
        bp.link !== undefined ||
        bp.command !== undefined ||
        bp.opens !== undefined ||
        bp.action !== undefined
      )
        say(w, 'A tab only switches its panel.')
      if (!list) {
        say(w, 'A tab needs to sit inside a tab list.')
        continue
      }
      const set = tabSets(w)
      const st = set && stateIn(c, t, e, set.state)
      if (!set || !st) {
        say(
          w,
          "A tab needs to set the list's state: one click that sets a state this node holds or sits inside.",
          'on',
        )
        continue
      }
      if (sitewide(st.s)) {
        say(w, 'A tab and its panel need to be in the same part of the page.')
        continue
      }
      if (listOf.get(st.s) && listOf.get(st.s) !== list.w)
        say(w, 'Use one tab list for each state.')
      listOf.set(st.s, list.w)
      if (stateOf.get(list.w) && stateOf.get(list.w) !== st.s)
        say(w, 'Every tab in a list needs to set the same state.', 'on')
      stateOf.set(list.w, st.s)
      tabsOn.set(st.s, [...(tabsOn.get(st.s) ?? []), { w, to: set.to }])
    } else if (kind === 'panel') {
      const shows = panelShows(w)
      const st = shows && stateIn(c, t, e, shows.state)
      if (!shows || !st)
        say(
          w,
          'A tab panel needs to be hidden to start with and shown when a state has one value.',
          'style',
        )
      else if (sitewide(st.s))
        say(w, 'A tab and its panel need to be in the same part of the page.')
      else
        panelsOn.set(st.s, [...(panelsOn.get(st.s) ?? []), { w, is: shows.is }])
    } else if (kind === 'list') {
      const lp = isObj(w.props) ? w.props : {}
      if (lp.as === 'nav' || e.parent?.w.kind === 'list')
        say(w, "A tab list can't also be a menu or a list item.")
      let tabCount = 0
      let loose = false
      for (const x of t.entries) {
        let inside = false
        for (let a = x.parent; a; a = a.parent) if (a === e) inside = true
        if (!inside) continue
        if (tabsOf(x.w) === 'tab') tabCount++
        else if (
          x.w.kind === 'button' ||
          (x.w.kind === 'text' &&
            Array.isArray(x.w.props?.runs) &&
            (x.w.props.runs as { link?: unknown }[]).some(
              r => isObj(r) && r.link !== undefined,
            ))
        )
          loose = true
      }
      if (!tabCount) say(w, 'A tab list needs at least one tab.')
      if (loose)
        say(w, 'A tab list can only hold tabs, with no other buttons or links.')
    }
  }
  // Each tab value is set by one tab and shown by one panel.
  for (const [decl, tabs] of tabsOn) {
    const panels = panelsOn.get(decl) ?? []
    for (const x of tabs) {
      if (tabs.filter(y => y.to === x.to).length > 1)
        say(x.w, 'Two tabs set the same value.', 'on')
      else if (panels.filter(p => p.is === x.to).length !== 1)
        say(x.w, 'Each tab needs exactly one panel.', 'on')
    }
    for (const p of panels)
      if (tabs.filter(x => x.to === p.is).length !== 1)
        say(p.w, 'Each panel needs exactly one tab.', 'style')
  }
  for (const e of t.entries) {
    const shows = tabsOf(e.w) === 'panel' ? panelShows(e.w) : undefined
    const st = shows && stateIn(c, t, e, shows.state)
    if (st && !sitewide(st.s) && !listOf.has(st.s))
      say(e.w, 'A tab panel needs a tab list that sets its state.')
  }
}
