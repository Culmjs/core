import type { Problem } from './problems.ts'
import { reasonOf, trees, walkWithAncestors } from './required.ts'
import type { SiteDocument } from './types.ts'

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

/**
 * 1 to 2: version 2 refuses a hidden required node, and a form or field is required by its kind, so the step gives
 * `required: false` to every form and field it cannot show to be visible: one hidden in its own tree (`hide` on a layout or
 * `hidden: true` in any style layer, on it or an ancestor), one anywhere in a component's master, and one under an instance
 * (slot content). This layer cannot call the unroll, so it does not guess what a use, a property or a look does: it exempts
 * every form inside a component, which only loosens (version 1 had no such protection). Any other form or field sits on a
 * page, the header or the footer with only its own tree above it, so it is visible after the step. A malformed part is
 * skipped, and validation reports it.
 */
const toVersion2: MigrationStep = {
  from: 1,
  migrate(input) {
    const doc = input as SiteDocument
    for (const [tree, root] of trees(doc)) {
      const master = typeof tree === 'object' && 'component' in tree
      walkWithAncestors(root, (n, up) => {
        if (
          (n.kind === 'form' || n.kind === 'field') &&
          (master ||
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
