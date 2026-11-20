import type { Problem, SiteDocument } from '../document/index.ts'
import type { ApplyResult, SiteStore } from './types.ts'

type Rev = { doc: SiteDocument; key?: string }
type Site = {
  revs: Rev[]
  keys: Map<string, { request: string; result: ApplyResult; revision: number }>
}

const copy = <T>(x: T): T => structuredClone(x)

/**
 * A store in memory: every revision is kept with its key, request string and result, so every key is remembered.
 * `commit` has no `await` between its checks and its write, so it is atomic. It stores and returns deep copies.
 * `initial` maps a site name to its document at revision 0.
 */
export function memoryStore(
  initial: Record<string, SiteDocument> = {},
): SiteStore {
  const sites = new Map<string, Site>()
  for (const [name, doc] of Object.entries(initial))
    sites.set(name, { revs: [{ doc: copy(doc) }], keys: new Map() })
  return {
    async head(site) {
      const s = sites.get(site)
      if (!s) {
        const problems: Problem[] = [
          { code: 'INVALID_DOCUMENT', message: `No site "${site}".` },
        ]
        return { problems }
      }
      const revision = s.revs.length - 1
      return { revision, doc: copy(s.revs[revision].doc) }
    },
    async get(site, revision) {
      const r = sites.get(site)?.revs[revision]
      return r && copy(r.doc)
    },
    async replay(site, key) {
      const k = sites.get(site)?.keys.get(key)
      return k && copy({ request: k.request, result: k.result })
    },
    async commit(site, c) {
      const s = sites.get(site)
      if (!s) return { ok: false, code: 'REVISION_CONFLICT' }
      const seen = s.keys.get(c.key)
      if (seen)
        return seen.request === c.request
          ? { ok: true, revision: seen.revision, result: copy(seen.result) }
          : { ok: false, code: 'KEY_CONFLICT' }
      if (c.expected !== s.revs.length - 1)
        return { ok: false, code: 'REVISION_CONFLICT' }
      const revision = c.expected + 1
      s.revs.push({ doc: copy(c.doc), key: c.key })
      s.keys.set(c.key, {
        request: c.request,
        result: copy(c.result),
        revision,
      })
      return { ok: true, revision, result: copy(c.result) }
    },
  }
}
