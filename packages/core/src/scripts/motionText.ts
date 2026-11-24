export type Unit = 'lines' | 'words' | 'letters'
type Groups = HTMLElement[][]
/** Presence requests that layer; a nonempty value is its stationary clip class. */
export type TextPlan = Partial<Record<Unit, string>>

const atom = 'cm-frag',
  clip = 'cm-clip',
  source = 'cm-source'
function styles(cls: string) {
  if (cls === atom) return 'display:inline-block'
  if (cls === clip) return 'display:inline-flex;overflow:hidden'
  if (cls === source)
    return 'position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap;user-select:none'
  return `display:inline-flex;overflow:var(--${cls},visible)`
}

/** Static layout rules only on text-motion pages. No per-letter CSS or
 * executable scene data. Direct callers outside a compiled page can use
 * splitText(), which applies the same declarations inline. */
export function textRules(plan: TextPlan) {
  return [atom, source, ...new Set(Object.values(plan).filter(Boolean))]
    .map(cls => `.${cls}{${styles(cls)}}`)
    .concat('.cm-run,.cm-run span{text-decoration:inherit}')
}

/** Lay out in the original inline formatting context. Never move a link, BR
 * or styled run. Measure the undecorated words first, before any DOM writes.
 * A line split can thus contain independent fragments on both sides of a link. */
export function measureText(
  root: HTMLElement,
  plan: TextPlan,
  decorate = (e: HTMLElement, cls: string) => {
    e.className = cls
  },
) {
  const doc = root.ownerDocument
  const empty = (): Record<Unit, Groups> => ({
    lines: [],
    words: [],
    letters: [],
  })
  let groups = empty()
  const originals = new Map<Text, HTMLElement>()
  const restore = () => {
    originals.forEach((run, text) => run.replaceWith(text))
    originals.clear()
  }
  let budget = 2000 - doc.querySelectorAll('*').length
  const span = (parent?: HTMLElement, cls = '') => {
    if (--budget < 0) throw 0
    const e = doc.createElement('span')
    decorate(e, cls)
    if (parent) parent.append(e)
    return e
  }
  const range = doc.createRange()
  let bottom = -Infinity,
    top = Infinity,
    row = -1
  const line = (r: DOMRect) => {
    if (r.top >= bottom || r.bottom <= top) {
      row++
      top = r.top
      bottom = r.bottom
    } else {
      top = Math.max(top, r.top)
      bottom = Math.min(bottom, r.bottom)
    }
    return row
  }
  const member = (parent: HTMLElement, unit: Unit, index: number) => {
    if (plan[unit]) parent = span(parent, plan[unit])
    const e = span(parent, atom)
    ;(groups[unit][index] ||= []).push(e)
    return e
  }
  try {
    const { Segmenter } = Intl
    const words = new Segmenter(doc.documentElement.lang || undefined, {
        granularity: 'word',
      }),
      chars = 'letters' in plan && new Segmenter()
    const walk = doc.createTreeWalker(root, 5)
    const checks: [HTMLElement, DOMRect][] = []
    // Rich mathematics, overlapping splits, or adjacent lexical runs would
    // need shaping across boundaries. Keep their native typography instead.
    if (root.querySelector('math,svg,.cm-run')) throw 0
    let joined = false
    for (let n; (n = walk.nextNode() as Text | null);) {
      if (n.nodeType !== 3) {
        if (n.nodeName === 'BR') joined = false
        continue
      }
      const text = n.data
      if (joined && /^\S/.test(text)) throw 0
      // Joining scripts cannot be painted correctly in atomic letter boxes,
      // even if all their isolated glyph advances happen to sum to the same width.
      if (chars && /[\u0600-\u08ff\u1800-\u18af]/u.test(text)) throw 0
      joined = /\S$/.test(text)
      if (!text.trim()) continue
      // Solid decorations on the immediate formatting parent can pass through
      // the atomic boxes. Stacked, propagated or patterned ink cannot.
      const parent = n.parentElement
      for (let p = parent; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (
          cs.textDecorationLine !== 'none' &&
          (p !== parent ||
            cs.textDecorationStyle !== 'solid' ||
            (Object.values(plan).some(Boolean) &&
              (cs.textUnderlineOffset !== 'auto' ||
                cs.textDecorationThickness !== 'auto')))
        )
          throw 0
      }
      const run = span(undefined, 'cm-run')
      // Expose one intact native text node to AT. The text-only shadow (no
      // extra elements) keeps light-DOM textContent/copy from doubling. The
      // visual copy alone is hidden from AT; neither ancestor links nor
      // authored labels are ever hidden or renamed.
      span(run, source).attachShadow({ mode: 'open' })
      const visual = span(run)
      visual.setAttribute('aria-hidden', 'true')
      let here = -1,
        fragment = visual,
        space = ''
      for (const { segment, index } of words.segment(text)) {
        if (!segment.trim()) {
          space += segment
          continue
        }
        const bounds = (i: number, s: string) => {
          range.setStart(n, i)
          range.setEnd(n, i + s.length)
          const rects = range.getClientRects()
          if (rects.length !== 1 || !rects[0].height) throw 0
          return rects[0]
        }
        const original = bounds(index, segment)
        const at = line(original)
        if (here !== at) {
          visual.append(space)
          space = ''
          fragment = 'lines' in plan ? member(visual, 'lines', at) : visual
          here = at
        }
        fragment.append(space)
        space = ''
        const word = member(fragment, 'words', groups.words.length)
        if (chars) {
          for (const { segment: g, index: i } of chars.segment(segment)) {
            const glyph = member(word, 'letters', groups.letters.length)
            glyph.append(g)
            checks.push([glyph, bounds(index + i, g)])
          }
        } else {
          word.append(segment)
          checks.push([word, original])
        }
      }
      visual.append(space)
      originals.set(n, run)
    }
    for (const [n, run] of originals) {
      n.replaceWith(run)
      run.firstElementChild!.shadowRoot!.append(n)
    }
    // Equal advance widths alone cannot detect bidi reversal. Compare the
    // actual leaf text ranges against the original graphemes (or whole words
    // when unsplit), including horizontal placement and soft wraps.
    for (const [leaf, original] of checks) {
      range.selectNodeContents(leaf)
      const r = range.getBoundingClientRect()
      if (
        (['top', 'left', 'width'] as const).some(
          k => Math.abs(r[k] - original[k]) > 1,
        )
      )
        throw 0
    }
  } catch {
    restore()
    groups = empty()
  }
  return { groups, restore }
}

export function splitText(root: HTMLElement, unit: Unit, mask: boolean) {
  if (
    root.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion:reduce)',
    ).matches
  )
    return { groups: [], restore() {} }
  const { groups, restore } = measureText(
    root,
    { [unit]: mask ? clip : '' },
    (e, cls) => {
      e.className = cls
      e.style.cssText =
        (cls && cls !== 'cm-run' ? styles(cls) : '') +
        ';text-decoration:inherit'
    },
  )
  return { groups: groups[unit], restore }
}
