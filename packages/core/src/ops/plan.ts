import { canonicalJson } from '../document/hash.ts'
import type { Problem, SiteDocument } from '../document/index.ts'
import { isObj } from '../document/rules.ts'
import { find, walk } from '../document/tree.ts'
import type { Registry } from '../registry/index.ts'
import { validateSite } from '../validate/index.ts'
import { droppedRequired } from '../validate/required.ts'
import { aliasStyles } from './aliases.ts'
import * as blocks from './blocks.ts'
import * as components from './components.ts'
import { affected, diffAll } from './diff.ts'
import * as nodes from './nodes.ts'
import * as site from './site.ts'
import { trees } from './trees.ts'
import {
  refuse,
  why,
  type Allow,
  type ChangeRequest,
  type Note,
  type Op,
  type OpFn,
  type PlanResult,
  type TreeRef,
} from './types.ts'

export { why }

/** The longest text a veto's message, rule, node id or path may have in the refusal that carries it. */
const VETO_TEXT = 500
/** Most entries copied from a veto's `allowed`. */
const VETO_ALLOWED = 50
/**
 * The refusal an `allow` result becomes: POLICY_VIOLATION, with the veto's `message`, `rule`, `nodeId` and `path` when they are text
 * (cut at 500 characters; a cut message ends with an ellipsis) and its `allowed` when it is a list of texts (the first 50). Any other field, any value of the wrong type
 * and a result that cannot be read are left out; the message is then "Not allowed.". Never throws, so a hostile `allow` is still a
 * policy refusal.
 */
export function vetoProblem(veto: unknown): Problem {
  const out: Problem = { code: 'POLICY_VIOLATION', message: 'Not allowed.' }
  try {
    if (!isObj(veto)) return out
    const text = (v: unknown) =>
      typeof v === 'string' ? v.slice(0, VETO_TEXT) : undefined
    const { message, rule, nodeId, path, allowed } = veto
    // a cut message ends with an ellipsis, so the cut shows
    out.message =
      (typeof message === 'string' && message.length > VETO_TEXT
        ? `${message.slice(0, VETO_TEXT - 1)}\u2026`
        : text(message)) || out.message
    const keep = { rule: text(rule), nodeId: text(nodeId), path: text(path) }
    for (const [k, v] of Object.entries(keep))
      if (v !== undefined) (out as Record<string, unknown>)[k] = v
    if (Array.isArray(allowed) && allowed.every(a => typeof a === 'string'))
      out.allowed = allowed
        .slice(0, VETO_ALLOWED)
        .map(a => a.slice(0, VETO_TEXT))
  } catch {
    // a getter that throws: keep what was read
  }
  return out
}

export const MAX_OPS = 200
export const MAX_REQUEST_CHARS = 1_000_000

const TABLE: { [K in Op['op']]: OpFn<K> } = {
  add: nodes.add,
  remove: nodes.remove,
  move: nodes.move,
  setProps: nodes.setProps,
  setText: nodes.setText,
  setStyle: nodes.setStyle,
  setHidden: nodes.setHidden,
  setSlot: nodes.setSlot,
  setRequired: nodes.setRequired,
  bindData: nodes.bindData,
  setStates: nodes.setStates,
  setMotion: nodes.setMotion,
  insertBlock: blocks.insertBlock,
  setBlockSetting: blocks.setBlockSetting,
  updateBlock: blocks.updateBlock,
  makeComponent: components.makeComponent,
  setInstance: components.setInstance,
  detach: components.detach,
  removeComponent: components.removeComponent,
  addPage: site.addPage,
  removePage: site.removePage,
  setPage: site.setPage,
  movePage: site.movePage,
  setSite: site.setSite,
  setLook: site.setLook,
  setSiteStyles: site.setSiteStyles,
  setFonts: site.setFonts,
  addCustomEffect: site.addCustomEffect,
}
/** The operation names in the order of the spec's table. */
export const OP_NAMES: readonly Op['op'][] = [
  'add', 'remove', 'move', 'setProps', 'setText', 'setStyle', 'setHidden', 'setSlot', 'setRequired',
  'bindData', 'setStates', 'setMotion',
  'insertBlock', 'setBlockSetting', 'updateBlock',
  'makeComponent', 'setInstance', 'detach', 'removeComponent',
  'addPage', 'removePage', 'setPage', 'movePage', 'setSite', 'setLook', 'setSiteStyles', 'setFonts',
  'addCustomEffect',
] // prettier-ignore

const fail = (
  problems: Problem[],
  op?: number,
): Extract<PlanResult, { ok: false }> => ({
  ok: false,
  problems: op === undefined ? problems : problems.map(p => ({ ...p, op })),
})
const bad = (message: string, more: Partial<Problem> = {}) =>
  fail(refuse('INVALID_OPERATION', message, more).problems)

