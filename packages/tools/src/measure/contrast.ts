import { THRESHOLDS, type ContrastRaw } from '@culmjs/core/measure'
import type { Page } from './browser.ts'
import { decodePng } from './png.ts'

type Rect = [number, number, number, number]
/** One text of the page: its colour and what is behind it, as the page draws them. `bg` is null when the colour behind it has to be sampled from pixels. */
type Item = {
  id: string
  fg: string
  alpha: number
  bg: string | null
  size: number
  weight: number
  rect: Rect
}

/**
 * Runs in the page, ported from the old engine's `measureDocument` (its contrast half): each rendered text node, found by walking down the page half a window at a
 * time and looking at the middle half of the window, since a hit test works only on screen. The stack of elements under the text's middle gives the colour layers
 * behind it; a picture, a gradient or a clip to the text means the colour is sampled from pixels instead. Self-contained: it is sent to the page as source text.
 */
function textItems(): Item[] {
  const doc = document
  const win = window
  // pointer-events: none would hide an element from the hit test.
  const style = doc.createElement('style')
  style.textContent = '*{pointer-events:auto!important}'
  doc.head.appendChild(style)

  type RGBA = [number, number, number, number]
  const hex2 = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const parseColor = (c: string): RGBA | null => {
    let m = /^rgba?\(([^)]+)\)$/.exec(c)
    if (m) {
      const p = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(x => parseFloat(x) / (x.endsWith('%') ? 100 : 1))
      return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1]
    }
    m = /^color\(srgb ([^)]+)\)$/.exec(c)
    if (m) {
      const p = m[1]!
        .split(/[\s/]+/)
        .filter(Boolean)
        .map(x => parseFloat(x))
      return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p.length > 3 ? p[3]! : 1]
    }
    return null
  }
  const toHex = (c: number[]) => '#' + hex2(c[0]!) + hex2(c[1]!) + hex2(c[2]!)
  const MEDIA = new Set([
    'IMG',
    'VIDEO',
    'CANVAS',
    'SVG',
    'PICTURE',
    'IFRAME',
    'OBJECT',
    'EMBED',
  ])
  const range = doc.createRange()

  win.scrollTo({ top: 0, behavior: 'instant' })
  // The part of a box that an ancestor's overflow leaves visible; null when none of it does.
  const visiblePart = (el: Element, r: DOMRect): DOMRect | null => {
    let l = r.left
    let t = r.top
    let rr = r.right
    let b = r.bottom
    for (
      let e: Element | null = el;
      e && e !== doc.documentElement && e !== doc.body;
      e = e.parentElement
    ) {
      const s = win.getComputedStyle(e)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const c = e.getBoundingClientRect()
      if (s.overflowX !== 'visible') {
        l = Math.max(l, c.left)
        rr = Math.min(rr, c.right)
      }
      if (s.overflowY !== 'visible') {
        t = Math.max(t, c.top)
        b = Math.min(b, c.bottom)
      }
    }
    return rr - l > 0.5 && b - t > 0.5 ? new DOMRect(l, t, rr - l, b - t) : null
  }
  const rectsOf = (t: Text, el: Element) => {
    range.selectNodeContents(t)
    return Array.from(range.getClientRects())
      .map(r => visiblePart(el, r))
      .filter(
        (r): r is DOMRect => r !== null && r.width > 0.5 && r.height > 0.5,
      )
  }

  const pending: { t: Text; el: Element; mid: number }[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    const el = t.parentElement
    if (
      !el ||
      !(t.nodeValue || '').trim() ||
      el.closest('script,style,noscript,template,option,textarea')
    )
      continue
    if (
      !el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true,
      })
    )
      continue
    const rects = rectsOf(t, el)
    if (rects.length)
      pending.push({
        t,
        el,
        mid: rects[0]!.top + win.scrollY + rects[0]!.height / 2,
      })
  }

  const items: Item[] = []
  const done = new Set<number>()
  const run = (i: number) => {
    const p = pending[i]!
    done.add(i)
    let el = p.el
    while (win.getComputedStyle(el).display === 'contents' && el.parentElement)
      el = el.parentElement
    // The boxes are read again: they were measured at another scroll position.
    const rects = rectsOf(p.t, el)
    if (!rects.length) return
    const cs = win.getComputedStyle(el)
    const cx = Math.min(
      win.innerWidth - 1,
      Math.max(0, rects[0]!.left + rects[0]!.width / 2),
    )
    const cy = rects[0]!.top + rects[0]!.height / 2
    const stack =
      cy >= 0 && cy < win.innerHeight ? doc.elementsFromPoint(cx, cy) : []
    // The text's own element (or something inside it) must be at that point; an ancestor alone means the text is clipped away.
    const at = stack.findIndex(e => e === el || el.contains(e))
    if (at < 0) return
    for (let k = 0; k < at; k++) {
      const e = stack[k]!
      const s = win.getComputedStyle(e)
      const c = parseColor(s.backgroundColor)
      if (
        (c && c[3] > 0.02) ||
        s.backgroundImage !== 'none' ||
        MEDIA.has(e.tagName.toUpperCase())
      )
        return // covered
    }
    // WCAG 1.4.3 leaves inactive controls out.
    if (el.closest(':disabled')) return
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg'
    const fgc = isSvg
      ? cs.fill === 'none'
        ? null
        : parseColor(cs.fill)
      : parseColor(cs.getPropertyValue('-webkit-text-fill-color')) ||
        parseColor(cs.color)
    if (!fgc) return
    let sampled = isSvg
    const layers: RGBA[] = []
    let opaque = false
    for (let k = at; k < stack.length && !opaque; k++) {
      const e = stack[k]!
      const s = win.getComputedStyle(e)
      if (
        s.backgroundClip === 'text' ||
        s.getPropertyValue('-webkit-background-clip') === 'text'
      )
        sampled = true
      else if (s.backgroundImage !== 'none') sampled = true
      else if (k > at && MEDIA.has(e.tagName.toUpperCase()) && !el.contains(e))
        sampled = true
      if (sampled) break
      const c = parseColor(s.backgroundColor)
      if (c && c[3] > 0) {
        layers.unshift(c)
        if (c[3] >= 0.999) opaque = true
      }
    }
    let opacity = 1
    for (let e: Element | null = el; e; e = e.parentElement)
      opacity *= parseFloat(win.getComputedStyle(e).opacity)
    if (!sampled && !opaque)
      // The page background (html, then body) fills the canvas.
      for (const e of [doc.documentElement, doc.body]) {
        const c = parseColor(win.getComputedStyle(e).backgroundColor)
        if (c && c[3] > 0) layers.unshift(c)
      }
    let l = 1e9
    let t = 1e9
    let r = -1e9
    let b = -1e9
    for (const q of rects) {
      l = Math.min(l, q.left)
      t = Math.min(t, q.top)
      r = Math.max(r, q.right)
      b = Math.max(b, q.bottom)
    }
    const a = fgc[3] * opacity
    const common = {
      id: (el.closest('[data-id]')?.getAttribute('data-id') || '').replace(
        /~[^.~]+/g,
        '',
      ),
      alpha: a,
      size: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
      rect: [
        l + win.scrollX,
        t + win.scrollY,
        r + win.scrollX,
        b + win.scrollY,
      ] as Rect,
    }
    if (sampled) return void items.push({ ...common, fg: toHex(fgc), bg: null })
    // Colour layers (bottom first) put over white, the browser's canvas.
    let R = 255
    let G = 255
    let B = 255
    for (const [lr, lg, lb, la] of layers) {
      R = lr * la + R * (1 - la)
      G = lg * la + G * (1 - la)
      B = lb * la + B * (1 - la)
    }
    items.push({
      ...common,
      fg: toHex([
        fgc[0] * a + R * (1 - a),
        fgc[1] * a + G * (1 - a),
        fgc[2] * a + B * (1 - a),
      ]),
      bg: toHex([R, G, B]),
    })
  }

  const sx0 = win.scrollX
  const sy0 = win.scrollY
  const ih = win.innerHeight
  for (let s = 0; ; s += ih / 2) {
    win.scrollTo({ top: s, behavior: 'instant' })
    const top = win.scrollY
    const last = top < s - 1 || top + ih >= doc.documentElement.scrollHeight - 1
    pending.forEach((p, i) => {
      if (done.has(i)) return
      if (
        (s === 0 || p.mid >= top + ih / 4) &&
        (last || p.mid < top + (3 * ih) / 4)
      )
        run(i)
    })
    if (last) break
  }
  win.scrollTo({ left: sx0, top: sy0, behavior: 'instant' })
  style.remove()
  return items
}

