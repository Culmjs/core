export type Unit = 'lines' | 'words' | 'letters'
type Groups = HTMLElement[][]
export const { min, max, abs } = Math
export const rect = (el: Element | Range) => el.getBoundingClientRect()
// Abort the enclosing measurement transaction and restore native layout.
export function rejectMeasurement(invalid: unknown) {
  if (invalid) throw 0
}
/** Presence requests that layer; a nonempty value is its stationary clip class. */
export type TextPlan = Partial<Record<Unit, string>>

const enum Kind {
  Atom = 'cm-frag',
  Clip = 'cm-clip',
  Source = 'cm-source',
}
function styles(cls: string) {
  if (cls === Kind.Atom) return 'display:inline-block'
  if (cls === Kind.Clip) return 'display:inline-flex;overflow:hidden'
  if (cls === Kind.Source)
    return 'position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap;user-select:none'
  return `display:inline-flex;overflow:var(--${cls},visible)`
}

/** Static layout rules only on text-motion pages. No per-letter CSS or
 * executable scene data. Direct callers outside a compiled page can use
 * splitText(), which applies the same declarations inline. */
export function textRules(plan: TextPlan) {
  return [
    Kind.Atom,
    Kind.Source,
    ...new Set(Object.values(plan).filter(Boolean)),
  ]
    .map(cls => `.${cls}{${styles(cls)}}`)
    .concat('.cm-run,.cm-run span{text-decoration:inherit}')
}

/** Lay out in the original inline formatting context. Never move a link, BR
 * or styled run. Measure the undecorated words first, before any DOM writes.
 * A line split can thus contain independent fragments on both sides of a link. */
export function measureLayers(
  root: HTMLElement,
  plan: TextPlan,
  decorate: (e: HTMLElement, cls: string) => void = (e, cls) =>
    (e.className = cls),
) {
  const doc = root.ownerDocument
  // The clock needs the stagger index, not a nested array of members. Several
  // fragments can share one line index across formatting or link boundaries.
  let groups: Partial<Record<Unit, Map<HTMLElement, number>>> = {}
  const layer = (unit: Unit) =>
    (groups[unit] ||= new Map<HTMLElement, number>())
  const originals: [Text, HTMLElement, ShadowRoot][] = []
  const restore = () => {
    originals.forEach(([text, run]) => run.replaceWith(text))
    originals.length = 0
  }
  let budget = 2000 - doc.querySelectorAll('*').length
  const span = (cls = '', parent?: HTMLElement) => {
    rejectMeasurement(--budget < 0)
    const e = doc.createElement('span')
    decorate(e, cls)
    if (parent) parent.append(e)
    return e
  }
  const range = doc.createRange()
  let bottom = 0,
    top = 0,
    row = -1
  const member = (
    parent: HTMLElement,
    unit: Unit,
    index = layer(unit).size,
  ) => {
    const e = span(Kind.Atom, plan[unit] ? span(plan[unit], parent) : parent)
    layer(unit).set(e, index)
    return e
  }
  try {
    const { Segmenter } = Intl
    const words = new Segmenter(doc.documentElement.lang || [], {
        granularity: 'word',
      }),
      chars = 'letters' in plan && new Segmenter()
    const walk = doc.createTreeWalker(root, 5)
    const checks: [HTMLElement, DOMRect][] = []
    // Rich mathematics, overlapping splits, or adjacent lexical runs would
    // need shaping across boundaries. Keep their native typography instead.
    let joined: boolean | undefined
    for (let n; (n = walk.nextNode() as Text | Element | null);) {
      if (n.nodeType !== 3) {
        rejectMeasurement((n as Element).matches('math,svg,.cm-run'))
        if (n.nodeName === 'BR') joined = false
        continue
      }
      const text = (n as Text).data
      // Joining scripts cannot be painted correctly in atomic letter boxes,
      // even if all their isolated glyph advances happen to sum to the same width.
      rejectMeasurement(
        (joined && /^\S/.test(text)) ||
          (chars && /[\u0600-\u08ff\u1800-\u18af]/u.test(text)),
      )
      joined = /\S$/.test(text)
      if (!text.trim()) continue
      // Solid decorations on the immediate formatting parent can pass through
      // the atomic boxes. Stacked, propagated or patterned ink cannot.
      for (let p = n.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        rejectMeasurement(
          cs.textDecorationLine !== 'none' &&
            (p !== n.parentElement ||
              cs.textDecorationStyle !== 'solid' ||
              (Object.values(plan).some(Boolean) &&
                (cs.textUnderlineOffset !== 'auto' ||
                  cs.textDecorationThickness !== 'auto'))),
        )
      }
      const run = span('cm-run')
      // Expose one intact native text node to AT. The text-only shadow (no
      // extra elements) keeps light-DOM textContent/copy from doubling. The
      // visual copy alone is hidden from AT; neither ancestor links nor
      // authored labels are ever hidden or renamed.
      originals.push([
        n as Text,
        run,
        span(Kind.Source, run).attachShadow({ mode: 'open' }),
      ])
      const visual = span('', run)
      visual.setAttribute('aria-hidden', 'true')
      let fragment: HTMLElement | undefined,
        space = ''
      const place = (
        tokenizer: Intl.Segmenter,
        value: string,
        base = 0,
        word?: HTMLElement,
      ) => {
        for (const { segment, index } of tokenizer.segment(value)) {
          if (!word && !segment.trim()) {
            space += segment
            continue
          }
          const i = index + base
          range.setStart(n!, i)
          range.setEnd(n!, i + segment.length)
          const [original, next] = range.getClientRects()
          rejectMeasurement(next || !original || !original.height)
          let el
          if (word) el = member(word, 'letters')
          else {
            const { top: t, bottom: b } = original
            if ((top = max(top, t)) >= (bottom = min(bottom, b))) {
              row++
              top = t
              bottom = b
              fragment = undefined
            }
            ;(fragment || visual).append(space)
            fragment ||= 'lines' in plan ? member(visual, 'lines', row) : visual
            space = ''
            el = member(fragment, 'words')
            if (chars) {
              place(chars, segment, i, el)
              continue
            }
          }
          el.append(segment)
          checks.push([el, original])
        }
      }
      place(words, text)
      visual.append(space)
    }
    originals.forEach(([n, run, shadow]) => {
      n.replaceWith(run)
      shadow.append(n)
    })
    // Equal advance widths alone cannot detect bidi reversal. Compare the
    // actual leaf text ranges against the original graphemes (or whole words
    // when unsplit), including horizontal placement and soft wraps.
    checks.forEach(([leaf, original]) => {
      range.selectNodeContents(leaf)
      const r = rect(range)
      rejectMeasurement(
        (['x', 'y', 'width'] as const).some(k => abs(r[k] - original[k]) > 1),
      )
    })
  } catch {
    restore()
    groups = {}
  }
  return [layer, restore] as const
}

export function measureText(
  root: HTMLElement,
  plan: TextPlan,
  decorate?: (e: HTMLElement, cls: string) => void,
) {
  const [layers, restore] = measureLayers(root, plan, decorate)
  const groups: Record<Unit, Groups> = { lines: [], words: [], letters: [] }
  for (const unit of Object.keys(groups) as Unit[])
    for (const [el, i] of layers(unit)) (groups[unit][i] ||= []).push(el)
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
    { [unit]: mask ? Kind.Clip : '' },
    (e, cls) => {
      e.className = cls
      e.style.cssText =
        (cls && cls !== 'cm-run' ? styles(cls) : '') +
        ';text-decoration:inherit'
    },
  )
  return { groups: groups[unit], restore }
}
