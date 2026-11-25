import { bounds } from './gpuGeometry.ts'

// Keep the original background in the compositor. Only promote ordinary
// in-flow foregrounds; unsupported paint is excluded before acquiring a worker.
export function backdrop(el: HTMLElement, main: Element) {
  const style = getComputedStyle(el)
  if (
    style.borderWidth !== '0px' ||
    style.boxShadow !== 'none' ||
    [...el.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim())
  )
    return
  // Elevating overlapping sibling groups could itself change text paint order.
  const boxes = Array.from(el.children, bounds).filter(
    b => b[0] < b[2] && b[1] < b[3],
  )
  if (
    ![0, 1].some(axis =>
      boxes.every((b, i) => !i || b[axis] >= boxes[i - 1][axis + 2]),
    )
  )
    return
  // A covering opaque base hides the whole ancestor paint chain, even
  // before first exposure. Still check the ancestors' stacking constraints.
  const opaque =
    ['border-box', 'padding-box'].includes(style.backgroundClip) &&
    /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.backgroundColor)
  const rgb = style.backgroundImage === 'none' && opaque
  let signature = rgb ? style.backgroundColor : style.background
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = getComputedStyle(n)
    if (n !== main && (s.isolation !== 'auto' || s.containerType !== 'normal'))
      return
    if (n !== el && !opaque) signature += ';' + s.background
    if (n === main) break
  }
  const live = el.hasAttribute('data-gpu-painted')
  for (const n of [el, ...el.querySelectorAll('*')]) {
    const s = getComputedStyle(n)
    if (
      s.mixBlendMode !== 'normal' ||
      s.filter !== 'none' ||
      s.backdropFilter !== 'none' ||
      s.display === 'contents' ||
      s.transform !== 'none' ||
      s.textShadow !== 'none' ||
      s.boxShadow !== 'none' ||
      n.matches('canvas,video,iframe,object,embed') ||
      ['::before', '::after'].some(
        p => !['none', 'normal'].includes(getComputedStyle(n, p).content),
      )
    )
      return
    if (n !== el) {
      const direct = n.parentElement === el
      if (
        (s.position !== 'static' && s.position !== 'relative') ||
        (direct && !['auto', '0px'].includes(s.inset)) ||
        (live && direct
          ? s.position !== 'relative' || s.zIndex !== '1'
          : s.zIndex !== 'auto')
      )
        return
    }
  }
  // The zero-specificity promotion must really win on ordinary children.
  // Probe synchronously, after validating unpromoted paint and before any
  // acquisition or reveal; e.g. an explicit position:static remains static.
  if (!live) {
    el.setAttribute('data-gpu-probe', '')
    try {
      for (const child of el.children) {
        const s = getComputedStyle(child)
        if (s.position !== 'relative' || s.zIndex !== '1') return
      }
    } finally {
      el.removeAttribute('data-gpu-probe')
    }
  }
  return { signature, seed: rgb ? rgb.slice(1).map(v => +v / 255) : [] }
}
