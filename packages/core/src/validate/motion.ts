import type {
  Code,
  FontRef,
  Frame,
  Look,
  Motion,
  MotionTarget,
  MotionTrigger,
  Node,
  Step,
} from '../document/index.ts'
import { ID_RE } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import { dropSamples } from '../document/samples.ts'
import { templateIndex, walk } from '../document/tree.ts'
import { shownOn } from '../layout/placement.ts'
import { childLayoutDisplay, listDisplay } from '../layout/display.ts'
import {
  add,
  fieldsOf,
  isInt,
  isNum,
  oneOf,
  specOf,
  type Ctx,
  type Entry,
  type Obj,
  type TCtx,
  type Tree,
} from './common.ts'
import { stateIn, type StateScope } from './states.ts'
import { unrollInstances } from './unroll.ts'

type Say = (message: string, path: string) => void
type Lookup = (
  scope: StateScope,
  name: string,
) => ReturnType<typeof stateIn> | 'cut'
const common = { trigger: true, pinPx: true, scrollFallback: true } as const
const sequenceKeys = fieldsOf<Extract<Motion, { steps: Step[] }>>({
  ...common,
  steps: true,
})
const effectKeys = fieldsOf<Extract<Motion, { effect: string }>>({
  ...common,
  effect: true,
  settings: true,
})
const stepKeys = fieldsOf<Step>({
  target: true,
  from: true,
  to: true,
  durationMs: true,
  delayMs: true,
  staggerMs: true,
  ease: true,
  mask: true,
})
const stateKeys = fieldsOf<Exclude<MotionTrigger, string>>({
  state: true,
  is: true,
})
const targetKeys = fieldsOf<Exclude<MotionTarget, string>>({
  id: true,
  part: true,
})
const bounds = {
  opacity: [0, 1],
  xPx: [-2000, 2000],
  yPx: [-2000, 2000],
  xPercent: [-200, 200],
  scale: [0, 8],
  scaleX: [0, 8],
  rotateDeg: [-360, 360],
  draw: [0, 1],
} satisfies Record<keyof Frame, [number, number]>
const split = ['lines', 'words', 'letters'] as const

function checkKeys(o: Obj, keys: ReadonlySet<string>, path: string, say: Say) {
  for (const k of Object.keys(o))
    if (!keys.has(k))
      say('This motion field is not supported.', `${path}.${k.slice(0, 40)}`)
}

function checkFrame(v: unknown, path: string, say: Say) {
  if (!isObj(v) || !Object.keys(v).length)
    return say('A frame needs at least one motion property.', path)
  for (const [k, n] of Object.entries(v)) {
    const at = `${path}.${k.slice(0, 40)}`
    if (!Object.hasOwn(bounds, k)) say('This is not a motion property.', at)
    else {
      const [lo, hi] = bounds[k as keyof Frame]
      if (!isNum(n, lo, hi))
        say(`This value must be a finite number from ${lo} to ${hi}.`, at)
    }
  }
  if (('xPx' in v && 'xPercent' in v) || ('scale' in v && 'scaleX' in v))
    say('Use one horizontal translation and one scale per frame.', path)
}

function isTarget(v: unknown): v is MotionTarget {
  if (!isObj(v)) return oneOf(v, ['self', 'children', 'path', ...split])
  if (
    !Object.keys(v).every(k => targetKeys.has(k)) ||
    typeof v.id !== 'string' ||
    v.id.length > 41 ||
    (Object.hasOwn(v, 'part') && v.part !== 'path')
  )
    return false
  // Stored ids are plain or block-qualified. Copy suffixes are never authored.
  const parts = v.id.split('.')
  return parts.length <= 2 && parts.every(x => ID_RE.test(x))
}

/** Stay below the owner, without crossing into a template which will produce a different id per copy. */
function descendant(owner: Node, id: string): Node | undefined {
  const children = owner.children ?? []
  const end =
    owner.repeat === undefined ? children.length : templateIndex(owner)
  for (let i = 0; i < end; i++) {
    const child = children[i]
    if (child.id === id) return child
    const hit = descendant(child, id)
    if (hit) return hit
  }
}

