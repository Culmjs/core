import type { Frame, Motion, Node, Step } from '../document/index.ts'
import { find, walk } from '../document/tree.ts'
import { cssEase } from '../scripts/motionEase.ts'
import { stepsTier } from '../document/motionSteps.ts'
import { resolveEffect } from '../registry/effect.ts'
import type { Registry } from '../registry/index.ts'
import type { HtmlNode } from './html.ts'

type Lowered = { tier: 1 | 2; steps: Step[] }

/** A validated program. The private render projection already has the exact checked
 * steps, including copy-local target IDs, even when it came from a named preset. */
export function lowerMotion(m: Motion, registry: Registry): Lowered {
  const def = 'effect' in m ? registry.effect(m.effect) : undefined
  const steps =
    'steps' in m
      ? m.steps
      : resolveEffect(def, m.settings, (msg, path) => {
          throw new Error(`${path}: ${msg}`)
        })!
  const tier =
    def?.tier === 2 ||
    m.pinPx !== undefined ||
    m.scrollFallback ||
    m.trigger === 'enter-view' ||
    m.trigger === 'pointer-x'
      ? 2
      : stepsTier(steps)
  return { tier, steps }
}

/** Animate individual transform properties, so the author's (possibly responsive)
 * transform continues to apply. Preserve the other axis across steps. */
function frame(f: Frame, last: Frame): string {
  const css: string[] = []
  if (f.opacity !== undefined) css.push(`opacity:${f.opacity}`)
  if (f.xPercent !== undefined || f.xPx !== undefined || f.yPx !== undefined) {
    if (f.xPx !== undefined) delete last.xPercent
    if (f.xPercent !== undefined) delete last.xPx
    Object.assign(last, f)
    css.push(
      `translate:${last.xPercent !== undefined ? `${last.xPercent}%` : `${last.xPx ?? 0}px`} ${last.yPx ?? 0}px`,
    )
  }
  if (f.rotateDeg !== undefined) css.push(`rotate:${f.rotateDeg}deg`)
  if (f.scale !== undefined) {
    last.scale = f.scale
    css.push(`scale:${f.scale}`)
  }
  if (f.scaleX !== undefined) css.push(`scale:${f.scaleX} ${last.scale ?? 1}`)
  return css.join(';')
}

function classOn(e: HtmlNode, name: string) {
  const attrs = (e.attrs ??= {})
  attrs.class = attrs.class ? `${attrs.class} ${name}` : name
  return `.${name}`
}

type CssTrack = {
  id: number
  selector: string
  targets: HtmlNode[]
  frames: string
  animation: string
  clock?: string
  ranges: string
  count: number
}

const VIEW = '(animation-timeline:view())'

/** Each step occupies its own interval on one clock. Separate 0/100% keyframes
 * permit discontinuous endpoints; a delay holds the preceding endpoint. */
function sequence(steps: Step[], id: number, scroll: boolean) {
  const total = steps.reduce((ms, s) => ms + (s.delayMs ?? 0) + s.durationMs, 0)
  const animations: string[] = [],
    ranges: string[] = [],
    last: Frame = {}
  let end = 0,
    frames = ''
  for (const [j, s] of steps.entries()) {
    const key = `cm-k${id}-${j}`,
      start = end + (s.delayMs ?? 0)
    end = start + s.durationMs
    frames += `@keyframes ${key}{0%{${frame(s.from, last)}}100%{${frame(s.to, last)}}}`
    animations.push(
      `${key} ${scroll ? 'auto' : `${s.durationMs}ms`} ${cssEase(s.ease)} ${scroll ? 0 : start}ms ${j ? 'forwards' : 'both'}`,
    )
    ranges.push(`${(100 * start) / total}% ${(100 * end) / total}%`)
  }
  return {
    frames,
    animation: animations.join(','),
    ranges: ranges.join(','),
    count: steps.length,
  }
}

/** CSS's animation shorthand replaces the entire list. Where two programs meet,
 * give each an independently activated slot and join the lists on the actual target. */
