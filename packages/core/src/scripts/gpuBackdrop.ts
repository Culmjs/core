export type Box = [number, number, number, number]
const box = (r: DOMRect): Box => [r.left, r.top, r.right, r.bottom]
export const bounds = (e: Element) => box(e.getBoundingClientRect())
const area = ([l, t, r, b]: Box) => l < r && t < b
export const cut = (a: Box, b: Box) => {
  const c = a.map((v, i) => (i < 2 ? Math.max : Math.min)(v, b[i])) as Box
  if (area(c)) return c
}

// Compile each fixed list of computed properties once. Unqualified properties
// (filters, shadows, masks, transforms...) must all compute to 'none'.
const differs = (spec: string) => {
  const pairs = spec.split(' ').map(p => p.split(':'))
  return (s: CSSStyleDeclaration) =>
    pairs.some(([k, v = 'none']) => s[k as keyof CSSStyleDeclaration] !== v)
}
const composite = differs('mixBlendMode:normal filter backdropFilter transform')
const ancestor = differs(
  'opacity:1 visibility:visible contentVisibility:visible willChange:auto borderRadius:0px translate scale rotate perspective clipPath maskImage contain offsetPath',
)
const stacked = differs('isolation:auto zIndex:auto containerType:normal')
const shadow = differs('boxShadow textShadow')
const css = globalThis.getComputedStyle
const order = (s: CSSStyleDeclaration) => s.position + ' ' + s.zIndex
const promoted = 'relative 1'

export function backdrop(
  el: HTMLElement,
  main: Element,
  visible: Box,
  clip: Box,
  builtin: boolean,
) {
  const doc = el.ownerDocument
  const sample = ([l, t, r, b]: Box, x: number, y: number) =>
    doc.elementFromPoint(l + (r - l) * x, t + (b - t) * y)
  const own = css(el)
  if (own.borderWidth !== '0px') {
    if (!builtin) return
    // Leave the original CSS border and the paint behind it intact, including
    // transparent sides. The worker still uses the full border box for UVs.
    ;['left', 'top', 'right', 'bottom'].forEach((side, i) => {
      clip[i] +=
        (i < 2 ? 1 : -1) *
        parseFloat(own.getPropertyValue('border-' + side + '-width'))
    })
    const inner = cut(visible, clip)
    if (!inner) return
    visible = inner
  }
  const fractions = [0.01, 0.5, 0.99]
  if (!fractions.some(x => fractions.some(y => sample(visible, x, y) === el)))
    return

  const color = own.backgroundColor
  const opaque =
    /^(border|padding)-box$/.test(own.backgroundClip) &&
    /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color)
  const seed =
    opaque && own.backgroundImage === 'none'
      ? opaque.slice(1).map(v => +v / 255)
      : []
  let signature = seed.length ? color : own.background
  let inside = true
  // An opaque owner hides ancestor backgrounds, but still needs every
  // ancestor's stacking and clip checks.
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = css(n)
    if (n !== el && inside && !opaque) signature += ';' + s.background
    if (n === main) inside = false
    if (
      composite(s) ||
      ancestor(s) ||
      (inside &&
        (stacked(s) ||
          /^(sticky|fixed)$/.test(s.position) ||
          (n !== el &&
            (s.backgroundImage !== 'none' ||
              s.backgroundColor !== 'rgba(0, 0, 0, 0)'))))
    )
      return
    if (
      n !== el &&
      s.overflow !== 'visible' &&
      (s.borderWidth !== '0px' ||
        String(cut(visible, bounds(n))) !== String(visible))
    )
      return
    const parent: Element | null = n.parentElement
    if (parent)
      for (const peer of parent.children)
        if (
          peer !== n &&
          !peer.matches('.culm-plane') &&
          cut(visible, bounds(peer))
        )
          return
  }
  if (inside) return
  const data = el.dataset,
    live = data.gpuPainted !== undefined
  const range = doc.createRange()
  const walk = doc.createNodeIterator(el, 5) // SHOW_ELEMENT | SHOW_TEXT
  const children: CSSStyleDeclaration[] = []
  // Keep positive foreground in its actual stacking context. Creating a new
  // context on one of its ancestors would trap it under a neighbour's copy.
  const paths = new Set<Element>()
  const raised = 'data-gpu-raised'
  if (builtin)
    for (const n of el.querySelectorAll('*')) {
      const s = css(n),
        native = +s.zIndex > 1 && s.position !== 'static'
      n.toggleAttribute(raised, native)
      if (native)
        for (let p = n.parentElement; p && p !== el; p = p.parentElement)
          paths.add(p)
    }
  const groups = new Map<
    Element,
    { previous: Box; horizontal: boolean; vertical: boolean }
  >()
  let witness = false
  let node: Node | null
  while ((node = walk.nextNode())) {
    const text = node.nodeType === 3
    const n = text ? node.parentElement! : (node as HTMLElement)
    if (text) {
      if (!node.textContent!.trim()) continue
      if (n === el || paths.has(n)) return
    } else {
      const s = css(n)
      if (
        composite(s) ||
        ((!builtin || n === el) && shadow(s)) ||
        s.display === 'contents' ||
        n.matches('canvas,video,iframe,object,embed') ||
        ['::before', '::after'].some(
          p => !/^(none|normal)$/.test(css(n, p).content),
        )
      )
        return
      if (n === el) continue
      const parent = n.parentElement!,
        carrier = paths.has(n),
        lifted = builtin && n.hasAttribute(raised)
      if (
        carrier &&
        (lifted ||
          ancestor(s) ||
          stacked(s) ||
          s.backgroundImage !== 'none' ||
          s.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          s.borderWidth !== '0px' ||
          shadow(s) ||
          s.outlineStyle !== 'none')
      )
        return
      const direct = (parent === el || paths.has(parent)) && !carrier && !lifted
      if (direct) {
        if (!['auto', '0px'].includes(s.inset)) return
        if (!live) children.push(s)
        // Direct children arrive in DOM order. At least one axis must stay
        // non-overlapping for the whole run; empty boxes paint no layer.
        const b = bounds(n)
        if (area(b)) {
          const prev = groups.get(parent)
          const horizontal =
            !prev || (prev.horizontal && b[0] >= prev.previous[2])
          const vertical = !prev || (prev.vertical && b[1] >= prev.previous[3])
          if (!horizontal && !vertical) return
          groups.set(parent, { horizontal, vertical, previous: b })
        }
      }
      if (
        !lifted &&
        (live && direct
          ? order(s) !== promoted
          : !/^(relative|static) auto$/.test(order(s)))
      )
        return
    }
    const kind = n.getAttribute('data-gpu-content')
    // A media mark has an empty value; video was already excluded. For
    // text, use the individual text node's *visible fragments*, never its
    // parent's border box or the centre of a fragment outside the scissor.
    if (
      witness ||
      (text
        ? !kind
        : kind !== '' || (n as HTMLImageElement).naturalWidth === 0) ||
      !n.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue
    if (text) range.selectNodeContents(node)
    const fragments = text
      ? [...range.getClientRects()]
      : [n.getBoundingClientRect()]
    witness = fragments.some(r => {
      const b = cut(visible, box(r))
      return !!b && n.contains(sample(b, 0.5, 0.5))
    })
  }
  if (!witness) return
  // An authored static or z-index:auto can defeat zero-specificity promotion.
  if (!live) {
    data.gpuProbe = ''
    try {
      // CSSOM computed declarations are live across this cascade change.
      if (!children.every(s => order(s) === promoted)) return
    } finally {
      delete data.gpuProbe
    }
  }
  return { signature, seed }
}
