import type { MotionTarget, Node, Step } from '../document/index.ts'
import { split, type Say } from '../document/motionSteps.ts'
import { isObj, oneOf } from '../document/rules.ts'
import { templateIndex } from '../document/tree.ts'
import { partPaint, type PartPaint } from '../document/shapePaint.ts'

/** A reference cannot cross into a template which will produce a different id per copy. */
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

/** An inserted block's look used local ids before blockIds qualified the stored nodes. */
export function presetTarget(
  owner: Node,
  t: MotionTarget,
  ns?: unknown,
): MotionTarget {
  if (typeof t === 'object' && typeof ns === 'string' && !t.id.includes('.')) {
    const id = `${ns}.${t.id}`
    if (descendant(owner, id)) return { ...t, id }
  }
  return t
}

/** SVG stroke inherits in a layer. Union and the first subtract part paint with
 * the outer group; the remaining subtract parts paint black, stroke:none, in its mask. */
export function paintedStrokes(root: Node) {
  const painted = new Set<Node>()
  const visit = (n: Node, inherited: boolean, how: PartPaint) => {
    const g: unknown = n.props?.geometry
    const group = n.kind === 'shape' && isObj(g) && g.type === 'group'
    const stroke: unknown = n.props?.stroke
    const draws =
      how !== 'cut' &&
      (how === 'own' && isObj(stroke) ? Number(stroke.width) > 0 : inherited)
    if (draws) painted.add(n)
    n.children?.forEach((child, i) => {
      visit(child, group && draws, group ? partPaint(g.combine, i, how) : 'own')
    })
  }
  visit(root, false, 'own')
  return painted
}

export function targetProblem(
  owner: Node,
  t: MotionTarget,
  draw: boolean,
  painted?: () => ReadonlySet<Node>,
): string | undefined {
  const hit = typeof t === 'object' ? descendant(owner, t.id) : owner
  if (!hit)
    return 'The id must name a descendant in this tree and repeat template.'
  // An instance takes its kind, settings and children from the composed tree.
  if (hit.kind === 'instance')
    return painted &&
      (t === 'path' || (typeof t === 'object' && t.part === 'path'))
      ? 'Path geometry must be known on the composed shape.'
      : undefined
  if (oneOf(t, split) && hit.kind !== 'text')
    return 'Only text can be split into lines, words or letters.'
  if (t === 'path' || (typeof t === 'object' && t.part === 'path')) {
    const g: unknown = hit.props?.geometry
    if (hit.kind !== 'shape' || !isObj(g) || g.type !== 'path')
      return 'This target must be a path shape.'
    if (draw && painted && !painted().has(hit))
      return 'Drawing needs a path with a painted stroke of positive width.'
  }
}

export function checkTargets(
  owner: Node,
  steps: Step[],
  say: Say,
  painted?: () => ReadonlySet<Node>,
) {
  steps.forEach((s, i) => {
    const bad = targetProblem(owner, s.target, 'draw' in s.from, painted)
    if (bad) say(bad, `motion.steps.${i}.target`)
  })
}