function targetProblem(
  owner: Node,
  target: MotionTarget,
  draw: boolean,
): string | undefined {
  const hit = typeof target === 'object' ? descendant(owner, target.id) : owner
  if (!hit)
    return 'The id must name a descendant in this tree and repeat template.'
  const path =
    target === 'path' || (typeof target === 'object' && target.part === 'path')
  if (draw && !path) return 'Drawing a stroke needs an explicit path target.'
  // Instance roots take their kind, effective settings and children from the composed tree.
  if (hit.kind === 'instance') return
  if (oneOf(target, split) && hit.kind !== 'text')
    return 'Only text can be split into lines, words or letters.'
  if (path) {
    const geometry: unknown = hit.props?.geometry
    const stroke: unknown = hit.props?.stroke
    if (hit.kind !== 'shape' || !isObj(geometry) || geometry.type !== 'path')
      return 'This target must be a path shape.'
    if (
      draw &&
      !(isObj(stroke) && typeof stroke.width === 'number' && stroke.width > 0)
    )
      return 'Drawing needs a path with a stroke of positive width.'
  }
}

/** Is there any layout/theme in which the child's own display can be visible?
 * Base, dark, tablet and phone rules cascade in that order. A hide on desktop or tablet resets on phone. */
function layoutCanShow(w: Node, scheme: Look['dark']): boolean {
  const s = w.style
  const base = s?.base?.hidden,
    tablet = s?.tablet?.hidden,
    phone = s?.phone?.hidden
  for (const dark of scheme === 'auto' ? [false, true] : [scheme === 'dark']) {
    let visible = !base && !w.hide?.desktop
    if (dark && s?.dark?.hidden === true) visible = false
    if (dark && base && s?.dark?.hidden === false) visible = true
    if (visible) return true
    if (base && tablet === false) visible = true
    if (tablet) visible = false
    // The layout's own display follows its declarations; per-layout hide flags are last.
    if (
      s?.tablet?.clampLines ||
      listDisplay(w, 'tablet') ||
      childLayoutDisplay(w, 'tablet')
    )
      visible = true
    if (w.hide?.tablet) visible = false
    if (visible) return true
    if (
      w.hide?.desktop ||
      w.hide?.tablet ||
      s?.phone?.clampLines ||
      listDisplay(w, 'phone') ||
      childLayoutDisplay(w, true)
    )
      visible = true
    if (phone ?? (s?.dark?.hidden !== false && tablet !== false && base))
      visible = false
    else if (phone === false && (tablet ?? base)) visible = true
    if (visible && !w.hide?.phone) return true
  }
  return false
}

function visualChild(
  e: StateScope,
  lookup: Lookup,
  scheme: Look['dark'],
): boolean | 'cut' {
  const w = e.w
  // An element omitted from live output cannot be revealed by a CSS rule.
  if (!(['desktop', 'tablet', 'phone'] as const).some(l => shownOn(w, l)))
    return false
  // Declared-state visibility comes last. Look back for a possible reveal without
  // a later rule winning; if every value of a state is covered there is no fallback.
  const whens = w.style?.when ?? []
  const later = new Map<string, Set<string>>()
  for (let i = whens.length - 1; i >= 0; i--) {
    const { state, is, decl } = whens[i]
    if (decl.hidden === undefined) continue
    const st = lookup(e, state)
    if (st === 'cut') return 'cut'
    if (!st?.values.includes(is)) continue
    const blocked = later.get(state) ?? new Set<string>()
    if (blocked.has(is)) continue
    if (!decl.hidden) return true
    blocked.add(is)
    if (blocked.size === st.values.length) return false
    later.set(state, blocked)
  }
  return layoutCanShow(w, scheme)
}

function canPin(
  c: Ctx,
  owner: StateScope,
  lookup: Lookup,
  scheme: Look['dark'],
  layoutOwner: Node,
): boolean | 'cut' {
  const w = owner.w
  if (specOf(c, w.kind)?.role !== 'container') return false
  let found = false
  const many =
    w.repeat && w.repeat.max !== 1
      ? w.children?.[templateIndex(w)]?.id
      : undefined
  for (const child of layoutOwner.children ?? []) {
    const visual = visualChild({ w: child, parent: owner }, lookup, scheme)
    if (visual === 'cut') return 'cut'
    if (!visual) continue
    if (found || child.id === many) return false
    found = true
  }
  return found
}

