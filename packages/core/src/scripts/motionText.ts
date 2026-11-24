export type Unit = 'lines' | 'words' | 'letters'
type Groups = HTMLElement[][]
export type TextPlan = Partial<Record<Unit, boolean | 'switch'>>

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
  return [
    atom,
    source,
    ...(Object.values(plan).includes(true) ? [clip] : []),
    ...Object.keys(plan)
      .filter(k => plan[k as Unit] === 'switch')
      .map(k => 'cm-' + k),
  ].map(cls => `.${cls}{${styles(cls)}}`)
}

/** Lay out in the original inline formatting context. Never move a link, BR
 * or styled run. Measure the undecorated words first, before any DOM writes.
 * A line split can thus contain independent fragments on both sides of a link. */
export function measureText(
  root: HTMLElement,
  plan: TextPlan,
  inline?: (cls: string) => string,
) {
  const doc = root.ownerDocument
  const groups: Record<Unit, Groups> = { lines: [], words: [], letters: [] }
  const originals = new Map<Text, HTMLElement>()
  const restore = () => {
    originals.forEach((run, text) => run.replaceWith(text))
    originals.clear()
  }
  const probes: HTMLElement[] = []
  let budget = 2000 - doc.getElementsByTagName('*').length
  const span = (parent?: HTMLElement, cls = '') => {
    if (--budget < 0) throw 0
    const e = doc.createElement('span')
    if (cls) {
      e.className = cls
      if (inline) e.style.cssText = inline(cls)
    }
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
    if (plan[unit])
      parent = span(parent, plan[unit] === 'switch' ? 'cm-' + unit : clip)
    const e = span(parent, atom)
    ;(groups[unit][index] ||= []).push(e)
    return e
  }
  try {
    const words = new Intl.Segmenter(doc.documentElement.lang || undefined, {
        granularity: 'word',
      }),
      chars = new Intl.Segmenter()
    const walk = doc.createTreeWalker(root, 5)
    const checks: [HTMLElement, number, number][] = []
    // Rich mathematics, overlapping splits, or adjacent lexical runs would
    // need shaping across boundaries. Keep their native typography instead.
    if (root.querySelector('math,svg,[data-cm-run]')) throw 0
    let joined = false
    for (let item; (item = walk.nextNode());) {
      if (item.nodeType !== 3) {
        if (item.nodeName === 'BR') joined = false
        continue
      }
      const n = item as Text
      const text = n.data
      if (joined && /^\S/.test(text)) throw 0
      // Joining scripts cannot be painted correctly in atomic letter boxes,
      // even if all their isolated glyph advances happen to sum to the same width.
      if (
        plan.letters !== undefined &&
        /[\u0600-\u08ff\u1800-\u18af]/u.test(text)
      )
        throw 0
      joined = /\S$/.test(text)
      if (!text.trim()) continue
      const run = span()
      run.setAttribute('data-cm-run', '')
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
        range.setStart(n, index)
        range.setEnd(n, index + segment.length)
        const rects = range.getClientRects()
        if (rects.length !== 1 || !rects[0].height) throw 0
        const at = line(rects[0])
        if (here !== at) {
          visual.append(space)
          space = ''
          fragment =
            plan.lines === undefined ? visual : member(visual, 'lines', at)
          here = at
        }
        fragment.append(space)
        space = ''
        const word =
          plan.words !== undefined
            ? member(fragment, 'words', groups.words.length)
            : span(fragment, atom)
        if (plan.letters !== undefined) {
          for (const { segment: g } of chars.segment(segment))
            member(word, 'letters', groups.letters.length).append(g)
        } else word.append(segment)
        checks.push([word, at, rects[0].width])
      }
      visual.append(space)
      originals.set(n, run)
    }
    for (const [n, run] of originals) {
      n.replaceWith(run)
      run.firstElementChild!.shadowRoot!.append(n)
    }
    // Decline if this font's kerning/ligatures changed the word's width,
    // or if an atomic wrapper changed a soft wrap.
    row = -1
    bottom = -Infinity
    top = Infinity
    for (const [word, at, width] of checks) {
      const r = word.getBoundingClientRect()
      if (line(r) !== at || Math.abs(r.width - width) > 1) throw 0
      probes.push(word)
    }
  } catch {
    restore()
    probes.length = 0
    for (const unit of Object.keys(groups) as Unit[]) groups[unit] = []
  }
  return { groups, restore, probes }
}

export function splitText(root: HTMLElement, unit: Unit, mask: boolean) {
  if (
    root.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion:reduce)',
    ).matches
  )
    return { groups: [], restore() {} }
  const { groups, restore } = measureText(root, { [unit]: mask }, styles)
  return { groups: groups[unit], restore }
}
