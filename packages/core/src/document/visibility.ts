import type { Layout, Node, Style } from './index.ts'

/** Whether a block is drawn on a layout by its `hide` map: desktop hide reaches tablet too, and phone shows it again. */
export const shownOn = (w: Node, layout: Layout): boolean =>
  !w.hide?.[layout] && !(layout === 'tablet' && w.hide?.desktop)

/** Whether style `hidden` hides a node on `layout` in light (`dark = false`) or dark (`dark = true`) scheme. */
export function styleHidden(
  st: Style | undefined,
  layout: Layout,
  dark = false,
): boolean {
  const desktop = dark
    ? (st?.dark?.hidden ?? st?.base?.hidden) === true
    : st?.base?.hidden === true
  if (layout === 'desktop') return desktop
  const tablet = st?.tablet?.hidden !== undefined ? st.tablet.hidden : desktop
  if (layout === 'tablet') return tablet
  return st?.phone?.hidden !== undefined ? st.phone.hidden : tablet
}

/** Whether a node can be shown on `layout` (respecting `hide`, light/dark `style.hidden`, and `when` reveals). */
export function shownAtLayout(w: Node, layout: Layout): boolean {
  if (!shownOn(w, layout)) return false
  if (w.style?.when?.some(x => x.decl?.hidden === false)) return true
  return (
    !styleHidden(w.style, layout, false) || !styleHidden(w.style, layout, true)
  )
}

/** Visibility tuple `[desktop, tablet, phone]` following the compiled CSS cascade. */
export const nodeShownByLayout = (w: Node): [boolean, boolean, boolean] => [
  shownAtLayout(w, 'desktop'),
  shownAtLayout(w, 'tablet'),
  shownAtLayout(w, 'phone'),
]

/** Whether a node can be shown on at least one layout/scheme/state. */
export const nodeCanShow = (w: Node): boolean =>
  nodeShownByLayout(w).some(Boolean)
