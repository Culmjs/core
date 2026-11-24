import type {
  Frame,
  Look,
  Motion,
  Node,
  Problem,
  Step,
} from '../document/index.ts'
import { find, orderedChildren, walk } from '../document/tree.ts'
import { cssEase } from '../scripts/motionEase.ts'
import { stepsTier } from '../document/motionSteps.ts'
import { scrollScene } from './scrollScene.ts'
import { StateConditions, StateAnalysisLimit } from './stateConditions.ts'
import { resolveEffect } from '../registry/effect.ts'
import type { Registry } from '../registry/index.ts'
import type { HtmlNode } from './html.ts'
import type { Scene } from '../scripts/motionHost.ts'
import { prepareTracks, type BoundStep } from './motionTracks.ts'
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

function keyboardOwner(owner: HtmlNode) {
  const attrs = (owner.attrs ??= {})
  if (
    attrs.tabindex === undefined &&
    !['button', 'input', 'select', 'textarea'].includes(owner.tag) &&
    !(owner.tag === 'a' && attrs.href)
  )
    attrs.tabindex = 0
}

type Binding = { holder: HtmlNode; attr: string; initial: string; is: string }
function bindState(
  m: Motion,
  chain: Node[],
  depth: number,
  header: Node,
  site: HtmlNode,
  rendered: ReadonlyMap<Node, HtmlNode>,
): Binding | undefined {
  if (typeof m.trigger !== 'object') return
  const { state, is } = m.trigger
  const holds = (n: Node) => n.state?.find(s => s.name === state)
  const n =
    chain
      .slice(0, depth + 1)
      .reverse()
      .find(holds) ?? header
  const holder = n === header ? site : rendered.get(n),
    declaration = holds(n)
  if (holder && declaration)
    return { holder, attr: `data-s-${state}`, initial: declaration.initial, is }
}

type InlineStyles = {
  classOf: ReadonlyMap<string, string>
  inlineRestores: ReadonlySet<string>
}
function inlineTarget(n: Node, el: HtmlNode, style: InlineStyles) {
  const natural =
    (el.tag === 'span' || el.tag === 'a') &&
    !['button', 'icon', 'image'].includes(n.kind)
  const cls = style.classOf.get(n.id)
  const restore =
    cls &&
    style.inlineRestores.has(cls) &&
    String(el.attrs?.class).split(' ').includes(cls)
      ? cls
      : undefined
  return { natural, restore }
}