function checkStep(owner: Node, s: unknown, path: string, say: Say) {
  if (!isObj(s)) return say('A step must be an object.', path)
  checkKeys(s, stepKeys, path, say)
  checkFrame(s.from, `${path}.from`, say)
  checkFrame(s.to, `${path}.to`, say)
  const { from, to } = s
  if (isObj(from) && isObj(to)) {
    const keys = Object.keys(from)
    if (
      keys.length !== Object.keys(to).length ||
      keys.some(k => !Object.hasOwn(to, k))
    )
      say('Both frames must have the same motion properties.', `${path}.to`)
  }
  for (const [k, lo, hi] of [
    ['durationMs', 1, 10000],
    ['delayMs', 0, 10000],
    ['staggerMs', 0, 1000],
  ] as const)
    if ((k === 'durationMs' || s[k] !== undefined) && !isInt(s[k], lo, hi))
      say(
        `Use a whole number from ${lo} to ${hi} milliseconds.`,
        `${path}.${k}`,
      )
  if (
    s.ease !== undefined &&
    !oneOf(s.ease, ['linear', 'ease-out', 'expo-out'])
  )
    say('Use linear, ease-out or expo-out.', `${path}.ease`)
  if (
    s.mask !== undefined &&
    (typeof s.mask !== 'boolean' || !oneOf(s.target, split))
  )
    say('Mask is a switch for split text only.', `${path}.mask`)
  const draw =
    (isObj(s.from) && 'draw' in s.from) || (isObj(s.to) && 'draw' in s.to)
  const bad = isTarget(s.target)
    ? targetProblem(owner, s.target, draw)
    : 'This motion target is not valid.'
  if (bad) say(bad, `${path}.target`)
}

function checkSteps(owner: Node, steps: unknown, say: Say) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 16)
    return say('A motion sequence needs 1 to 16 steps.', 'motion.steps')
  for (const [i, s] of steps.entries())
    checkStep(owner, s, `motion.steps.${i}`, say)
}

/** Check the stored program and its authored IDs. State scope and visual children require the composed tree. */
export function checkMotion(c: Ctx, _t: TCtx, e: Entry): void {
  const m: unknown = e.w.motion
  if (m === undefined) return
  const say: Say = (message, path) => add(c, e.w, message, path)
  if (!isObj(m)) return say('Motion must be an object.', 'motion')
  const effect = !Object.hasOwn(m, 'steps') && Object.hasOwn(m, 'effect')
  checkKeys(m, effect ? effectKeys : sequenceKeys, 'motion', say)
  const tr = m.trigger
  if (isObj(tr)) {
    checkKeys(tr, stateKeys, 'motion.trigger', say)
    if (typeof tr.state !== 'string')
      say('A state trigger needs a state name.', 'motion.trigger.state')
    else if (typeof tr.is !== 'string')
      say('A state trigger needs a state value.', 'motion.trigger.is')
  } else if (
    !oneOf(tr, ['load', 'enter-view', 'hover', 'press', 'scroll', 'pointer-x'])
  )
    say('This motion trigger is not valid.', 'motion.trigger')
  if (m.pinPx !== undefined && (tr !== 'scroll' || !isNum(m.pinPx, 1, 4000)))
    say(
      'Pinning needs a scroll trigger and a distance of 1 to 4,000 pixels.',
      'motion.pinPx',
    )
  if (
    m.scrollFallback !== undefined &&
    (tr !== 'scroll' || m.scrollFallback !== 'timeline')
  )
    say(
      'Only a scroll trigger can use the timeline fallback.',
      'motion.scrollFallback',
    )
  if (effect) {
    if (m.settings !== undefined) {
      if (!isObj(m.settings))
        say('Effect settings must be an object of numbers.', 'motion.settings')
      else
        for (const [k, v] of Object.entries(m.settings))
          if (typeof v !== 'number' || !Number.isFinite(v))
            say(
              'An effect setting must be a finite number.',
              `motion.settings.${k.slice(0, 40)}`,
            )
    }
    // No effect definitions exist until the registry can resolve and check their steps.
    return say('This motion effect is not registered.', 'motion.effect')
  }
  checkSteps(e.w, m.steps, say)
}

/** Recheck slot ancestry, visual children and effective path geometry on the bounded composition
 * after the authored trees (including component cycles) have passed. */