function writeTracks(tracks: CssTrack[]) {
  const byTarget = new Map<HtmlNode, CssTrack[]>()
  for (const t of tracks)
    for (const el of t.targets) {
      const list = byTarget.get(el) ?? []
      list.push(t)
      byTarget.set(el, list)
    }
  const shared = new Set<CssTrack>(),
    groups = new Map<string, string>(),
    joined: string[] = []
  const list = (value: string, count: number) =>
    Array(count).fill(value).join(',')
  for (const [el, ts] of byTarget) {
    if (ts.length === 1) continue
    const key = ts.map(t => t.id).join('-')
    let name = groups.get(key)
    if (!name) {
      name = `cm-g${groups.size + 1}`
      groups.set(key, name)
      for (const t of ts) shared.add(t)
      const join = (active: CssTrack[]) => {
        const slots = active.map(
          t => `var(--cm-a${t.id},${list('none', t.count)})`,
        )
        let css = `animation:${slots.join(',')}`
        if (active.some(t => t.clock)) {
          css += `;animation-timeline:${active.map(t => list(t.clock ?? 'auto', t.count)).join(',')}`
          css += `;animation-range:${active.map(t => (t.clock ? t.ranges : list('normal', t.count))).join(',')}`
        }
        return `.${name}:is(${active.map(t => t.selector).join(',')}){${css}}`
      }
      const timed = ts.filter(t => !t.clock)
      if (timed.length === ts.length) joined.push(join(ts))
      else {
        joined.push(`@supports ${VIEW}{${join(ts)}}`)
        if (timed.length > 1)
          joined.push(`@supports not ${VIEW}{${join(timed)}}`)
      }
    }
    classOn(el, name)
  }
  const rules = tracks.map(t => {
    const slot = `--cm-a${t.id}`
    let css = `${t.frames}${t.selector}{${shared.has(t) ? `${slot}:${t.animation};animation:var(${slot})` : `animation:${t.animation}`}`
    if (t.clock)
      css += `;animation-timeline:${t.clock};animation-range:${t.ranges}`
    css += '}'
    return t.clock ? `@supports ${VIEW}{${css}}` : css
  })
  return `@media (prefers-reduced-motion:no-preference){${rules.join('')}${joined.join('')}}`
}

/** Emit only after the real builders have chosen their elements. A table's tbody, a
 * button's glyph, or a group's mask are not authored children and never match by accident. */
export function motionCss(
  trees: Node[],
  site: HtmlNode,
  rendered: ReadonlyMap<Node, HtmlNode>,
  registry: Registry,
): string {
  const tracks: CssTrack[] = []
  const header = trees[1]
  for (const root of trees) {
    const chain: Node[] = []
    walk(root, (w, _p, depth) => {
      chain[depth] = w
      const m = w.motion,
        owner = rendered.get(w)
      if (!m || !owner) return
      // The fallback buys a host even when native CSS is available. Defer only
      // its execution to the host; a host-only program has no CSS branch.
      const { tier, steps } = lowerMotion(
        m.scrollFallback ? { ...m, scrollFallback: undefined } : m,
        registry,
      )
      if (tier === 2) return
      const t = steps[0].target
      const nodes =
        t === 'self'
          ? [w]
          : t === 'children'
            ? (w.children ?? [])
            : typeof t === 'object'
              ? [find(w, t.id)]
              : []
      const targets = nodes.flatMap(v => (v && rendered.get(v)) || [])
      if (!targets.length) return
      const i = tracks.length + 1,
        name = `cm-t${i}`,
        self = t === 'self'
      let sel = `.${name}`,
        clock = 'view()',
        extra = ''
      const scroll = m.trigger === 'scroll'
      if (m.trigger === 'hover' || m.trigger === 'press') {
        const ownerSel = self ? sel : classOn(owner, `cm-o${i}`)
        const hover = m.trigger === 'hover'
        if (hover) {
          const attrs = (owner.attrs ??= {})
          if (
            attrs.tabindex === undefined &&
            !['button', 'input', 'select', 'textarea'].includes(owner.tag) &&
            !(owner.tag === 'a' && attrs.href)
          )
            attrs.tabindex = 0
        }
        sel =
          ownerSel +
          (hover ? ':is(:hover,:focus-visible)' : ':active') +
          (self ? '' : ` ${sel}`)
      } else if (typeof m.trigger === 'object') {
        const { state, is } = m.trigger
        const holds = (x: Node) => x.state?.find(s => s.name === state)
        const holder =
          chain
            .slice(0, depth + 1)
            .reverse()
            .find(holds) ?? header
        const h = holder === header ? site : rendered.get(holder)
        const declaration = holds(holder)
        if (!h || !declaration) return
        // Group parts bypass ordinary build attributes; install the real declaration
        // only if one is needed here. The header root's attribute lives on the site.
        const attr = `data-s-${state}`
        ;(h.attrs ??= {})[attr] ??= declaration.initial
        const same = self && h === owner
        sel =
          (same ? sel : classOn(h, `cm-s${i}`)) +
          `[${attr}="${is}"]` +
          (same ? '' : ` ${sel}`)
      } else if (scroll && !self) {
        // view() on a descendant would measure the wrong subject.
        clock = `--cm-v${i}`
        extra = `${classOn(owner, `cm-o${i}`)}{view-timeline-name:${clock}}`
      }
      for (const el of targets) classOn(el, name)
      const seq = sequence(steps, i, scroll)
      tracks.push({
        ...seq,
        id: i,
        selector: sel,
        targets,
        clock: scroll ? clock : undefined,
        frames: extra + seq.frames,
      })
    })
  }
  return tracks.length ? writeTracks(tracks) : ''
}
