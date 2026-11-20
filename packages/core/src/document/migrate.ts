import type { Problem } from './problems.ts'
import { hiddenAt, hiddenIndex, trees, walkWithAncestors } from './required.ts'
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
 * 1 to 2: a form or field that version 1 hides gets `required: false`, so the document stays valid under the `required` rule.
 * A malformed part is skipped, and validation reports it. This layer cannot call the unroll validation judges on, so it keeps
 * its own, simpler notion of hidden (`hiddenAt`: in its own tree, through a use, an override or a look in use). Where that
 * notion is wider than the unrolled tree it only exempts a form or field that was visible, which loosens. It does not follow a
 * toggle property: a form hidden only through one stays required, and validation of the migrated document names it.
 */
const toVersion2: MigrationStep = {
  from: 1,
  migrate(input) {
    const doc = input as SiteDocument
    const ix = hiddenIndex(doc)
    for (const [tree, root] of trees(doc))
      walkWithAncestors(root, (n, up) => {
        if (
          (n.kind === 'form' || n.kind === 'field') &&
          hiddenAt(ix, tree, [...up, n])
        )
          n.required = false
      })
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