type Pending = { w: Node; owner: HtmlNode; steps: Step[]; state?: Binding }
function timelines(
  programs: Pending[],
  rendered: ReadonlyMap<Node, HtmlNode>,
  native: ReadonlySet<Node>,
  style: InlineStyles,
  inlineClasses: Set<string>,
  appear: ReadonlyMap<HtmlNode, number>,
) {
  const tokens = new Map<HtmlNode, number>()
  const token = (el: HtmlNode) => {
    let id = tokens.get(el)
    if (!id) {
      id = tokens.size + 1
      tokens.set(el, id)
      classOn(el, `cm-e${id}`)
    }
    return id
  }
  const natural = new Set<string>(),
    restores = new Set<string>()
  let timeline = false
  let alpha = false
  for (const { w, owner, steps, state } of programs) {
    const bound: BoundStep[] = []
    const draw = new Set<number>(),
      reveals = new Set<number>()
    const m = w.motion!
    for (const step of steps) {
      const t = step.target
      const part =
        typeof t === 'object'
          ? t.part
          : t === 'self' || t === 'children'
            ? undefined
            : t
      const nodes =
        t === 'children'
          ? orderedChildren(w)
          : [typeof t === 'object' ? find(w, t.id) : w]
      const targets: number[] = []
      for (const n of nodes) {
        if (!n) continue
        const element = rendered.get(n)
        // A grouped SVG can contain defs/masks and other shapes' paths. Bind
        // only the actual direct geometry of the validated mapped shape.
        const el =
          part === 'path'
            ? element?.children?.find(
                (e): e is HtmlNode => typeof e !== 'string' && e.tag === 'path',
              )
            : element
        if (!el) continue
        const id = owner === el ? 0 : token(el)
        targets.push(id)
        if (step.from.draw !== undefined) draw.add(id)
        if (step.from.opacity !== undefined && appear.has(el)) reveals.add(id)
        if (part || !Object.keys(step.from).some(k => k !== 'opacity')) continue
        const inl = inlineTarget(n, el, style)
        if (!inl.natural && !inl.restore) continue
        const sel =
          `.cm-e${token(owner)}[data-culm-playing]` + (id ? ` .cm-e${id}` : '')
        if (inl.natural) natural.add(sel)
        if (inl.restore) {
          restores.add(sel)
          inlineClasses.add(inl.restore)
        }
      }
      if (targets.length) bound.push({ step, targets, part })
    }
    if (!bound.length) continue
    let trigger: Scene['trigger']
    if (typeof m.trigger === 'object') {
      if (!state) continue
      const { holder, attr, initial, is } = state
      ;(holder.attrs ??= {})[attr] ??= initial
      trigger = [token(holder), attr, is]
    } else trigger = m.trigger
    if (trigger === 'hover' || trigger === 'press') keyboardOwner(owner)
    const scene: Scene = {
      trigger,
      ...prepareTracks(bound, reveals),
      ...(native.has(w) && { native: true }),
      ...(draw.size && { draw: [...draw] }),
      ...(m.pinPx && { pin: m.pinPx }),
    }
    ;(owner.attrs ??= {})['data-culm-motion'] = JSON.stringify(scene)
    timeline = true
    const usesReveal = (tracks: Scene['tracks']) => tracks.some(t => !!t[3])
    alpha ||=
      usesReveal(scene.tracks) || !!scene.parts?.some(p => usesReveal(p.tracks))
  }
  const css =
    (natural.size ? `:where(${[...natural]}){display:inline-block}` : '') +
    (restores.size
      ? '@property --cm-inline{syntax:"*";inherits:false;initial-value:inline}' +
        `:where(${[...restores]}){--cm-inline:inline-block}`
      : '')
  return {
    timeline,
    alpha,
    css: css ? `@media (prefers-reduced-motion:no-preference){${css}}` : '',
  }
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
function writeTracks(
  tracks: Track[],
  appear: Map<HtmlNode, number>,
  hostAlpha: boolean,
) {
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
  const opacity =
    (alpha.size || hostAlpha ? property('alpha', 'number', '1') : '') +
    (alpha.size ? appearFrames('cm-appear', 'var(--cm-alpha)') : '')
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
  const pending: Pending[] = []
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
  let conditions: StateConditions | undefined
  for (const root of trees) {
    const chain: Node[] = []
    let blocker: ReturnType<typeof scrollScene> | undefined
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
      const state = bindState(m, chain, depth, header, site, rendered)
      if (tier === 2 || m.scrollFallback)
        pending.push({ w, owner, steps, state })
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
        blocker ??= scrollScene(
          root,
          header,
          site,
          rendered,
          style.classOf,
          style.scheme,
          side,
          (conditions ??= new StateConditions()),
        )
        let obstacle: string | undefined
        try {
          obstacle = blocker(w, nodes)
        } catch (error) {
          if (!(error instanceof StateAnalysisLimit)) throw error
          if (!m.scrollFallback)
            problems.push({
              code: 'RESOURCE_LIMIT_EXCEEDED',
              nodeId: w.id,
              path: 'motion.trigger',
              message:
                'The declared-state conditions are too complex to establish a native viewport timeline. Use the timeline scroll fallback.',
            })
          return
        }
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
        if (hover) keyboardOwner(owner)
        sel =
          ownerSel +
          (hover ? ':is(:hover,:focus-visible)' : ':active') +
          (self ? '' : ` ${sel}`)
      } else if (typeof m.trigger === 'object') {
        if (!state) return
        const { holder: h, attr, initial, is } = state
        // Group parts bypass ordinary build attributes; install the real declaration
        // only if one is needed here. The header root's attribute lives on the site.
        ;(h.attrs ??= {})[attr] ??= initial
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
          const { natural, restore } = inlineTarget(n, el, style)
          if (!natural && !restore) continue
          inlineBox ||= natural
          if (restore) {
            inlineRestore = true
            inlineClasses.add(restore)
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
  const host = timelines(
    pending,
    rendered,
    nativeScroll,
    style,
    inlineClasses,
    appear,
  )
  return {
    css:
      (tracks.length || host.alpha
        ? writeTracks(tracks, appear, host.alpha)
        : '') + host.css,
    hostAlpha: host.alpha,
    timeline: host.timeline,
    problems,
    nativeScroll,
    inlineClasses,
  }
}
