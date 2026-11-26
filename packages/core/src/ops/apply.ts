import { canonicalJson } from '../document/hash.ts'
import type { SiteDocument } from '../document/index.ts'
import { migrate, SCHEMA_VERSION } from '../document/migrate.ts'
import { isObj } from '../document/rules.ts'
import type { Registry } from '../registry/index.ts'
import { validateSite } from '../validate/index.ts'
import { affected, diffAll } from './diff.ts'
import { plan, vetoProblem, why } from './plan.ts'
import {
  refuse,
  type Allow,
  type ApplyResult,
  type ChangeRequest,
  type SiteStore,
} from './types.ts'

const invalid = (message: string, path?: string): ApplyResult =>
  refuse('INVALID_OPERATION', message, path === undefined ? {} : { path })
const whole = (x: unknown): x is number => Number.isInteger(x)
/** A key is a text of 1 to 200 characters: the same bound `plan` holds, checked before the store is asked about it. */
const keyOk = (k: unknown): k is string =>
  typeof k === 'string' && k.length >= 1 && k.length <= 200
const KEY_MESSAGE = 'key must be a text of 1 to 200 characters.'

/** The steps both functions share: replay, then head. Returns the refusal, or the head to work from. */
async function begin(
  store: SiteStore,
  site: string,
  key: string,
  baseRevision: number,
  request: string,
): Promise<ApplyResult | { doc: SiteDocument; readStamp?: string }> {
  const seen = await store.replay(site, key)
  if (seen)
    return seen.request === request
      ? seen.result
      : refuse('KEY_CONFLICT', 'This key was used for other content.', {
          path: 'key',
        })
  const head = await store.head(site)
  if ('problems' in head) return { ok: false, problems: head.problems }
  if (head.revision !== baseRevision)
    return refuse(
      'REVISION_CONFLICT',
      `The site is at revision ${head.revision}, not ${baseRevision}.`,
      { path: 'baseRevision' },
    )
  return head
}

async function finish(
  store: SiteStore,
  site: string,
  baseRevision: number,
  doc: SiteDocument,
  key: string,
  request: string,
  made: Omit<Extract<ApplyResult, { ok: true }>, 'ok' | 'revision'>,
  readStamp?: string,
): Promise<ApplyResult> {
  const result: ApplyResult = { ok: true, revision: baseRevision + 1, ...made }
  const c = await store.commit(site, {
    expected: baseRevision,
    ...(readStamp !== undefined ? { readStamp } : {}),
    doc,
    key,
    request,
    result,
  })
  if (c.ok) return c.result
  return {
    ok: false,
    problems: [
      { code: c.code, message: `The store refused the change: ${c.code}.` },
      ...(c.problems ?? []),
    ],
  }
}

/**
 * Plans the batch against the head and commits it under the contract's four steps (replay the key, check the revision, plan, commit).
 * A bad request (not an object, no `site` or `key`, `baseRevision` not a whole number, `ops` not a list, a request that cannot be
 * serialised) is returned as INVALID_OPERATION before the store is called. An exception thrown by the STORE is not caught:
 * the returned promise rejects with it.
 */
export async function apply(
  store: SiteStore,
  registry: Registry,
  request: ChangeRequest,
  allow?: Allow,
): Promise<ApplyResult> {
  let snap: ChangeRequest
  let text: string
  try {
    if (!isObj(request)) return invalid('The request must be an object.')
    // Each field is read once; everything below uses only this snapshot.
    const { site, key, baseRevision, ops } = request
    if (typeof site !== 'string' || !site)
      return invalid('site must be a text.', 'site')
    if (!keyOk(key)) return invalid(KEY_MESSAGE, 'key')
    if (!whole(baseRevision))
      return invalid('baseRevision must be a whole number.', 'baseRevision')
    if (!Array.isArray(ops)) return invalid('ops must be a list.', 'ops')
    const frozen = JSON.parse(canonicalJson(ops)) as ChangeRequest['ops']
    snap = { site, key, baseRevision, ops: frozen }
    text = canonicalJson({ baseRevision, ops: frozen })
  } catch (e) {
    return invalid(`The request cannot be read: ${why(e)}`)
  }
  const { site, key, baseRevision } = snap
  const b = await begin(store, site, key, baseRevision, text)
  if (!('doc' in b)) return b
  let head = b.doc
  if (head.schemaVersion < SCHEMA_VERSION) {
    const m = migrate(head)
    if (!m.ok) return { ok: false, problems: [m.problem] }
    head = m.doc
  }
  const p = plan(head, registry, snap, allow)
  if (!p.ok) return p
  const { doc, ...made } = p
  return finish(store, site, baseRevision, doc, key, text, made, b.readStamp)
}

