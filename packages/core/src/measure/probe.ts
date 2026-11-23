import type { NodeRaw, ProbeRaw } from './types.ts'

export type Rect = [number, number, number, number]

/**
 * Runs inside the page: the box and paint facts of every `[data-id]` block (the measure build writes them) at the window's width, in page
 * coordinates. A repeated row (`list~2`) rolls up to its list's id (`list`), merging boxes into their union. `wide` holds the elements that
 * reach past either edge of the window once every clip but .s-site's own is applied. The runner adds `layout`.
 * Self-contained: it reads the page only through `doc` and `win` and uses no helper outside itself, because `npm run gen:scripts` ships its text as PROBE_SCRIPT.
 */
export function measureNodes(
  doc: Document,
  win: Window,
  width: number,
): ProbeRaw {
  const TEXT = (win as unknown as { Node: { TEXT_NODE: number } }).Node
    .TEXT_NODE
  const MEDIA = 'img,video,canvas,svg,picture,iframe,object,embed'
  const hex2 = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  const colour = (c: string) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(c) || /^color\(srgb ([^)]+)\)$/.exec(c)
    if (!m) return 'unreadable' // oklch() and the like: painted, but the colour is not read
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(x => parseFloat(x) / (x.endsWith('%') ? 100 : 1))
    const k = c.startsWith('color(') ? 255 : 1
    return p.length > 3 && p[3] === 0
      ? null
      : '#' + hex2(p[0] * k) + hex2(p[1] * k) + hex2(p[2] * k)
  }
  const painted = (s: CSSStyleDeclaration) =>
    colour(s.backgroundColor) !== null ||
    s.backgroundImage !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(
      e =>
        parseFloat(s.getPropertyValue('border-' + e.toLowerCase() + '-width')) >
          0 &&
        s.getPropertyValue('border-' + e.toLowerCase() + '-style') !== 'none',
    )
  const range = doc.createRange()
  const round = (n: number) => Math.round(n * 10) / 10

  const byId = new Map<string, NodeRaw>()
  const wideBy = new Map<string, number>()
  for (const el of Array.from(doc.querySelectorAll('[data-id]'))) {
    const id = (el.getAttribute('data-id') || '').replace(/~[^.~]+/g, '')
    const cs = win.getComputedStyle(el)
    const shown =
      el.getClientRects().length > 0 &&
      el.checkVisibility({ checkVisibilityCSS: true })
    const r = el.getBoundingClientRect()
    const box = shown
      ? {
          x: round(r.left + win.scrollX),
          y: round(r.top + win.scrollY),
          w: round(r.width),
          h: round(r.height),
        }
      : null
    const node: NodeRaw = {
      id,
      tag: el.tagName.toLowerCase(),
      box,
      visible: false,
      bg: colour(cs.backgroundColor),
      clip:
        ['hidden', 'clip'].includes(cs.overflowX) ||
        ['hidden', 'clip'].includes(cs.overflowY),
      fixedOrSticky: cs.position === 'fixed' || cs.position === 'sticky',
    }
    if (shown) {
      node.visible =
        !!(el.textContent || '').trim() ||
        el.matches(MEDIA) ||
        !!el.querySelector(MEDIA) ||
        painted(cs) ||
        Array.from(el.querySelectorAll('*')).some(d =>
          painted(win.getComputedStyle(d)),
        )
      if (el.tagName === 'A' || el.tagName === 'BUTTON')
        node.tap = { w: box!.w, h: box!.h }
      // Direct text only: one range per character gives the rendered lines and the longest one in characters.
      let chars = 0
      // a word whose letters sit on two lines is broken; the ink's left and right edges catch a word too long for its box (it spills out)
      let broken = false,
        wordTop: number | null = null,
        ink0 = Infinity,
        ink1 = -Infinity
      const lines: { top: number; n: number }[] = []
      for (const t of Array.from(el.childNodes)) {
        if (t.nodeType !== TEXT || !(t.nodeValue || '').trim()) continue
        const s = t.nodeValue || ''
        for (let i = 0; i < s.length; i++) {
          range.setStart(t, i)
          range.setEnd(t, i + 1)
          const q = range.getClientRects()[0]
          const gap = /[\s-]/.test(s[i]) // a space or a hyphen may end a line without splitting a word
          if (!q || q.width < 0.1) {
            if (gap) wordTop = null
            continue // a collapsed space has no box
          }
          chars++
          ink0 = Math.min(ink0, q.left)
          ink1 = Math.max(ink1, q.right)
          if (wordTop !== null && Math.abs(q.top - wordTop) > q.height / 2)
            broken = true
          wordTop = gap ? null : (wordTop ?? q.top)
          const last = lines[lines.length - 1]
          if (last && Math.abs(q.top - last.top) < q.height / 2) last.n++
          else lines.push({ top: q.top, n: 1 })
        }
      }
      if (chars)
        node.text = {
          lines: lines.length,
          longest: Math.max(...lines.map(l => l.n)),
          last: lines[lines.length - 1].n,
          broken,
          x0: round(ink0 + win.scrollX),
          x1: round(ink1 + win.scrollX),
          size: parseFloat(cs.fontSize),
          weight: parseInt(cs.fontWeight, 10) || 400,
        }
      // Past the window edge, once ancestors that clip (but not .s-site, which clips everything) have cut the box.
      let x0 = r.left,
        x1 = r.right,
        fixed = false
      // text that spills out of its box counts as part of it
      if (node.text) {
        x0 = Math.min(x0, node.text.x0! - win.scrollX)
        x1 = Math.max(x1, node.text.x1! - win.scrollX)
      }
      for (
        let a: Element | null = el;
        a && a !== doc.documentElement;
        a = a.parentElement
      ) {
        const s = win.getComputedStyle(a)
        if (s.position === 'fixed') {
          fixed = true
          break
        }
        if (
          a === el ||
          s.overflowX === 'visible' ||
          a.classList.contains('s-site')
        )
          continue
        const b = a.getBoundingClientRect()
        x0 = Math.max(x0, b.left)
        x1 = Math.min(x1, b.right)
      }
      if (
        !fixed &&
        x1 > x0 &&
        r.width > 0 &&
        (x1 > width + 1 || (x0 < -1 && x1 > 1))
      ) {
        wideBy.set(
          id,
          Math.max(
            wideBy.get(id) ?? 0,
            Math.ceil(x1 > width + 1 ? x1 - width : -x0),
          ),
        )
      }
    }
    const prev = byId.get(id)
    if (!prev) {
      byId.set(id, node)
      continue
    }
    prev.merged = true
    if (node.box) {
      const a = prev.box
      prev.box = a
        ? {
            x: Math.min(a.x, node.box.x),
            y: Math.min(a.y, node.box.y),
            w:
              Math.max(a.x + a.w, node.box.x + node.box.w) -
              Math.min(a.x, node.box.x),
            h:
              Math.max(a.y + a.h, node.box.y + node.box.h) -
              Math.min(a.y, node.box.y),
          }
        : node.box
    }
    prev.visible = prev.visible || node.visible
    prev.bg = prev.bg ?? node.bg
    prev.clip = prev.clip || node.clip
    prev.fixedOrSticky = prev.fixedOrSticky || node.fixedOrSticky
    if (node.text)
      prev.text = prev.text
        ? {
            ...prev.text,
            lines: Math.max(prev.text.lines, node.text.lines),
            longest: Math.max(prev.text.longest, node.text.longest),
            broken: prev.text.broken || node.text.broken,
            x0: Math.min(prev.text.x0 ?? Infinity, node.text.x0 ?? Infinity),
            x1: Math.max(prev.text.x1 ?? 0, node.text.x1 ?? 0),
          }
        : node.text
    prev.tap = prev.tap ?? node.tap
  }
  return {
    width,
    docWidth: doc.documentElement.scrollWidth,
    nodes: Array.from(byId.values()),
    wide: Array.from(wideBy, ([id, by]) => ({ id, by })),
  }
}

/**
 * Runs in a blank page: the distinct colours (#rrggbb) of a 9 × 3 grid of pixels under each rect of a PNG (a screenshot with the text hidden).
 * The PNG is decoded by the browser, so Node needs no image library.
 */
export async function pixelsUnder({
  b64,
  rects,
}: {
  b64: string
  rects: Rect[]
}): Promise<string[][]> {
  const bmp = await createImageBitmap(
    await (await fetch('data:image/png;base64,' + b64)).blob(),
  )
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  return rects.map(([l, t, r, b]) => {
    const out = new Set<string>()
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 2; j++) {
        const x = Math.min(
          bmp.width - 1,
          Math.max(0, Math.round(l + ((r - l) * i) / 8)),
        )
        const y = Math.min(
          bmp.height - 1,
          Math.max(0, Math.round(t + ((b - t) * (j + 0.5)) / 3)),
        )
        const d = g.getImageData(x, y, 1, 1).data
        out.add(
          '#' +
            [d[0], d[1], d[2]]
              .map(n => n.toString(16).padStart(2, '0'))
              .join(''),
        )
      }
    return [...out]
  })
}
