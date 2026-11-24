import {
  kindSpec,
  type Code,
  type Component,
  type KindSpec,
  type Motion,
  type Node,
  type Problem,
  type SiteStyles,
  type StateDecl,
} from '../document/index.ts'
import { isObj } from '../document/rules.ts'
import { type FieldType, type Registry } from '../registry/index.ts'

export type Obj = Record<string, unknown>
export const isStr = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length <= max

// The allowed field lists are typed against the document types, so a field added there fails to compile until it is listed here.
export { fieldsOf, isInt, isNum, oneOf } from '../document/rules.ts'

export type Schema = Record<string, FieldType>
export type Refs = (r: unknown) => 'ok' | 'shape' | 'unknown'
export type Bad = { message: string; code?: Code; path?: string }
export const bad = (message: string, code?: Code, path?: string): Bad => ({
  message,
  code,
  path,
})
export type Which = 'page' | 'header' | 'footer' | 'component'
export type Entry = {
  w: Node
  parent: Entry | null
  depth: number
  items: readonly Schema[]
  /** The id of the block root this node sits in, for dotted ids. */
  ns?: unknown
}
export type Tree = {
  which: Which
  root: Node
  entries: Entry[]
  comp?: Component
}
export type Ctx = {
  reg: Registry
  effects: Map<Node, Motion>
  kinds: ReadonlyMap<string, KindSpec>
  styles: SiteStyles
  fonts: ReadonlySet<string>
  out: Problem[]
  header?: Tree
  footer?: Tree
  pages: Tree[]
  /** The components whose trees could be read, by id. */
  comps: Map<string, Component>
  compTrees: Map<string, Tree>
  /** The components that use themselves, or use one that does. */
  cyclic: Set<string>
  layerMemo: Map<string, string | null>
  /** Each component's states through its nested masters, computed once. */
  /** Each component's parts by id, computed once. */
  partMemo: Map<string, Map<string, Node>>
  stateMemo: Map<string, { list: StateDecl[]; names: ReadonlySet<string> }>
}

/** What the checks of a single value need: the kinds, the site styles and the fonts. */
export type Checks = Pick<Ctx, 'kinds' | 'styles' | 'fonts'>

export const only = (o: Obj, keys: readonly string[]) =>
  Object.keys(o).every(k => keys.includes(k))
export const idOf = (w: unknown) =>
  isObj(w) && typeof w.id === 'string' ? w.id.slice(0, 40) : undefined

export const specOf = (c: Checks, kind: unknown): KindSpec | undefined =>
  typeof kind === 'string' ? kindSpec(kind, c.kinds) : undefined

/** A tree with what its nodes are checked against. */
export type TCtx = Tree & {
  /** What a command may point at: this tree, and for the site's own trees the header and footer too. */
  targets: Map<string, Node>
  /** The ids of the buttons that close a layer: an open bar needs one. */
  closers: Set<unknown>
  /** This tree's own nodes by id: a native open or close needs its layer here. */
  here: Map<string, Node>
}

export const add = (
  c: Ctx,
  w: Node,
  message: string,
  path?: string,
  code: Code = 'INVALID_NODE',
) =>
  void c.out.push({
    code,
    message,
    nodeId: idOf(w),
    ...(path === undefined ? {} : { path }),
  })
