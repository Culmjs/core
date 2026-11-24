import type {
  Code,
  FontRef,
  Look,
  Motion,
  MotionTarget,
  MotionTrigger,
  Node,
  Step,
} from '../document/index.ts'
import {
  checkKeys,
  checkSteps,
  split,
  type Say,
} from '../document/motionSteps.ts'
import { resolveEffect } from '../registry/effect.ts'
import { isObj } from '../document/rules.ts'
import { dropSamples } from '../document/samples.ts'
import { templateIndex, walk } from '../document/tree.ts'
import { shownOn } from '../layout/placement.ts'
import { layoutDisplays, stateDisplay } from '../layout/display.ts'
import {
  add,
  fieldsOf,
  isNum,
  oneOf,
  specOf,
  type Ctx,
  type Entry,
  type TCtx,
  type Tree,
} from './common.ts'
import { stateIn, type StateScope } from './states.ts'
import { unrollInstances } from './unroll.ts'

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
const stateKeys = fieldsOf<Exclude<MotionTrigger, string>>({
  state: true,
  is: true,
})

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

function visualChild(
  e: StateScope,
  lookup: Lookup,
  scheme: Look['dark'],
): boolean | 'cut' {
  const w = e.w
  // An element omitted from live output cannot be revealed by a CSS rule.
  if (!(['desktop', 'tablet', 'phone'] as const).some(l => shownOn(w, l)))
    return false
  const state = stateDisplay(w, name => {
    const st = lookup(e, name)
    return st === 'cut' ? st : st?.values
  })
  return (
    state ??
    (scheme === 'auto' ? [false, true] : [scheme === 'dark']).some(dark =>
      Object.values(layoutDisplays(w, dark)).some(Boolean),
    )
  )
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

function checkTargets(owner: Node, steps: Step[], say: Say) {
  steps.forEach((s, i) => {
    const bad = targetProblem(owner, s.target, 'draw' in s.from)
    if (bad) say(bad, `motion.steps.${i}.target`)
  })
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
    const def =
      typeof m.effect === 'string' ? c.reg.effect(m.effect) : undefined
    const steps = resolveEffect(def, m.settings, say)
    if (steps) {
      // insertBlock has already applied blockIds to the stored look. Reconstruct
      // only that exact namespace mapping, then apply the ordinary owner/template check.
      for (const { target } of steps)
        if (
          typeof target === 'object' &&
          typeof e.ns === 'string' &&
          !target.id.includes('.')
        ) {
          const qualified = `${e.ns}.${target.id}`
          if (descendant(e.w, qualified)) target.id = qualified
        }
      checkTargets(e.w, steps, say)
      // Internal composition copy: retain the preset name (its declared tier is a floor)
      // alongside the exact checked steps, so the ordinary ID maps retarget them.
      c.effects.set(e.w, { ...e.w.motion!, steps })
    }
    return
  }
  const before = c.out.length
  checkSteps(m.steps, say)
  if (c.out.length === before) checkTargets(e.w, m.steps as Step[], say)
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
    // A standalone master has the layout of a use with no settings, overrides or slot content.
    const root: Node = t.comp
      ? {
          kind: 'instance',
          component: t.comp.id,
          id: t.root.id,
          name: t.root.name,
          slot: {},
        }
      : t.root
    const tree = unrollInstances(root, components, env, budget)
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
        // The default use added one namespace to every descendant of the master.
        const localId =
          t.comp && w !== tree ? w.id.slice(tree.id.length + 1) : w.id
        // A part of a master is reported on the use that contributed it.
        let id = localId
        while (!authored.has(id) && id.includes('.'))
          id = id.slice(0, id.lastIndexOf('.'))
        add(
          c,
          authored.get(id) ?? w,
          message,
          id === localId
            ? path
            : `parts.${localId.slice(id.length + 1)}.${path}`,
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
      if (tree !== t.root && 'steps' in m) checkTargets(w, m.steps, say)
    })
  }
}
