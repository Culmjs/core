import type {
  Decl,
  Frame,
  Layout,
  Look,
  Motion,
  Node,
  Problem,
  Step,
  Style,
} from '../document/index.ts'
import { find, walk } from '../document/tree.ts'
import { cssEase } from '../scripts/motionEase.ts'
import { stepsTier } from '../document/motionSteps.ts'
import {
  layoutDisplays,
  stateDisplay,
  interactiveLayers,
} from '../layout/display.ts'
import { resolveEffect } from '../registry/effect.ts'
import type { Registry } from '../registry/index.ts'
import type { HtmlNode } from './html.ts'
import {
  APPEAR_SUPPORT,
  appearFrames,
  appearRange,
  appearTrack,
} from './appear.ts'

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
function frame(f: Frame, last: Frame, axes: boolean, alpha: boolean): string {
  const css: string[] = []
  if (f.opacity !== undefined) {
    css.push(`opacity:${f.opacity}`)
    // The scroll reveal reads this endpoint; other targets keep ordinary opacity.
    if (alpha) css.push(`--cm-alpha:${f.opacity}`)
  }
  if (axes) {
    // Independent animations cannot replace the same translate pair. Animate
    // typed, non-inheriting axes instead and assemble translate on activation.
    if (f.xPercent !== undefined) css.push(`--cm-x:${f.xPercent}%`)
    if (f.xPx !== undefined) css.push(`--cm-x:${f.xPx}px`)
    if (f.yPx !== undefined) css.push(`--cm-y:${f.yPx}px`)
  } else if (
    f.xPercent !== undefined ||
    f.xPx !== undefined ||
    f.yPx !== undefined
  ) {
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

type Track = {
  id: number
  selector: string
  targets: HtmlNode[]
  steps: Step[]
  extra: string
  inlineBox: boolean
  inlineRestore: boolean
  clock?: string
}

const VIEW = '(animation-timeline:view())'

/** Each step occupies its own interval on one clock. Separate 0/100% keyframes
 * permit discontinuous endpoints; a delay holds the preceding endpoint. */
function sequence(
  steps: Step[],
  id: number,
  scroll: boolean,
  axes: boolean,
  alpha: boolean,
) {
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
    frames += `@keyframes ${key}{0%{${frame(s.from, last, axes, alpha)}}100%{${frame(s.to, last, axes, alpha)}}}`
    animations.push(
      `${key} ${scroll ? 'auto' : `${s.durationMs}ms`} ${cssEase(s.ease)} ${scroll ? 0 : start}ms ${j ? 'forwards' : 'both'}`,
    )
    ranges.push(`${(100 * start) / total}% ${(100 * end) / total}%`)
  }
  return {
    frames,
    animation: animations.join(','),
    ranges: ranges.join(','),
  }
}

/** CSS's animation shorthand replaces the entire list. Where two programs meet,
 * give each an independently activated slot and join the lists on the actual target. */
function writeTracks(tracks: Track[], appear: Map<HtmlNode, number>) {
  const byTarget = new Map<HtmlNode, Track[]>()
  for (const t of tracks)
    for (const el of t.targets) {
      const list = byTarget.get(el) ?? []
      list.push(t)
      byTarget.set(el, list)
    }
  const shared = new Set<Track>(),
    axes = new Set<Track>(),
    alpha = new Set<Track>(),
    groups = new Map<string, string>(),
    joined: string[] = []
  const list = (value: string, count: number) =>
    Array(count).fill(value).join(',')
  for (const [el, ts] of byTarget) {
    const translating = ts.filter(t =>
      t.steps.some(
        ({ from: f }) =>
          f.xPx !== undefined ||
          f.xPercent !== undefined ||
          f.yPx !== undefined,
      ),
    )
    if (
      translating.length > 1 &&
      translating.some(t => t.steps.some(s => s.from.yPx !== undefined)) &&
      translating.some(t =>
        t.steps.some(
          s => s.from.xPx !== undefined || s.from.xPercent !== undefined,
        ),
      )
    )
      for (const t of translating) axes.add(t)
    if (appear.has(el))
      for (const t of ts)
        if (t.steps.some(s => s.from.opacity !== undefined)) alpha.add(t)
  }
  const seq = new Map(
    tracks.map(t => [
      t,
      sequence(t.steps, t.id, !!t.clock, axes.has(t), alpha.has(t)),
    ]),
  )
  for (const [el, ts] of byTarget) {
    const vh = appear.get(el)
    if (ts.length === 1 && vh === undefined) continue
    const key = ts.map(t => t.id).join('-') + ':' + (vh ?? '')
    let name = groups.get(key)
    if (!name) {
      name = `cm-g${groups.size + 1}`
      groups.set(key, name)
      for (const t of ts) shared.add(t)
      const join = (active: Track[], withAppear: boolean) => {
        const slots = active.map(
          t => `var(--cm-a${t.id},${list('none', t.steps.length)})`,
        )
        const clocks = active.map(t => list(t.clock ?? 'auto', t.steps.length))
        const ranges = active.map(t =>
          t.clock ? seq.get(t)!.ranges : list('normal', t.steps.length),
        )
        if (withAppear) {
          slots.push(
            appearTrack(
              active.some(t => alpha.has(t)) ? 'cm-appear' : 's-appear',
            ),
          )
          clocks.push('scroll(root)')
          ranges.push(appearRange(vh!))
        }
        let css = `animation:${slots.join(',')}`
        if (withAppear || active.some(t => t.clock))
          css += `;animation-timeline:${clocks.join(',')};animation-range:${ranges.join(',')}`
        return `.${name}:is(${active.map(t => t.selector).join(',')}){${css}}`
      }
      const timed = ts.filter(t => !t.clock)
      const combine = (ap: boolean) => {
        if (timed.length === ts.length) return join(ts, ap)
        return (
          `@supports ${VIEW}{${join(ts, ap)}}` +
          (timed.length > (ap ? 0 : 1)
            ? `@supports not ${VIEW}{${join(timed, ap)}}`
            : '')
        )
      }
      if (ts.length > 1) joined.push(combine(false))
      if (vh !== undefined)
        joined.push(`@supports ${APPEAR_SUPPORT}{${combine(true)}}`)
    }
    classOn(el, name)
  }
  const rules = tracks.map(t => {
    const s = seq.get(t)!
    const slot = `--cm-a${t.id}`
    let css = `${t.extra}${s.frames}${t.selector}{${shared.has(t) ? `${slot}:${s.animation};animation:var(${slot})` : `animation:${s.animation}`}`
    if (t.clock)
      css += `;animation-timeline:${t.clock};animation-range:${s.ranges}`
    if (axes.has(t)) css += ';translate:var(--cm-x) var(--cm-y)'
    css += '}'
    if (t.inlineBox)
      css += `:where(${t.selector}.cm-inline:is(span,a)){display:inline-block}`
    if (t.inlineRestore)
      css += `:where(${t.selector}.cm-inline){--cm-inline:inline-block}`
    return t.clock ? `@supports ${VIEW}{${css}}` : css
  })
  const property = (name: string, type: string, initial: string) =>
    `@property --cm-${name}{syntax:"<${type}>";inherits:false;initial-value:${initial}}`
  const channels =
    (tracks.some(t => t.inlineRestore)
      ? '@property --cm-inline{syntax:"*";inherits:false;initial-value:inline}'
      : '') +
    (axes.size
      ? property('x', 'length-percentage', '0px') +
        property('y', 'length', '0px')
      : '')
  const opacity = alpha.size
    ? property('alpha', 'number', '1') +
      appearFrames('cm-appear', 'var(--cm-alpha)')
    : ''
  return `@media (prefers-reduced-motion:no-preference){${channels}${opacity}${rules.join('')}${joined.join('')}}`
}

/** Emit only after the real builders have chosen their elements. A table's tbody, a
 * button's glyph, or a group's mask are not authored children and never match by accident. */
export function motionCss(
  trees: Node[],
  site: HtmlNode,
  rendered: ReadonlyMap<Node, HtmlNode>,
  registry: Registry,
  style: {
    appearByClass: ReadonlyMap<string, number>
    sideClasses: ReadonlySet<string>
    inlineRestores: ReadonlySet<string>
    classOf: ReadonlyMap<string, string>
    scheme: Look['dark']
  },
) {
  const tracks: Track[] = [],
    problems: Problem[] = []
  // Task 4 skips fallback playback on a capable browser ONLY for owners in this set.
  const nativeScroll = new Set<Node>()
  const appear = new Map<HtmlNode, number>(),
    inline = new Set<HtmlNode>(),
    inlineClasses = new Set<string>()
  let side = false
  for (const el of rendered.values()) {
    const classes = el.attrs?.class
    if (typeof classes === 'string')
      for (const cls of classes.split(' ')) {
        const vh = style.appearByClass.get(cls)
        if (vh !== undefined) appear.set(el, vh)
        if (style.sideClasses.has(cls)) side = true
      }
  }
  const header = trees[1]
  for (const root of trees) {
    const chain: Node[] = []
    let views: ReturnType<typeof scrollViews> | undefined
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
      if (m.trigger === 'scroll') {
        views ??= scrollViews(
          root,
          header,
          rendered,
          style.classOf,
          style.scheme,
        )
        // A path to any one of the targets is sufficient to observe the track.
        const observable = views.filter(v =>
          nodes.some(n => n && v.visible.has(n)),
        )
        const obstacle =
          chain
            .slice(0, depth)
            .reverse()
            .find(n => observable.some(v => v.scrollers.has(n)))?.id ??
          (root === header && side && observable.some(v => v.layout !== 'phone')
            ? 'site header'
            : undefined)
        if (obstacle) {
          if (!m.scrollFallback)
            problems.push({
              code: 'INVALID_NODE',
              nodeId: w.id,
              path: 'motion.trigger',
              message: `The scroll container "${obstacle}" prevents a native viewport timeline. Use the timeline scroll fallback or move this motion outside it.`,
            })
          return
        }
        nativeScroll.add(w)
      }
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
      let inlineBox = false,
        inlineRestore = false
      if (steps.some(s => Object.keys(s.from).some(k => k !== 'opacity')))
        for (const n of nodes) {
          const el = n && rendered.get(n)
          if (!el || !n) continue
          // Core buttons/icons and fallback images already have an atomic display.
          const natural =
            (el.tag === 'span' || el.tag === 'a') &&
            !['button', 'icon', 'image'].includes(n.kind)
          const cls = style.classOf.get(n.id)
          const restore =
            cls &&
            style.inlineRestores.has(cls) &&
            String(el.attrs?.class).split(' ').includes(cls)
          if (!natural && !restore) continue
          inlineBox ||= natural
          if (restore) {
            inlineRestore = true
            inlineClasses.add(cls!)
          }
          if (!inline.has(el)) {
            inline.add(el)
            classOn(el, 'cm-inline')
          }
        }
      for (const el of targets) classOn(el, name)
      tracks.push({
        steps,
        id: i,
        selector: sel,
        targets,
        clock: scroll ? clock : undefined,
        extra,
        inlineBox,
        inlineRestore,
      })
    })
  }
  return {
    css: tracks.length ? writeTracks(tracks, appear) : '',
    problems,
    nativeScroll,
    inlineClasses,
  }
}