/**
 * Commits the document at revision `to` as a new revision, under the same contract as `apply` (replay, head, then: get, migrate,
 * validate against the current registry, `allow` once with `{ op: 'restore', to }`, commit). `to` equal to the head is allowed; `to`
 * that the store does not hold is UNSUPPORTED_CAPABILITY. A bad request is returned as INVALID_OPERATION before the store is called.
 * An exception thrown by the STORE is not caught: the returned promise rejects with it.
 */
export async function restore(
  store: SiteStore,
  registry: Registry,
  request: { site: string; to: number; baseRevision: number; key: string },
  allow?: Allow,
): Promise<ApplyResult> {
  let site: string, key: string, baseRevision: number, to: number
  let text: string
  try {
    if (!isObj(request)) return invalid('The request must be an object.')
    const r = request
    site = r.site
    key = r.key
    baseRevision = r.baseRevision
    to = r.to
    if (typeof site !== 'string' || !site)
      return invalid('site must be a text.', 'site')
    if (!keyOk(key)) return invalid(KEY_MESSAGE, 'key')
    if (!whole(baseRevision))
      return invalid('baseRevision must be a whole number.', 'baseRevision')
    if (!whole(to)) return invalid('to must be a whole number.', 'to')
    text = canonicalJson({ baseRevision, restore: to })
  } catch (e) {
    return invalid(`The request cannot be read: ${why(e)}`)
  }
  const b = await begin(store, site, key, baseRevision, text)
  if (!('doc' in b)) return b
  const unsupported = () =>
    refuse(
      'UNSUPPORTED_CAPABILITY',
      `The store does not hold revision ${to}.`,
      {
        path: 'to',
      },
    )
  // Before `store.get`, which is not asked about a revision above the head or below 0: `begin` has checked that `baseRevision` is the
  // head, so no store holds such a revision. The order is part of the contract (the test 'restore to a revision the store does not hold').
  if (to > baseRevision || to < 0) return unsupported()
  const old = await store.get(site, to)
  if (old === undefined) return unsupported()
  let restored: SiteDocument
  try {
    let d: unknown = old
    if (isObj(d) && d.schemaVersion !== SCHEMA_VERSION) {
      const m = migrate(d)
      if (!m.ok) return { ok: false, problems: [m.problem] }
      d = m.doc
    }
    restored = d as SiteDocument
    const problems = validateSite(restored, registry)
    if (problems.length) return { ok: false, problems }
  } catch (e) {
    return refuse(
      'INVALID_DOCUMENT',
      `Revision ${to} cannot be read: ${why(e)}`,
    )
  }
  let veto
  try {
    veto = allow?.({ op: 'restore', to }, restored)
  } catch (e) {
    veto = {
      code: 'POLICY_VIOLATION' as const,
      message: `allow failed: ${why(e)}`,
      rule: 'allow',
    }
  }
  if (veto) return { ok: false, problems: [vetoProblem(veto)] }
  const d = diffAll(b.doc, restored)
  return finish(
    store,
    site,
    baseRevision,
    restored,
    key,
    text,
    {
      ...affected(d),
      pages: d.pages,
      notes: [],
    },
    b.readStamp,
  )
}
