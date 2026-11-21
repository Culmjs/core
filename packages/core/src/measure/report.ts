import type { Layout, Node, SiteDocument } from '../document/index.ts'
import { shownOn } from '../layout/placement.ts'
import { WIDTH_OF } from './checks.ts'
import { unrolledTrees } from './unrolled.ts'
import type { Cell, Finding, FindingStatus, Profile, Report } from './types.ts'

export const MEASURE_PROFILE = 1

type PerPage = {
  page: string
  findings: Finding[]
  measured: Cell[]
  incomplete: Report['incomplete']
  blocked: string[]
  skipped: string[]
}

export function buildReport(
  revision: number,
  identity: string,
  profile: Profile & { browser: string },
  perPage: PerPage[],
): Report {
  return {
    revision,
    build: identity,
    profile: profile.version,
    browser: profile.browser,
    findings: perPage.flatMap(p => p.findings),
    measured: perPage.flatMap(p => p.measured),
    incomplete: perPage.flatMap(p => p.incomplete),
    blocked: [...new Set(perPage.flatMap(p => p.blocked))],
    skipped: [...new Set(perPage.flatMap(p => p.skipped))],
  }
}

const same = (a: Partial<Cell>, b: Cell) =>
  (['page', 'width', 'theme', 'dir'] as const).every(
    k => a[k] === undefined || a[k] === b[k],
  )

/** Hidden at a layout: by `hide` (tablet follows desktop) or by the style's `hidden`, which cascades base, tablet, phone. */
const hiddenAt = (n: Node, layout: Layout) => {
  if (!shownOn(n, layout)) return true
  const s = n.style
  const base = s?.base?.hidden
  if (layout === 'desktop') return !!base
  const tablet = s?.tablet?.hidden ?? base
  return !!(layout === 'tablet' ? tablet : (s?.phone?.hidden ?? tablet))
}

/** Each node of the page, header and footer (after instances are unrolled) not hidden at `layout`, itself or through an ancestor. */
function observable(doc: SiteDocument, page: string, layout: Layout) {
  const seen = new Set<string>()
  const go = (n: Node, hidden: boolean) => {
    const h = hidden || hiddenAt(n, layout)
    if (!h) seen.add(n.id)
    for (const k of n.children ?? []) go(k, h)
  }
  for (const r of unrolledTrees(doc, page)) go(r, false)
  return seen
}

const layoutOf = (width: number): Layout =>
  (Object.keys(WIDTH_OF) as Layout[]).find(l => WIDTH_OF[l] === width) ??
  'desktop'

/**
 * Each earlier finding gets the first status that applies: unchecked (its cell is absent or incomplete in `after`),
 * unobservable (every node of it is gone or hidden at its width), present (same key in `after`), fixed.
 */
export function compareReports(
  before: Report,
  after: Report,
  afterDoc: SiteDocument,
): { was: { finding: Finding; status: FindingStatus }[]; added: Finding[] } {
  const keys = new Set(after.findings.map(f => f.key))
  const shown = new Map<string, Set<string>>()
  const status = (f: Finding): FindingStatus => {
    if (
      !after.measured.some(m => same(f, m)) ||
      after.incomplete.some(i => same(i, f))
    )
      return 'unchecked'
    const k = `${f.page}|${layoutOf(f.width)}`
    if (!shown.has(k))
      shown.set(k, observable(afterDoc, f.page, layoutOf(f.width)))
    if (f.nodes.length > 0 && !f.nodes.some(id => shown.get(k)!.has(id)))
      return 'unobservable'
    return keys.has(f.key) ? 'present' : 'fixed'
  }
  const old = new Set(before.findings.map(f => f.key))
  return {
    was: before.findings.map(finding => ({ finding, status: status(finding) })),
    added: after.findings.filter(f => !old.has(f.key)),
  }
}