/** Possible nearer scrollports, kept separate for each layout in this theme. */
function scrollports(
  s: Style | undefined,
  native: boolean,
  dark: boolean,
): Record<Layout, boolean> {
  if (!s) return { desktop: native, tablet: native, phone: native }
  // clip:pill/arch and line clamping write overflow:hidden after overflow itself.
  const overflow = (d?: Decl) =>
    d?.clip === 'pill' || d?.clip === 'arch' || d?.clampLines
      ? true
      : d?.overflow === undefined
        ? undefined
        : d.overflow === 'scroll-x' || d.overflow === 'scroll-y'
  const base = overflow(s.base) ?? native
  const interactive = interactiveLayers.some(k => overflow(s[k]) === true)
  const desktop =
    ((dark ? overflow(s.dark) : undefined) ?? (base || interactive)) ||
    !!s.when?.some(v => overflow(v.decl) === true)
  const tablet = overflow(s.tablet) ?? desktop
  return { desktop, tablet, phone: overflow(s.phone) ?? tablet }
}

/** Intersect the rendered display chain in each concrete layout/theme. In
 * particular, a visible target under display:none still has no observable box. */
function scrollViews(
  root: Node,
  header: Node,
  rendered: ReadonlyMap<Node, HtmlNode>,
  classOf: ReadonlyMap<string, string>,
  scheme: Look['dark'],
) {
  return (scheme === 'auto' ? [false, true] : [scheme === 'dark']).flatMap(
    dark => {
      const views = (['desktop', 'tablet', 'phone'] as const).map(layout => ({
        layout,
        visible: new Set<Node>(),
        scrollers: new Set<Node>(),
      }))
      const chain: Node[] = []
      walk(root, (w, parent, depth) => {
        chain[depth] = w
        const el = rendered.get(w)
        if (!el) return
        // Grouped SVG parts do not receive their ordinary authored style classes.
        const cls = classOf.get(w.id),
          styled =
            cls !== undefined &&
            String(el.attrs?.class).split(' ').includes(cls)
        const displays = styled ? layoutDisplays(w, dark) : undefined
        const forced = styled
          ? stateDisplay(w, name => {
              // The emitted style selectors can match any ancestor holder or the site wrapper.
              const values = new Set<string>()
              for (const n of [header, ...chain.slice(0, depth + 1)]) {
                const d = n.state?.find(d => d.name === name)
                if (d)
                  for (const value of d.values === 'on-off'
                    ? ['on', 'off']
                    : d.values)
                    values.add(value)
              }
              return [...values]
            })
          : undefined
        const scroll = scrollports(
          styled ? w.style : undefined,
          el.tag === 'dialog' || el.attrs?.popover !== undefined,
          dark,
        )
        for (const view of views) {
          if (parent && !view.visible.has(parent)) continue
          if (!(forced ?? displays?.[view.layout] ?? true)) continue
          view.visible.add(w)
          if (scroll[view.layout]) view.scrollers.add(w)
        }
      })
      return views
    },
  )
}
