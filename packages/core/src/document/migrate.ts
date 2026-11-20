import type { Problem } from './problems.ts'
import { reasonOf, trees, walkWithAncestors } from './required.ts'
import { DEPTH_GUARD, MAX_NODES } from './kinds.ts'
import { isObj } from './rules.ts'
import type { Node, SiteDocument } from './types.ts'

export const SCHEMA_VERSION = 2

/** Thrown by a migration step that cannot convert the node at `path`. */
export class MigrationError extends Error {
  constructor(
    public path: string,
    message: string,
  ) {
    super(message)
  }
}

/** Returns the document at version `from + 1`. */
export type MigrationStep = { from: number; migrate(doc: unknown): unknown }

export type MigrationResult =
  | { ok: true; doc: SiteDocument; from: number }
  | { ok: false; problem: Problem }

/** A tree's size and depth as the unroll would expand it, counted without unrolling: an instance counts as itself plus its component, nested uses included. A missing component or a cycle counts nothing; a repeat's rows are data and do not count. */
function expanded(
  doc: SiteDocument,
  root: Node,
): { size: number; depth: number } {
  const byId = new Map(
    (Array.isArray(doc.components) ? doc.components : [])
      .filter(c => isObj(c) && typeof c.id === 'string')
      .map(c => [c.id, c]),
  )
  const memo = new Map<string, { size: number; depth: number }>()
  const go = (
    n: Node,
    stack: readonly string[],
  ): { size: number; depth: number } => {
    let size = 1
    let depth = 0
    const add = (k: { size: number; depth: number }) => {
      size += k.size
      depth = Math.max(depth, k.depth)
    }
    if (n.kind === 'instance' && typeof n.component === 'string') {
      const c = byId.get(n.component)
      if (c && isObj(c.root) && !stack.includes(c.id)) {
        if (!memo.has(c.id)) memo.set(c.id, go(c.root, [...stack, c.id]))
        add(memo.get(c.id)!)
      }
    }
    for (const k of Array.isArray(n.children) ? n.children : [])
      if (isObj(k)) add(go(k as Node, stack))
    return { size, depth: depth + 1 }
  }
  return go(root, [])
}

/**
 * 1 to 2: version 2 refuses a hidden required node, and a form or field is required by its kind, so the step gives
 * `required: false` to every form and field it cannot show to be visible: one hidden in its own tree (`hide` on a layout or
 * `hidden: true` in any style layer, on it or an ancestor), one anywhere in a component's master, and one under an instance
 * (slot content). This layer cannot call the unroll, so it does not guess what a use, a property or a look does: it exempts
 * every form inside a component, which only loosens (version 1 had no such protection). It also exempts every form and field
 * of a page, the header or the footer whose expanded size reaches `MAX_NODES` or whose expanded depth reaches `DEPTH_GUARD`,
 * because version 2 refuses a cut tree that holds required content; that, too, over-exempts by design. Any other form or
 * field sits on a page, the header or the footer with only its own tree above it, uncut, so it is visible after the step. A
 * malformed part is skipped, and validation reports it.
 */
const toVersion2: MigrationStep = {
  from: 1,
  migrate(input) {
    const doc = input as SiteDocument
    for (const [tree, root] of trees(doc)) {
      const master = typeof tree === 'object' && 'component' in tree
      const size = master ? undefined : expanded(doc, root)
      const cut =
        !!size && (size.size >= MAX_NODES || size.depth >= DEPTH_GUARD)
      walkWithAncestors(root, (n, up) => {
        if (
          (n.kind === 'form' || n.kind === 'field') &&
          (master ||
            cut ||
            up.some(a => a.kind === 'instance') ||
            [...up, n].some(a => reasonOf(a)))
        )
          n.required = false
      })
    }
    doc.schemaVersion = 2
    return doc
  },
}

const STEPS: readonly MigrationStep[] = [toVersion2]

const refuse = (message: string, path?: string): MigrationResult => ({
  ok: false,
  problem: {
    code: 'INVALID_DOCUMENT',
    message,
    ...(path === undefined ? {} : { path }),
  },
})

const message = (e: unknown) => {
  try {
    return e instanceof Error ? e.message : String(e)
  } catch {
    return 'unknown error'
  }
}

/** Brings a document to `target`. Pure: works on a clone, never throws for bad input. */
export function migrate(
  doc: unknown,
  steps: readonly MigrationStep[] = STEPS,
  target: number = SCHEMA_VERSION,
): MigrationResult {
  try {
    return run(doc, steps, target)
  } catch (e) {
    // a getter or proxy on the document can throw even before a step runs
    return refuse(`The document cannot be read: ${message(e)}`)
  }
}

function run(
  doc: unknown,
  steps: readonly MigrationStep[],
  target: number,
): MigrationResult {
  const version = (doc as { schemaVersion?: unknown } | null)?.schemaVersion
  if (
    typeof doc !== 'object' ||
    doc === null ||
    !Number.isInteger(version) ||
    (version as number) < 1
  ) {
    return refuse('The document has no valid schemaVersion')
  }
  const from = version as number
  if (from > target) {
    return refuse(
      `The document is from a newer schema version (${from}) than this one (${target})`,
    )
  }
  let current: unknown
  try {
    current = structuredClone(doc)
  } catch (e) {
    return refuse(`The document cannot be copied: ${message(e)}`)
  }
  for (let at = from; at < target; at++) {
    const step = steps.find(s => s.from === at)
    if (!step) return refuse(`No migration from schema version ${at}`)
    try {
      current = step.migrate(current)
      const got = (current as { schemaVersion?: unknown } | null)?.schemaVersion
      if (typeof current !== 'object' || current === null || got !== at + 1) {
        return refuse(
          `Migration from version ${at} did not return a version ${at + 1} document`,
        )
      }
    } catch (e) {
      return e instanceof MigrationError
        ? refuse(e.message, e.path)
        : refuse(`Migration from version ${at} failed: ${message(e)}`, '')
    }
  }
  return { ok: true, doc: current as SiteDocument, from }
}

export const previewMigration: typeof migrate = migrate
