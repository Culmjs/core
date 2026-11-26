export type Unit = 'lines' | 'words' | 'letters'
type Groups = HTMLElement[][]
export const { min, max, abs } = Math
export const rect = (el: Element | Range) => el.getBoundingClientRect()
// Abort the enclosing measurement transaction and restore native layout.
export function rejectMeasurement(c: unknown) {
  if (c) throw 0
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
  decorate?: (e: HTMLElement, cls: string) => void,
) {
  const doc = root.ownerDocument,
    clipped = plan.lines || plan.words || plan.letters
  let groups: Partial<Record<Unit, Map<HTMLElement, number>>> = {}
  const layer = (u: Unit) =>
    groups[u] || (groups[u] = new Map<HTMLElement, number>())
  const originals: [Text, HTMLElement, ShadowRoot][] = []
  const restore = () =>
    originals.splice(0).forEach(([t, r]) => r.replaceWith(t))
  let budget = 2000 - doc.querySelectorAll('*').length
  const span = (
    cls: string,
    p?: HTMLElement,
    e = doc.createElement('span'),
  ) => (
    rejectMeasurement(--budget < 0),
    decorate ? decorate(e, cls) : (e.className = cls),
    p && p.append(e),
    e
  )
  const range = doc.createRange()
  let bottom = 0,
    top = 0,
    row = -1
  const member = (
    p: HTMLElement,
    u: Unit,
    i = layer(u).size,
    e = span(Kind.Atom, plan[u] ? span(plan[u], p) : p),
  ) => (layer(u).set(e, i), e)
  try {
    const S = Intl.Segmenter,
      words = new S(doc.documentElement.lang || [], { granularity: 'word' }),
      chars = 'letters' in plan && new S()
    const walk = doc.createTreeWalker(root, 5),
      checks: [HTMLElement, DOMRect][] = []
    let joined: boolean | undefined
    for (let n; (n = walk.nextNode() as Text | Element | null);) {
      if (n.nodeType !== 3) {
        rejectMeasurement((n as Element).matches('math,svg,.cm-run'))
        if (n.nodeName === 'BR') joined = false
        continue
      }
      const text = (n as Text).data
      rejectMeasurement(
        (joined && /^\S/.test(text)) ||
          (chars && /[\u0600-\u08ff\u1800-\u18af]/.test(text)),
      )
      joined = /\S$/.test(text)
      if (!text.trim()) continue
      for (let p = n.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p)
        rejectMeasurement(
          cs.textDecorationLine !== 'none' &&
            (p !== n.parentElement ||
              cs.textDecorationStyle !== 'solid' ||
              (clipped &&
                cs.textUnderlineOffset + cs.textDecorationThickness !==
                  'autoauto')),
        )
      }
      const run = span('cm-run')
      originals.push([
        n as Text,
        run,
        span(Kind.Source, run).attachShadow({ mode: 'open' }),
      ])
      const visual = span('', run)
      visual.ariaHidden = 'true'
      let fragment: HTMLElement | undefined,
        space = ''
      const place = (
        tok: Intl.Segmenter,
        val: string,
        base = 0,
        word?: HTMLElement,
      ) => {
        for (const q of tok.segment(val)) {
          const seg = q.segment
          if (!word && !seg.trim()) {
            space += seg
            continue
          }
          const i = q.index + base
          range.setStart(n!, i)
          range.setEnd(n!, i + seg.length)
          const rs = range.getClientRects(),
            orig = rs[0]
          rejectMeasurement(rs[1] || !orig || !orig.height)
          let el = word && member(word, 'letters')
          if (!el) {
            const t = orig.top,
              b = orig.bottom
            if ((top = max(top, t)) >= (bottom = min(bottom, b))) {
              row++
              top = t
              bottom = b
              fragment = 0 as unknown as HTMLElement | undefined
            }
            ;(fragment || visual).append(space)
            if (!fragment)
              fragment = 'lines' in plan ? member(visual, 'lines', row) : visual
            space = ''
            el = member(fragment, 'words')
            if (chars) {
              place(chars, seg, i, el)
              continue
            }
          }
          el.append(seg)
          checks.push([el, orig])
        }
      }
      place(words, text)
      visual.append(space)
    }
    originals.forEach(([n, r, s]) => {
      n.replaceWith(r)
      s.append(n)
    })
    checks.forEach(([leaf, orig]) => {
      range.selectNodeContents(leaf)
      const r = rect(range)
      rejectMeasurement(
        (['x', 'y', 'width'] as const).some(k => abs(r[k] - orig[k]) > 1),
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