const HIDE_TEXT =
  '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration:none!important;caret-color:transparent!important}text,tspan,textPath{fill:transparent!important;stroke:transparent!important}'
/** Chrome's screenshots stop being reliable far below this. */
const MAX_HEIGHT = 16000

const channel = (n: number) => {
  const c = n / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map(channel)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
/** WCAG contrast ratio of two #rrggbb colours. */
const ratioOf = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
const hex = (c: number[]) =>
  '#' + c.map(n => n.toString(16).padStart(2, '0')).join('')
const mixOver = (fg: string, a: number, px: string) => {
  const f = rgb(fg)
  const p = rgb(px)
  return hex(f.map((v, i) => Math.round(v * a + p[i]! * (1 - a))))
}

/** The distinct colours of a 9 x 3 grid of pixels under each rect, from a screenshot with all text hidden. */
async function pixelsUnder(page: Page, rects: Rect[]): Promise<string[][]> {
  if (!rects.length) return []
  await page.evaluate(
    `(()=>{const s=document.createElement('style');s.id='culm-hide-text';s.textContent=${JSON.stringify(HIDE_TEXT)};document.head.appendChild(s)})()`,
  )
  try {
    const [w, h] = await page.evaluate<[number, number]>(
      '[Math.max(document.documentElement.scrollWidth, innerWidth), document.documentElement.scrollHeight]',
    )
    const tiles = new Map<number, ReturnType<typeof decodePng>>()
    const getTile = async (tileIdx: number) => {
      let img = tiles.get(tileIdx)
      if (!img) {
        const y0 = tileIdx * MAX_HEIGHT
        const th = Math.min(MAX_HEIGHT, Math.max(1, h - y0))
        img = decodePng(await page.screenshot({ x: 0, y: y0, w, h: th }))
        tiles.set(tileIdx, img)
      }
      return img
    }
    const results: string[][] = []
    for (const [l, t, r, b] of rects) {
      const out = new Set<string>()
      for (let i = 0; i <= 8; i++)
        for (let j = 0; j <= 2; j++) {
          const cy = Math.min(
            Math.max(h - 1, 0),
            Math.max(0, Math.round(t + ((b - t) * (j + 0.5)) / 3)),
          )
          const tileIdx = Math.floor(cy / MAX_HEIGHT)
          const img = await getTile(tileIdx)
          const x = Math.min(
            img.width - 1,
            Math.max(0, Math.round(l + ((r - l) * i) / 8)),
          )
          const y = Math.min(
            img.height - 1,
            Math.max(0, cy - tileIdx * MAX_HEIGHT),
          )
          const o = (y * img.width + x) * 4
          out.add(hex([img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!]))
        }
      results.push([...out])
    }
    return results
  } finally {
    await page.evaluate("document.getElementById('culm-hide-text')?.remove()")
  }
}

/** The worst contrast of the text of each block (by its node id) in this colour scheme at this window width. The page is left as it was found. */
export async function contrastOf(
  page: Page,
  scheme: 'light' | 'dark',
  width: number,
): Promise<ContrastRaw[]> {
  // Under tsx, esbuild's keepNames makes a serialised function call __name; the page has to have it.
  await page.evaluate('window.__name=(f)=>f')
  const items = (await page.evaluate<Item[]>(`(${textItems})()`)).filter(
    i => i.id,
  )
  const sampled = items.filter(i => i.bg === null)
  const pixels = await pixelsUnder(
    page,
    sampled.map(i => i.rect),
  )
  const worst = new Map<string, ContrastRaw & { need: number }>()
  for (const i of items) {
    const px = i.bg === null ? pixels[sampled.indexOf(i)]! : null
    const ratio = px
      ? Math.min(...px.map(p => ratioOf(mixOver(i.fg, i.alpha, p), p)))
      : ratioOf(i.fg, i.bg!)
    const large =
      i.size >= THRESHOLDS.largePx ||
      (i.size >= THRESHOLDS.largeBoldPx && i.weight >= 700)
    const need = large ? THRESHOLDS.contrastLarge : THRESHOLDS.contrastBody
    const prev = worst.get(i.id)
    if (!prev || ratio / need < prev.ratio / prev.need)
      worst.set(i.id, {
        id: i.id,
        scheme,
        width,
        ratio,
        large,
        sampled: !!px,
        need,
      })
  }
  return Array.from(worst.values(), w => ({
    id: w.id,
    scheme: w.scheme,
    width: w.width,
    ratio: w.ratio,
    large: w.large,
    sampled: w.sampled,
  }))
}