/** Every `{ page: slug }` link of a node, as slugs: a `link` prop, a run's `link`, a trigger's `goTo`. */
function pageLinks(n: unknown): string[] {
  const out: string[] = []
  const take = (l: unknown) => {
    if (isObj(l) && typeof l.page === 'string') out.push(l.page)
  }
  if (!isObj(n)) return out
  if (isObj(n.props)) {
    take(n.props.link)
    if (Array.isArray(n.props.runs))
      for (const r of n.props.runs) if (isObj(r)) take(r.link)
  }
  if (Array.isArray(n.on))
    for (const t of n.on) if (isObj(t) && isObj(t.do)) take(t.do.goTo)
  return out
}
/** `id slug` of every page link in the document, in document order, with whether a page that is on has the slug (the rule of `href`). */
function linkRows(doc: SiteDocument) {
  const live = new Set(doc.pages.filter(p => p.on).map(p => p.slug))
  const rows: { id: string; slug: string; live: boolean }[] = []
  for (const { root } of trees(doc))
    walk(root, n => {
      for (const slug of pageLinks(n))
        rows.push({ id: n.id, slug, live: live.has(slug) })
    })
  return rows
}
function brokenLinks(before: SiteDocument, after: SiteDocument): Note[] {
  const dead = new Set(
    linkRows(before)
      .filter(r => !r.live)
      .map(r => `${r.id}\0${r.slug}`),
  )
  const ids = [
    ...new Set(
      linkRows(after)
        .filter(r => !r.live && !dead.has(`${r.id}\0${r.slug}`))
        .map(r => r.id),
    ),
  ]
  return ids.length
    ? [
        {
          kind: 'info',
          ids,
          text: `These links now lead to no page: ${ids.join(', ')}.`,
        },
      ]
    : []
}

const refKey = (tree: TreeRef, id: string) =>
  `${typeof tree === 'string' ? tree : 'page' in tree ? `p:${tree.page}` : `c:${tree.component}`}:${id}`

/** Project edits for id allocation and subsequent lookups. Intermediate references
 * may still be unresolved. Only plan/apply check a publishable batch boundary. */
function runOps(
  doc: SiteDocument,
  registry: Registry,
  request: ChangeRequest,
  allow?: Allow,
) {
  let i: number | undefined
  try {
    if (!isObj(request) || !Array.isArray(request.ops))
      return bad('ops must be a list.', { path: 'ops' })
    const { ops, key: idemKey, baseRevision } = request
    if (typeof idemKey !== 'string' || !idemKey || idemKey.length > 200)
      return bad('key must be a text of 1 to 200 characters.', { path: 'key' })
    if (!Number.isInteger(baseRevision))
      return bad('baseRevision must be a whole number.', {
        path: 'baseRevision',
      })
    if (ops.length === 0)
      return bad('ops must hold at least one operation.', { path: 'ops' })
    if (ops.length > MAX_OPS)
      return fail(
        refuse(
          'RESOURCE_LIMIT_EXCEEDED',
          `At most ${MAX_OPS} operations in one batch.`,
          { path: 'ops' },
        ).problems,
      )
    let size: number
    try {
      size = canonicalJson({ key: idemKey, baseRevision, ops }).length
    } catch {
      // Something in the request cannot be written as JSON (a cycle, a BigInt): name the first operation that cannot, if one does.
      const k = ops.findIndex(o => {
        try {
          canonicalJson(o)
          return false
        } catch {
          return true
        }
      })
      return fail(
        refuse('INVALID_OPERATION', 'The request cannot be written as JSON.', {
          path: 'ops',
        }).problems,
        k < 0 ? undefined : k,
      )
    }
    if (size > MAX_REQUEST_CHARS)
      return fail(
        refuse(
          'RESOURCE_LIMIT_EXCEEDED',
          `A request holds at most ${MAX_REQUEST_CHARS} characters.`,
        ).problems,
      )

    let work = doc
    // The operations' own created and changed lists serve one purpose here: the index of the operation to blame for a validation problem.
    const last = new Map<string, number>() // tree:id -> index of the last operation that created, changed or removed it
    const lastById = new Map<string, number>()
    const motion = new Map<string, number>()
    const motionById = new Map<string, number>()
    const notes: Note[] = []
    for (i = 0; i < ops.length; i++) {
      const op: unknown = ops[i]
      if (
        !isObj(op) ||
        typeof op.op !== 'string' ||
        !Object.hasOwn(TABLE, op.op)
      )
        return fail(
          refuse(
            'INVALID_OPERATION',
            isObj(op)
              ? `Unknown operation "${String(op.op)}".`
              : 'An operation must be an object.',
            { path: 'op', allowed: OP_NAMES },
          ).problems,
          i,
        )
      let veto: Problem | undefined
      try {
        veto = allow?.(op as Op, work)
      } catch (e) {
        veto = {
          code: 'POLICY_VIOLATION',
          message: `allow failed: ${why(e)}`,
          rule: 'allow',
        }
      }
      if (veto) return fail([vetoProblem(veto)], i)
      const r = (TABLE[op.op as Op['op']] as OpFn<Op['op']>)(
        work,
        registry,
        op as Op,
      )
      if (!r.ok) return fail(r.problems, i)
      work = r.doc
      for (const c of [...r.created, ...r.changed]) {
        last.set(refKey(c.tree, c.id), i)
        lastById.set(c.id, i)
      }
      for (const c of r.created) {
        motion.set(refKey(c.tree, c.id), i)
        motionById.set(c.id, i)
      }
      if (op.op === 'setMotion' && typeof op.id === 'string') {
        const tree = (op as { tree?: TreeRef }).tree
        if (tree) motion.set(refKey(tree, op.id), i)
        motionById.set(op.id, i)
      }
      if (op.op === 'remove' && typeof op.id === 'string') {
        const tree = (op as { tree?: TreeRef }).tree
        if (tree) last.set(refKey(tree, op.id), i)
        lastById.set(op.id, i)
      }
      if (r.notes) notes.push(...r.notes)
    }
    return {
      ok: true as const,
      doc: work,
      last,
      lastById,
      motion,
      motionById,
      notes,
    }
  } catch (e) {
    return fail(refuse('INVALID_OPERATION', why(e)).problems, i)
  }
}

