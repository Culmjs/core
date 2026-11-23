import type {
  Code,
  Decl,
  FontRef,
  Language,
  Layout,
  Look,
  Node,
  Override,
  Placement,
  Problem,
  PropValue,
  Ref,
  Repeat,
  SiteDocument,
  SiteStyles,
  Slot,
  StateDecl,
  StyleLayer,
  Trigger,
} from '../document/index.ts'
import type { TreeAt } from '../document/required.ts'
import type { Registry } from '../registry/index.ts'

export type TreeRef = TreeAt
export type NodeRef = { tree: TreeRef; id: string }
export type Note = {
  kind: 'reset' | 'expanded' | 'info'
  ids: string[]
  text: string
}

/** A stage 1 node whose `id`, `slot` and `name` may be left out at every level. */
type NewNode = Omit<Node, 'id' | 'slot' | 'name' | 'children'> & {
  id?: string
  slot?: Slot
  name?: string
  children?: NewNode[]
}

type At = { tree: TreeRef; id: string }
type Nullable<T> = { [K in keyof T]?: T[K] | null }

export type Op =
  | { op: 'add'; tree: TreeRef; parent: string; index: number; node: NewNode }
  | ({ op: 'remove' } & At)
  | ({ op: 'move'; parent: string; index: number; slot?: Slot } & At)
  | ({
      op: 'setProps'
      props: Record<string, PropValue | null>
      name?: string
    } & At)
  | ({ op: 'setText'; text: string } & At)
  | ({
      op: 'setStyle'
      layer: StyleLayer | { when: { state: string; is: string } }
      decl: Nullable<Decl>
    } & At)
  | ({ op: 'setHidden'; layout: Layout; hidden: boolean } & At)
  | ({ op: 'setSlot'; slot?: Slot; placement?: Placement | null } & At)
  | ({ op: 'setRequired'; required: boolean | null } & At)
  | ({
      op: 'bindData'
      repeat?: Repeat | null
      bind?: Record<string, Ref> | null
      showIf?: Ref | null
      showIfAny?: Ref[] | null
    } & At)
  | ({
      op: 'setStates'
      state?: StateDecl[] | null
      on?: Trigger[] | null
    } & At)
  | {
      op: 'insertBlock'
      tree: TreeRef
      parent: string
      index: number
      block: string
      look: string
      settings?: Record<string, PropValue>
      id?: string
    }
  | ({ op: 'setBlockSetting'; key: string; value: PropValue } & At)
  | ({ op: 'updateBlock' } & At)
  | ({ op: 'makeComponent'; component: string; name: string } & At)
  | ({
      op: 'setInstance'
      set?: Record<string, PropValue | null>
      overrides?: Record<string, Override | null>
    } & At)
  | ({ op: 'detach' } & At)
  | { op: 'removeComponent'; component: string }
  | {
      op: 'addPage'
      title: string
      slug: string
      page?: string
      index?: number
      on?: boolean
      inMenu?: boolean
      inFooter?: boolean
      icon?: string
    }
  | { op: 'removePage'; page: string }
  | {
      op: 'setPage'
      page: string
      title?: string
      slug?: string
      on?: boolean
      inMenu?: boolean
      inFooter?: boolean
      icon?: string
    }
  | { op: 'movePage'; page: string; index: number }
  | {
      op: 'setSite'
      name?: string
      languages?: Language[]
      centreMaxWidth?: boolean
    }
  | { op: 'setLook'; look: Look }
  | { op: 'setSiteStyles'; styles: Nullable<SiteStyles> }
  | { op: 'setFonts'; fonts: FontRef[] }

export type ChangeRequest = {
  site: string
  baseRevision: number
  key: string
  ops: Op[]
}
/**
 * What a batch did, as the diff between the document before and after reports it (`diffSites`): `created` is every id the diff
 * lists as added; `changed` every id it lists as changed or moved, minus the created ones, each once. A removed node is in neither
 * list (the diff's `removed` has it), a parent whose children changed is not changed, and a page's own settings are in `pages`.
 * `pages` is the affected pages.
 */
export type PlanResult =
  | {
      ok: true
      doc: SiteDocument
      created: NodeRef[]
      changed: NodeRef[]
      pages: string[]
      notes: Note[]
    }
  | { ok: false; problems: Problem[] }
/** `created`, `changed` and `pages` are `PlanResult`'s; for a `restore` they are the diff between the head and the restored document. */
export type ApplyResult =
  | {
      ok: true
      revision: number
      created: NodeRef[]
      changed: NodeRef[]
      pages: string[]
      notes: Note[]
    }
  | { ok: false; problems: Problem[] }
export type Allow = (
  op: Op | { op: 'restore'; to: number },
  doc: SiteDocument,
) => Problem | undefined
export type SiteStore = {
  head(
    site: string,
  ): Promise<{ revision: number; doc: SiteDocument } | { problems: Problem[] }>
  /** The document at a revision, or `undefined`, and never a throw, for any revision the store does not hold (negative, above the head, or dropped). */
  get(site: string, revision: number): Promise<SiteDocument | undefined>
  replay(
    site: string,
    key: string,
  ): Promise<{ request: string; result: ApplyResult } | undefined>
  commit(
    site: string,
    c: {
      expected: number
      doc: SiteDocument
      key: string
      request: string
      result: ApplyResult
    },
  ): Promise<
    | { ok: true; revision: number; result: ApplyResult }
    | {
        ok: false
        code: 'REVISION_CONFLICT' | 'KEY_CONFLICT' | 'SOURCE_CONFLICT'
        problems?: Problem[]
      }
  >
}

// Internal to the layer.
export type Head = { doc: SiteDocument; revision: number }
export type OpResult =
  | {
      ok: true
      doc: SiteDocument
      created: NodeRef[]
      changed: NodeRef[]
      notes?: Note[]
    }
  | { ok: false; problems: Problem[] }
export type OpFn<K extends Op['op']> = (
  doc: SiteDocument,
  registry: Registry,
  op: Extract<Op, { op: K }>,
) => OpResult

export const refuse = (
  code: Code,
  message: string,
  more: Partial<Problem> = {},
): { ok: false; problems: Problem[] } => ({
  ok: false,
  problems: [{ code, message, ...more }],
})

/** Text for any thrown value; cannot throw. A value with no message (`{}`, `undefined`, `null`) is "unknown error". */
export function why(e: unknown): string {
  try {
    const m =
      typeof e === 'object' && e !== null
        ? (e as { message?: unknown }).message
        : e
    return (
      (m === undefined || m === null ? '' : String(m)).slice(0, 300) ||
      'unknown error'
    )
  } catch {
    return 'unknown error'
  }
}
