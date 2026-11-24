import type { Decl, Node, Style } from '../document/index.ts'
import { wrapping, type LayoutFlag } from './placement.ts'

type Layer = 'base' | 'tablet' | 'phone'
type Align = NonNullable<Decl['align']>

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