export function projectOps(
  doc: SiteDocument,
  registry: Registry,
  request: ChangeRequest,
): { ok: true; doc: SiteDocument } | Extract<PlanResult, { ok: false }> {
  const r = runOps(doc, registry, request)
  return r.ok ? { ok: true, doc: r.doc } : r
}

/** Validate the actual final projection, then diff it. Touches no store. */
export function plan(
  doc: SiteDocument,
  registry: Registry,
  request: ChangeRequest,
  allow?: Allow,
): PlanResult {
  try {
    const r = runOps(doc, registry, request, allow)
    if (!r.ok) return r
    const { last, lastById, motion, motionById, notes } = r
    const work = aliasStyles(r.doc)
    const workTrees = trees(work)
    const blameOp = (p: Problem): number | undefined => {
      if (p.nodeId === undefined) return undefined
      const match = workTrees
        .map(t => ({ tree: t.tree, node: find(t.root, p.nodeId!) }))
        .find(x => x.node)
      const ownerKey = match ? refKey(match.tree, p.nodeId) : undefined
      const baseOp =
        (ownerKey !== undefined ? last.get(ownerKey) : undefined) ??
        lastById.get(p.nodeId)
      if (!p.path?.includes('motion')) return baseOp
      let opIdx =
        (ownerKey !== undefined ? motion.get(ownerKey) : undefined) ??
        motionById.get(p.nodeId) ??
        -1
      const tm = /motion\.steps\.(\d+)\.target/.exec(p.path)
      if (tm && match?.node?.motion && 'steps' in match.node.motion) {
        const step = match.node.motion.steps[Number(tm[1])]
        if (step && typeof step.target === 'object') {
          const tId = step.target.id
          const targetOp =
            last.get(refKey(match.tree, tId)) ?? lastById.get(tId)
          if (targetOp !== undefined) opIdx = Math.max(opIdx, targetOp)
        }
      }
      return opIdx >= 0 ? opIdx : baseOp
    }
    const problems = validateSite(work, registry)
    if (problems.length)
      return {
        ok: false,
        problems: problems.map(p => {
          const op = blameOp(p)
          return op === undefined ? p : { ...p, op }
        }),
      }

    // Checked once per batch: what the live page leaves out as samples depends on the whole tree, and the end state is what is published.
    const dropped = droppedRequired(doc, work, registry)
    if (dropped) {
      const op = blameOp(dropped)
      return {
        ok: false,
        problems: [op === undefined ? dropped : { ...dropped, op }],
      }
    }

    // What the batch made and changed is what the diff reports, so the two cannot disagree.
    const d = diffAll(doc, work)
    return {
      ok: true,
      doc: work,
      ...affected(d),
      pages: d.pages,
      notes: [...notes, ...brokenLinks(doc, work)],
    }
  } catch (e) {
    return fail(refuse('INVALID_OPERATION', why(e)).problems)
  }
}
