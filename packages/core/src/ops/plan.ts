import { canonicalJson } from '../document/hash.ts'
import type { Problem, SiteDocument } from '../document/index.ts'
import { isObj } from '../document/rules.ts'
import { walk } from '../document/tree.ts'
import type { Registry } from '../registry/index.ts'
import { validateSite } from '../validate/index.ts'
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
} from './types.ts'

export { why }

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
}
/** The operation names in the order of the spec's table. */
export const OP_NAMES: readonly Op['op'][] = [
  'add', 'remove', 'move', 'setProps', 'setText', 'setStyle', 'setHidden', 'setSlot', 'setRequired',
  'bindData', 'setStates',
  'insertBlock', 'setBlockSetting', 'updateBlock',
  'makeComponent', 'setInstance', 'detach', 'removeComponent',
  'addPage', 'removePage', 'setPage', 'movePage', 'setSite', 'setLook', 'setSiteStyles', 'setFonts',
] // prettier-ignore

const fail = (problems: Problem[], op?: number): PlanResult => ({
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

/**
 * Runs the operations on a copy of `doc` and returns the new document, or the refusal. Touches no store and never throws.
 * Order: the shape of the request, the two size limits, then for each operation its shape, `allow`, its function; after the last, `validateSite` once.
 */
export function plan(
  doc: SiteDocument,
  registry: Registry,
  request: ChangeRequest,
  allow?: Allow,
): PlanResult {
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
    if (ops.length > MAX_OPS)
      return fail(
        refuse(
          'RESOURCE_LIMIT_EXCEEDED',
          `At most ${MAX_OPS} operations in one batch.`,
          { path: 'ops' },
        ).problems,
      )
    if (
      canonicalJson({ key: idemKey, baseRevision, ops }).length >
      MAX_REQUEST_CHARS
    )
      return fail(
        refuse(
          'RESOURCE_LIMIT_EXCEEDED',
          `A request holds at most ${MAX_REQUEST_CHARS} characters.`,
        ).problems,
      )

    let work = doc
    // The operations' own created and changed lists serve one purpose here: the index of the operation to blame for a validation problem.
    const last = new Map<string, number>() // node id -> index of the last operation that created or changed it
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
      if (veto)
        return fail(
          [
            {
              ...(isObj(veto) ? veto : {}),
              code: 'POLICY_VIOLATION',
              message: String(veto?.message ?? 'Not allowed.'),
            },
          ],
          i,
        )
      const r = (TABLE[op.op as Op['op']] as OpFn<Op['op']>)(
        work,
        registry,
        op as Op,
      )
      if (!r.ok) return fail(r.problems, i)
      work = r.doc
      for (const c of [...r.created, ...r.changed]) last.set(c.id, i)
      if (r.notes) notes.push(...r.notes)
    }
    i = undefined

    const problems = validateSite(work, registry)
    if (problems.length)
      return {
        ok: false,
        problems: problems.map(p =>
          p.nodeId !== undefined && last.has(p.nodeId)
            ? { ...p, op: last.get(p.nodeId) }
            : p,
        ),
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
    return fail(refuse('INVALID_OPERATION', why(e)).problems, i)
  }
}
