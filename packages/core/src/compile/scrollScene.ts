import type { Decl, Layout, Look, Node } from '../document/index.ts'
import { declsOf } from '../document/layers.ts'
import { walk } from '../document/tree.ts'
import { interactiveLayers, layoutDisplays } from '../layout/display.ts'
import type { HtmlNode } from './html.ts'
import { NO, YES, type StateConditions } from './stateConditions.ts'

// clip:pill/arch and line clamping write overflow:hidden after authored overflow.
const overflow = (d?: Decl) =>
  d?.clip === 'pill' || d?.clip === 'arch' || d?.clampLines
    ? true
    : d?.overflow === undefined
      ? undefined
      : d.overflow === 'scroll-x' || d.overflow === 'scroll-y'
const scrollingLayer = (el: HtmlNode | undefined) =>
  el?.tag === 'dialog' || el?.attrs?.popover !== undefined

type Facts = { visible: number; scroller: number }
const layouts = [
  'desktop',
  'tablet',
  'phone',
] as const satisfies readonly Layout[]

/** Check the actual layout/theme AND declared-state conditions on the same path.
 * Only nodes on paths to queried targets need predicates; other page state is never enumerated. */
export function scrollScene(
  root: Node,
  header: Node,
  site: HtmlNode,
  rendered: ReadonlyMap<Node, HtmlNode>,
  classOf: ReadonlyMap<string, string>,
  scheme: Look['dark'],
  side: boolean,
  conditions: StateConditions,
) {
  const parents = new Map<Node, Node | null>()
  walk(root, (w, p) => void parents.set(w, p))
  const memo = new Map<Node, Facts[]>()
  const themes = scheme === 'auto' ? [false, true] : [scheme === 'dark']

  function guard(w: Node, name: string, value: string) {
    let result = NO
    const match = (n: Node, el: HtmlNode | undefined) => {
      if (!el || el.attrs?.[`data-s-${name}`] === undefined) return
      const decl = n.state?.find(s => s.name === name)
      if (decl)
        result = conditions.or(result, conditions.equals(el, decl, value))
    }
    // styles.ts writes holder-self OR matching ancestor selectors. Two holders
    // sharing a name are different variables, including the header on the site wrapper.
    match(header, site)
    for (let n: Node | null | undefined = w; n; n = parents.get(n))
      match(n, rendered.get(n))
    return result
  }

  function facts(w: Node): Facts[] {
    const known = memo.get(w)
    if (known) return known
    const parent = parents.get(w),
      up = parent && facts(parent)
    const el = rendered.get(w),
      cls = classOf.get(w.id)
    const styled =
      !!el &&
      cls !== undefined &&
      String(el.attrs?.class).split(' ').includes(cls)
    const s = styled ? w.style : undefined
    const native = scrollingLayer(el)
    const rules = (s?.when ?? []).flatMap(({ decl, state, is }) => {
      const scroll = overflow(decl)
      return scroll !== undefined || decl.hidden !== undefined
        ? [{ decl, scroll, guard: guard(w, state, is) }]
        : []
    })
    const clamp = rules.reduce(
      (c, r) => (r.decl.clampLines ? conditions.or(c, r.guard) : c),
      NO,
    )
    const evaluate = (hovered: boolean) =>
      themes.flatMap((dark, t) => {
        const plain = styled
          ? layoutDisplays(w, dark, false, hovered)
          : undefined
        const clamped =
          styled && clamp !== NO
            ? layoutDisplays(w, dark, true, hovered)
            : undefined
        const base = overflow(s?.base) ?? native
        const interactive = interactiveLayers.some(
          k => overflow(s?.[k]) === true,
        )
        let scroll =
          ((dark ? overflow(s?.dark) : undefined) ?? (base || interactive))
            ? YES
            : NO
        // Non-visibility when rules precede both responsive layers.
        for (const r of rules)
          if (r.scroll !== undefined)
            scroll = conditions.override(scroll, r.guard, r.scroll)
        return layouts.map((layout, i) => {
          if (layout !== 'desktop') {
            const override = overflow(s?.[layout])
            if (override !== undefined) scroll = override ? YES : NO
          }
          let show =
            (plain?.[layout] ?? true) ? YES : clamped?.[layout] ? clamp : NO
          // Declared-state visibility is emitted last, including over phone hides.
          for (const r of rules)
            if (r.decl.hidden !== undefined)
              show = conditions.override(show, r.guard, !r.decl.hidden)
          return {
            visible: conditions.and(
              up?.[layouts.length * t + i].visible ?? YES,
              el ? show : NO,
            ),
            scroller: scroll,
          }
        })
      })
    // Hover can persist across a state change, but a permanently boxless
    // element never has a way to acquire it.
    let result = evaluate(false)
    if (s?.hover?.clampLines && result.some(v => v.visible !== NO))
      result = evaluate(true)
    memo.set(w, result)
    return result
  }

  return (owner: Node, targets: (Node | undefined)[]) => {
    let views: Facts[][] | undefined
    const targetViews = () =>
      (views ??= targets.flatMap(n => (n && rendered.has(n) ? [facts(n)] : [])))
    for (let n = parents.get(owner); n; n = parents.get(n)) {
      // No scroll source means no satisfiability check (however complex the
      // target's display rules might be). The full cascade decides actual candidates.
      if (
        !scrollingLayer(rendered.get(n)) &&
        !declsOf(n.style).some(d => overflow(d) === true)
      )
        continue
      const scroll = facts(n)
      if (
        scroll.some(f => f.scroller !== NO) &&
        targetViews().some(v =>
          v.some(
            (f, i) => conditions.and(f.visible, scroll[i].scroller) !== NO,
          ),
        )
      )
        return n.id
    }
    if (
      root === header &&
      side &&
      targetViews().some(v =>
        v.some(
          (f, i) => layouts[i % layouts.length] !== 'phone' && f.visible !== NO,
        ),
      )
    )
      return 'site header'
  }
}