export function checkComposedMotions(
  c: Ctx,
  trees: Tree[],
  fonts: FontRef[],
  scheme: Look['dark'],
): void {
  if (!trees.some(t => t.entries.some(e => e.w.motion))) return
  const components = [...c.comps.values()]
  const env = { fonts, styles: c.styles, kinds: c.kinds }
  const compose = (t: Tree) => {
    const budget = { n: 0, over: false }
    const tree = unrollInstances(t.root, components, env, budget)
    return { tree, over: budget.over }
  }
  // A local declaration never needs the header. If one does, use the very same bounded
  // composition as render; a declaration beyond a cut is not evidence of a site-wide state.
  let header: ReturnType<typeof compose> | undefined
  const composed = (t: Tree) =>
    t === c.header ? (header ??= compose(t)) : compose(t)
  const memo = new Map<Tree, boolean>()
  const hasMotion = (t: Tree): boolean => {
    if (!memo.has(t))
      memo.set(
        t,
        t.entries.some(
          ({ w }) =>
            w.motion !== undefined ||
            (w.kind === 'instance' &&
              hasMotion(c.compTrees.get(w.component!)!)),
        ),
      )
    return memo.get(t)!
  }
  for (const t of trees) {
    if (!hasMotion(t)) continue
    const { tree, over } = composed(t)
    if (over) {
      add(
        c,
        t.root,
        'The composed tree is too large or deep to check its motion targets.',
        'motion',
        'RESOURCE_LIMIT_EXCEEDED',
      )
      continue
    }
    const authored = new Map(t.entries.map(e => [e.w.id, e.w]))
    const lookup: Lookup = (scope, name) => {
      const local = stateIn(c, t, scope, name, [])
      if (local || (t.which !== 'page' && t.which !== 'footer') || !c.header)
        return local
      const h = composed(c.header)
      // The site wrapper reads only the returned root, including any declarations which survived a cut.
      const site = stateIn(c, t, null, name, h.tree.state ?? [])
      return site ?? (h.over ? 'cut' : undefined)
    }
    const scopes: StateScope[] = []
    let pinView: Map<string, Node> | undefined
    walk(tree, (w, _parent, depth) => {
      const scope = (scopes[depth] = { w, parent: scopes[depth - 1] ?? null })
      const m = w.motion
      if (!m) return
      const say = (message: string, path: string, code?: Code) => {
        // A part of a master is reported on the use that contributed it.
        let id = w.id
        while (!authored.has(id) && id.includes('.'))
          id = id.slice(0, id.lastIndexOf('.'))
        add(
          c,
          authored.get(id) ?? w,
          message,
          id === w.id ? path : `parts.${w.id.slice(id.length + 1)}.${path}`,
          code,
        )
      }
      const cutHeader = (path: string) =>
        say(
          'The header is too large or deep to establish this motion state.',
          path,
          'RESOURCE_LIMIT_EXCEEDED',
        )
      if (typeof m.trigger === 'object') {
        const st = lookup(scope, m.trigger.state)
        if (st === 'cut') cutHeader('motion.trigger.state')
        else if (!st)
          say(
            'This node does not have a state with that name in scope.',
            'motion.trigger.state',
          )
        else if (!st.values.includes(m.trigger.is))
          say('This is not a value of the declared state.', 'motion.trigger.is')
      }
      if (m.pinPx !== undefined) {
        // The live compiler infers order/wrapping after it drops samples. Keep the
        // authored scopes and repeat indices, but read layout from the possible live nodes.
        if (!pinView) {
          const live = new Map<string, Node>()
          walk(dropSamples(tree, 'before-data'), n => void live.set(n.id, n))
          pinView = live
        }
        const pin = canPin(c, scope, lookup, scheme, pinView.get(w.id) ?? w)
        if (pin === 'cut') cutHeader('motion.pinPx')
        else if (!pin)
          say(
            'Pinning needs a container with one visual child.',
            'motion.pinPx',
          )
      }
      if (tree !== t.root && 'steps' in m)
        m.steps.forEach((s, i) => {
          const bad = targetProblem(w, s.target, 'draw' in s.from)
          if (bad) say(bad, `motion.steps.${i}.target`)
        })
    })
  }
}
