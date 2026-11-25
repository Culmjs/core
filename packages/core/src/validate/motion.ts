import type {
  Code,
  FontRef,
  Look,
  Motion,
  MotionTrigger,
  Node,
  Step,
} from '../document/index.ts'
import { checkKeys, checkSteps, type Say } from '../document/motionSteps.ts'
import { resolveEffect } from '../registry/effect.ts'
import { isObj } from '../document/rules.ts'
import { dropSamples } from '../document/samples.ts'
import { templateIndex, walk } from '../document/tree.ts'
import { visualChild } from '../layout/display.ts'
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
import { checkTargets, paintedStrokes, presetTarget } from './motionTargets.ts'
import { checkGpuMotion, gpuOwnerProblems } from './gpu.ts'

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
    const visual = visualChild(child, scheme, name => {
      const st = lookup({ w: child, parent: owner }, name)
      return st === 'cut' ? st : st?.values
    })
    if (visual === 'cut') return 'cut'
    if (!visual) continue
    if (found || child.id === many) return false
    found = true
  }
  return found
}

/** Check the stored program and its authored IDs. State scope and visual children require the composed tree. */
export function checkMotion(c: Ctx, _t: TCtx, e: Entry): void {
  const m: unknown = e.w.motion
  if (m === undefined) return
  const say: Say = (message, path) => add(c, e.w, message, path)
  if (!isObj(m)) return say('Motion must be an object.', 'motion')
  if (Object.hasOwn(m, 'gpu')) return checkGpuMotion(c, e.w, m)
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
      for (const step of steps)
        step.target = presetTarget(e.w, step.target, e.ns)
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
    let painted: Set<Node> | undefined
    let gpuProblems: Map<Node, string> | undefined
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
      if ('gpu' in m) {
        const issue = (gpuProblems ??= gpuOwnerProblems(tree, scheme)).get(w)
        if (issue) say(issue, 'motion.gpu')
        return
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
      if ('steps' in m)
        checkTargets(w, m.steps, say, () => (painted ??= paintedStrokes(tree)))
    })
  }
}
