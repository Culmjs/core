import type { Decl, Layout, Node, Style } from '../document/index.ts'
import { wrapping, type LayoutFlag } from './placement.ts'

type Layer = 'base' | 'tablet' | 'phone'
type Align = NonNullable<Decl['align']>

export const interactiveLayers = [
  'hover',
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
] as const

/** An aligned column of list rows shares a single grid track. Dropping that alignment restores flex. */
export function listDisplay(
  w: Node,
  layer: Layer,
  style: Style = w.style ?? {},
): { display: 'grid' | 'flex'; align: Align } | undefined {
  if (w.kind !== 'list' && !(w.kind === 'column' && w.repeat)) return
  const at = <K extends 'align' | 'direction'>(v: Layer, k: K): Decl[K] =>
    style[v]?.[k] ??
    (v === 'phone' ? style.tablet?.[k] : undefined) ??
    style.base?.[k]
  const grid = (v: Layer) =>
    (at(v, 'align') === 'center' || at(v, 'align') === 'end') &&
    at(v, 'direction') !== 'row'
  const align = at(layer, 'align') ?? 'stretch'
  if (grid(layer)) return { display: 'grid', align }
  if (layer !== 'base' && grid(layer === 'phone' ? 'tablet' : 'base'))
    return { display: 'flex', align }
}

export const orderedBox = (w: Node, layout: LayoutFlag): boolean =>
  w.kind === 'box' &&
  !!layout &&
  !!w.children?.some(
    c =>
      c.style?.tablet?.order !== undefined ||
      (layout === true && c.style?.phone?.order !== undefined),
  )

/** A change in the placement/order of children can write a visible display for their parent. */
export function childLayoutDisplay(
  w: Node,
  layout: LayoutFlag,
): 'wrap' | 'ordered' | 'restore' | undefined {
  const tablet = layout === 'tablet'
  if (w.children?.some(c => wrapping(c, layout) && (!tablet || !wrapping(c))))
    return 'wrap'
  if (orderedBox(w, layout)) return 'ordered'
  if (
    layout &&
    w.children?.some(
      c =>
        wrapping(c, layout === true ? 'tablet' : false) && !wrapping(c, layout),
    )
  )
    return 'restore'
}

/** Possible display on each layout in this theme, before the late state visibility
 * rules. Keep the breakpoints distinct: a phone reset mustn't also reveal tablet. */
export function layoutDisplays(
  w: Node,
  dark: boolean,
): Record<Layout, boolean> {
  const s = w.style,
    base = s?.base?.hidden,
    tablet = s?.tablet?.hidden,
    phone = s?.phone?.hidden
  let visible = !base && !w.hide?.desktop
  // State layers precede dark and the breakpoint rules. Clamping supplies its own display.
  if (s && interactiveLayers.some(k => s[k]?.clampLines)) visible = true
  if (dark && s?.dark?.hidden === true) visible = false
  if (dark && (s?.dark?.clampLines || (base && s?.dark?.hidden === false)))
    visible = true
  if (s?.when?.some(x => x.decl.clampLines)) visible = true
  const desktop = visible
  if (base && tablet === false) visible = true
  if (tablet) visible = false
  if (
    s?.tablet?.clampLines ||
    listDisplay(w, 'tablet') ||
    childLayoutDisplay(w, 'tablet')
  )
    visible = true
  if (w.hide?.tablet) visible = false
  const onTablet = visible
  if (
    w.hide?.desktop ||
    w.hide?.tablet ||
    s?.phone?.clampLines ||
    listDisplay(w, 'phone') ||
    childLayoutDisplay(w, true)
  )
    visible = true
  if (phone ?? (s?.dark?.hidden !== false && tablet !== false && base))
    visible = false
  else if (phone === false && (tablet ?? base)) visible = true
  return { desktop, tablet: onTablet, phone: visible && !w.hide?.phone }
}

/** State shows/hides come last. A later hide for the same value wins; covering
 * every value with hides means the underlying layout display can never show. */
export function stateDisplay(
  w: Node,
  values: (name: string) => readonly string[] | 'cut' | undefined,
): boolean | 'cut' | undefined {
  const whens = w.style?.when
  if (!whens?.length) return
  const later = new Map<string, Set<string>>()
  for (let i = whens.length - 1; i >= 0; i--) {
    const { state, is, decl } = whens[i]
    if (decl.hidden === undefined) continue
    const allowed = values(state)
    if (allowed === 'cut') return 'cut'
    if (!allowed?.includes(is)) continue
    const blocked = later.get(state) ?? new Set<string>()
    if (blocked.has(is)) continue
    if (!decl.hidden) return true
    blocked.add(is)
    if (blocked.size === allowed.length) return false
    later.set(state, blocked)
  }
}
