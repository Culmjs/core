import type { Region } from './gpuWorker.ts'

export const bounds = (e: Element) => e.getBoundingClientRect()
export const overlap = (a: DOMRect, b: DOMRect) =>
  b.width > 0 &&
  b.height > 0 &&
  a.left < b.right &&
  b.left < a.right &&
  a.top < b.bottom &&
  b.top < a.bottom

/** Require a visible compiler-identified content leaf, not just the owner's box. */
function content(el: Element) {
  for (const leaf of el.querySelectorAll('[data-gpu-content]')) {
    if (
      ('naturalWidth' in leaf && !leaf.naturalWidth) ||
      ('readyState' in leaf && Number(leaf.readyState) < 2)
    )
      continue
    if (
      !leaf.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue
    const r = bounds(leaf)
    if (
      r.width &&
      r.height &&
      leaf.contains(
        el.ownerDocument.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        ),
      )
    )
      return true
  }
  return false
}

/** The negative-z canvas lives inside isolated main. It can replace the
 * owner's rectangular background only across an otherwise clear paint path. */
export function gpuRect(
  el: Element,
  main: Element,
  forms: DOMRect[],
  w: number,
  h: number,
  bw: number,
  bh: number,
  speed: number,
): Region | undefined {
  const r = bounds(el)
  const l = Math.max(0, r.left),
    t = Math.max(0, r.top),
    right = Math.min(w, r.right),
    bottom = Math.min(h, r.bottom)
  if (
    l >= right ||
    t >= bottom ||
    !main.contains(el) ||
    el.querySelector('[data-culm-gpu]') ||
    forms.some(f => overlap(r, f))
  )
    return
  // If a foreground plate covers the entire visible background, keep it static.
  // Require one exposed sample of the owner's own paint box.
  const clear = (s: CSSStyleDeclaration) =>
    s.backgroundImage === 'none' && s.backgroundColor === 'rgba(0, 0, 0, 0)'
  if (
    ![l + 1, right - 1].some(x =>
      [t + 1, bottom - 1].some(y => {
        let hit = el.ownerDocument.elementFromPoint(x, y)
        while (
          hit !== el &&
          hit?.matches('div,section,p,span,h1,h2,h3,h4,h5,h6') &&
          clear(getComputedStyle(hit))
        )
          hit = hit.parentElement
        return hit === el
      }),
    )
  )
    return
  let inside = true
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = getComputedStyle(n)
    inside &&= n !== main
    if (
      [
        s.opacity,
        s.visibility,
        s.mixBlendMode,
        s.contentVisibility,
        s.willChange,
        s.borderRadius,
      ].join(' ') !== '1 visible normal visible auto 0px' ||
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
      const box = bounds(n)
      if (
        s.borderWidth !== '0px' ||
        l < box.left ||
        right > box.right ||
        t < box.top ||
        bottom > box.bottom
      )
        return
    }
    if (n.parentElement)
      for (const sibling of n.parentElement.children)
        if (
          sibling !== n &&
          !sibling.matches('.culm-plane') &&
          overlap(r, bounds(sibling))
        )
          return
  }
  const x = Math.ceil((r.left * bw) / w),
    y = Math.ceil(((h - r.bottom) * bh) / h)
  const dx = Math.floor((r.right * bw) / w) - x,
    dy = Math.floor(((h - r.top) * bh) / h) - y
  if (
    dx > 0 &&
    dy > 0 &&
    x < bw &&
    y < bh &&
    x + dx > 0 &&
    y + dy > 0 &&
    content(el)
  )
    return [x, y, dx, dy, speed]
}
