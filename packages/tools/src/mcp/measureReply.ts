import type { Finding, Report, compareReports } from '@culmjs/core/measure'

export type CompactFinding = {
  page: string
  check: string
  nodes: string[]
  at: string[]
  message: string
  fix?: string
  file?: string
  line?: number
  new?: true
}

type Located = Finding & { file?: string; line?: number }
const cell = (f: Finding) =>
  `${f.width}${f.theme === 'dark' ? ' dark' : ''}${f.dir === 'rtl' ? ' rtl' : ''}`

/** One row per page, check and set of nodes; `at` lists the cells in the order they were found, the message is the first cell's. Findings that differ only in message stay separate rows. */
export function compactFindings(findings: Finding[]): CompactFinding[] {
  const groups = new Map<string, CompactFinding[]>()
  const out: CompactFinding[] = []
  for (const f of findings as Located[]) {
    const nodes = [...f.nodes].sort()
    const key = JSON.stringify([f.page, f.check, nodes])
    const rows = groups.get(key) ?? []
    groups.set(key, rows)
    const at = cell(f)
    // merge across cells only; a second finding in a cell the row has is the same one (same message) or a row of its own
    const row = rows.find(r => !r.at.includes(at))
    if (row) {
      row.at.push(at)
      continue
    }
    if (rows.some(r => r.at.includes(at) && r.message === f.message)) continue
    const made: CompactFinding = {
      page: f.page,
      check: f.check,
      nodes,
      at: [at],
      message: f.message,
      ...(f.fix !== undefined ? { fix: f.fix } : {}),
      ...(f.file !== undefined ? { file: f.file } : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
    }
    rows.push(made)
    out.push(made)
  }
  return out
}

/**
 * What the agent reads of a measure: the compact findings and what was not measured. With a comparison, `findings` holds the
 * still-failing and the new (`new: true`), `fixed` those no longer present, and `unchecked` counts the ones that could not be compared.
 */
export function measureReply(
  r: Report,
  comparison?: ReturnType<typeof compareReports>,
): Record<string, unknown> {
  const base = {
    revision: r.revision,
    measured: r.measured.length,
    incomplete: r.incomplete,
    blocked: r.blocked,
    skipped: r.skipped,
  }
  if (!comparison) return { ...base, findings: compactFindings(r.findings) }
  const fresh = new Set(comparison.added.map(f => f.key))
  return {
    ...base,
    findings: [
      ...compactFindings(r.findings.filter(f => !fresh.has(f.key))),
      ...compactFindings(comparison.added).map(f => ({
        ...f,
        new: true as const,
      })),
    ],
    fixed: compactFindings(
      comparison.was.filter(w => w.status === 'fixed').map(w => w.finding),
    ),
    unchecked: comparison.was.filter(
      w => w.status === 'unchecked' || w.status === 'unobservable',
    ).length,
  }
}
