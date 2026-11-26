import type { Rect } from './gpuWorker.ts'
declare const CHECKED_GEOMETRY: boolean

type Box = [number, number, number, number]
const box = (r: DOMRect): Box => [r.left, r.top, r.right, r.bottom]
export const bounds = (e: Element) => box(e.getBoundingClientRect())
const { min, max, ceil, floor } = Math
function intersection([l, t, r, b]: Box, [x, y, s, h]: Box): Box | undefined {
  l = max(l, x)
  t = max(t, y)
  r = min(r, s)
  b = min(b, h)
  if (l < r && t < b) return [l, t, r, b]
}
const clear = (s: CSSStyleDeclaration) =>
  s.backgroundImage === 'none' && s.backgroundColor === 'rgba(0, 0, 0, 0)'

/** Sample a rendered text fragment (or confirmed media box) *inside* the
 * visible part of this owner. A leaf elsewhere on the screen proves nothing. */
function content(el: Element, visible: Box) {
  const doc = el.ownerDocument
  const range = doc.createRange()
  for (const leaf of el.querySelectorAll<HTMLElement>('[data-gpu-content]')) {
    if (
      !leaf.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue
    const hit = (r: DOMRect) => {
      const b = intersection(box(r), visible)
      return (
        b &&
        leaf.contains(
          doc.elementFromPoint((b[0] + b[2]) / 2, (b[1] + b[3]) / 2),
        )
      )
    }
    if (leaf.dataset.gpuContent) {
      for (const n of leaf.childNodes)
        if (n.nodeType === 3 && n.textContent!.trim()) {
          range.selectNodeContents(n)
          if (Array.from(range.getClientRects()).some(hit)) return true
        }
    } else if (
      (leaf as HTMLImageElement).naturalWidth !== 0 &&
      !((leaf as HTMLVideoElement).readyState < 2) &&
      hit(leaf.getBoundingClientRect())
    )
      return true
  }
  return false
}

/** Only paint a rectangular background with a clear path to isolated main.
 * Reject ambiguous clip/overlap cases instead of reconstructing CSS paint. */
export function gpuRect(
  el: Element,
  r: Box,
  main: Element,
  forms: Box[],
  w: number,
  h: number,
  bw: number,
  bh: number,
  exact = false,
): Rect | undefined | false {
  const visible = intersection(r, [0, 0, w, h])
  if (!visible) return false // outside: wait for intersection/resize, no polling
  if (forms.some(f => intersection(f, visible)) || !main.contains(el)) return
  const [left, top, right, bottom] = visible
  // Text can cover one edge while the rest of the background is exposed.
  // Require at least one direct owner hit within the visible box.
  const samples = [0.01, 0.5, 0.99]
  if (
    !samples.some(x =>
      samples.some(
        y =>
          el.ownerDocument.elementFromPoint(
            left + (right - left) * x,
            top + (bottom - top) * y,
          ) === el,
      ),
    )
  )
    return
  let inside = true
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = getComputedStyle(n)
    inside &&= n !== main
    if (
      'opacity visibility mixBlendMode contentVisibility willChange borderRadius'
        .split(' ')
        .map(k => s[k as keyof CSSStyleDeclaration])
        .join(' ') !== '1 visible normal visible auto 0px' ||
      'transform translate scale rotate filter backdropFilter perspective clipPath maskImage contain offsetPath'
        .split(' ')
        .some(k => s[k as keyof CSSStyleDeclaration] !== 'none') ||
      (inside &&
        (s.zIndex !== 'auto' ||
          s.position === 'sticky' ||
          s.position === 'fixed' ||
          (n !== el && !clear(s))))
    )
      return
    if (n !== el && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
      const [l, t, r, b] = bounds(n)
      if (
        s.borderWidth !== '0px' ||
        left < l ||
        right > r ||
        top < t ||
        bottom > b
      )
        return
    }
    if (n.parentElement)
      for (const sibling of n.parentElement.children)
        if (
          sibling !== n &&
          !sibling.matches('.culm-plane') &&
          intersection(visible, bounds(sibling))
        )
          return
  }
  const x = ceil((r[0] * bw) / w),
    y = ceil(((h - r[3]) * bh) / h)
  const dx = floor((r[2] * bw) / w) - x,
    dy = floor(((h - r[1]) * bh) / h) - y
  // Removing an authored background along a sub-texel fringe would reveal
  // the plane behind it. Leave such custom placements static.
  if (
    CHECKED_GEOMETRY &&
    exact &&
    [(left * bw) / w, (right * bw) / w, (top * bh) / h, (bottom * bh) / h].some(
      n => !Number.isInteger(n),
    )
  )
    return
  if (min(dx, dy, bw - x, bh - y, x + dx, y + dy) > 0 && content(el, visible))
    return [x, y, dx, dy]
}
