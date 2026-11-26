import {
  KINDS,
  MAX_DEPTH,
  MAX_NODES,
  type Code,
  type Component,
  type Kind,
  type Node,
  type Problem,
  type PropField,
  type SiteDocument,
  type SiteStyles,
} from '../document/index.ts'
import { EMBEDS, embedIdOk } from '../document/embed.ts'
import { ID_RE, SHAPE_LIMITS } from '../document/kinds.ts'
import { expandMarks, MAX_MARKS } from '../document/scene.ts'
import { templateIndex, walk } from '../document/tree.ts'
import { unrollInstances } from './unroll.ts'
import {
  isObj,
  DETAILS_NAME,
  SLUG_RE,
  hasControl,
  urlOk,
} from '../document/rules.ts'
import { PLACEMENT_MODES, effectivePlacement } from '../layout/placement.ts'
import { effectiveFreeBoxes } from '../layout/phone.ts'
import { type Registry } from '../registry/index.ts'
import { checkSiteStyles } from '../style/index.ts'
import { checkColor, checkSize, checkStyle, declsOf } from '../style/decl.ts'
import { stylesOf } from '../style/siteStyles.ts'
import {
  add,
  addComposed,
  bad,
  fieldsOf,
  idOf,
  isInt,
  isNum,
  isStr,
  oneOf,
  only,
  specOf,
  type Bad,
  type Checks,
  type Ctx,
  type Entry,
  type Obj,
  type Refs,
  type TCtx,
  type Tree,
  type Which,
} from './common.ts'
import { checkStates, checkTabs, stateIn } from './states.ts'
import { checkComposedMotions, checkMotion } from './motion.ts'
import { checkData, refsFor, rowOf } from './data.ts'
import {
  componentBad,
  cyclicComponents,
  instanceBad,
  slotPart,
} from './components.ts'

export const NODE_KEYS = fieldsOf<Node>({
  id: true,
  kind: true,
  name: true,
  slot: true,
  props: true,
  style: true,
  children: true,
  repeat: true,
  bind: true,
  showIf: true,
  showIfAny: true,
  hide: true,
  locked: true,
  origin: true,
  placement: true,
  component: true,
  set: true,
  overrides: true,
  state: true,
  on: true,
  motion: true,
  // only lets the key through; Task 6 checks its value and the rules
  required: true,
})

export const EMAIL_RE = /^[^\s?&#<>"']+@[^\s?&#<>"']+$/
export const emailOk = (v: string) => !hasControl(v) && EMAIL_RE.test(v)

export const MATH_TAGS = new Set(
  'math semantics annotation mrow mi mn mo ms mtext mspace msup msub msubsup mfrac msqrt mroot mover munder munderover mtable mtr mtd mstyle mpadded mphantom menclose mmultiscripts mprescripts none'.split(
    ' ',
  ),
)
export const MATH_ATTRS = new Set(
  'display mathvariant stretchy fence separator lspace rspace accent accentunder columnalign rowspacing columnspacing displaystyle scriptlevel width height depth linethickness encoding class xmlns notation minsize maxsize largeop form movablelimits'.split(
    ' ',
  ),
)
export const MATH_TAG =
  /^<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z]+=(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>/
/** MathML from temml: every `<` opens an allow-listed element with allow-listed, quoted attributes, so no script, handler, link or style gets through. */
export function mathOk(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 20_000) return false
  for (let i = v.indexOf('<'); i >= 0; i = v.indexOf('<', i + 1)) {
    const m = MATH_TAG.exec(v.slice(i, i + 2000))
    if (!m || !MATH_TAGS.has(m[2])) return false
    if (m[1] && m[3]) return false
    for (const a of m[3].matchAll(/\s([A-Za-z]+)=/g))
      if (!MATH_ATTRS.has(a[1])) return false
  }
  return true
}

export const RUN_KEYS = [
  'text',
  'bind',
  'link',
  'bindHref',
  'style',
  'math',
  'dark',
]
export const RUN_STYLE = [
  'weight',
  'italic',
  'underline',
  'upper',
  'color',
  'size',
  'font',
  'letterSpacing',
  'bg',
  'radius',
  'strike',
  'baseline',
  'smallCaps',
  'underlineColor',
  'underlineOffset',
  'nowrap',
]
export const TILES = [
  'dots',
  'grid',
  'lines',
  'diagonal',
  'cross',
  'rings',
  'checks',
  'waves',
  'hexagons',
  'triangles',
  'zigzag',
  'scales',
  'topography',
  'circuit',
  'molecules',
  'cubes',
  'sparkles',
]
export const CODE_RUNS = 4000
export const CODE_CHARS = 100_000
export const isHex6 = (v: unknown) =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Walks one tree without recursing, stopping at the node and depth limits; null if the tree is not made of nodes. */
export function collect(
  c: Ctx,
  root: unknown,
  which: Which,
  comp?: Component,
): Tree | null {
  const say = (code: Code, message: string, nodeId?: string, path?: string) =>
    void c.out.push({
      code,
      message,
      ...(nodeId === undefined ? {} : { nodeId }),
      ...(path === undefined ? {} : { path }),
    })
  if (!isObj(root)) {
    say('INVALID_NODE', 'The tree is not made of nodes.')
    return null
  }
  const entries: Entry[] = []
  const stack: Entry[] = [
    { w: root as unknown as Node, parent: null, depth: 1, items: [] },
  ]
  while (stack.length) {
    const e = stack.pop()!
    if (e.depth > MAX_DEPTH) {
      say(
        'RESOURCE_LIMIT_EXCEEDED',
        `This layout is nested more than ${MAX_DEPTH} deep.`,
        idOf(e.w),
      )
      return null
    }
    entries.push(e)
    const ch = (e.w as { children?: unknown }).children
    if (ch === undefined) continue
    if (!Array.isArray(ch)) {
      say('INVALID_NODE', 'Its children must be a list.', idOf(e.w), 'children')
      return null
    }
    if (entries.length + stack.length + ch.length > MAX_NODES) {
      say(
        'RESOURCE_LIMIT_EXCEEDED',
        `A tree can hold ${MAX_NODES.toLocaleString('en')} nodes.`,
        idOf(root),
      )
      return null
    }
    // A repeating node's template sees the row it repeats over; in a table that is the last child, so the header rows keep the outer context.
    const row = isObj(e.w.repeat)
      ? rowOf(c, e.w.repeat, e.items, true)
      : undefined
    const at = templateIndex(e.w)
    for (let i = ch.length - 1; i >= 0; i--) {
      if (!isObj(ch[i])) {
        say(
          'INVALID_NODE',
          'A child is not a node.',
          idOf(e.w),
          `children.${i}`,
        )
        return null
      }
      stack.push({
        w: ch[i] as Node,
        parent: e,
        depth: e.depth + 1,
        items: row && i === at ? [row, ...e.items] : e.items,
      })
    }
  }
  return { which, root: root as unknown as Node, entries, comp }
}

export function checkTrees(
  doc: SiteDocument,
  reg: Registry,
  out: Problem[],
  gpuSettings: Ctx['gpuSettings'],
) {
  const look = doc.look
  let styles: SiteStyles
  try {
    styles = stylesOf({ styles: checkSiteStyles(doc.styles).styles, look })
  } catch {
    styles = {
      colors: [],
      text: [],
      space: { xs: 4, s: 8, m: 12, l: 20, xl: 32, '2xl': 48 },
      shadows: [],
    }
  }
  const c: Ctx = {
    reg,
    effects: new Map(),
    gpuSettings,
    kinds: reg.kinds(),
    styles,
    fonts: new Set(doc.fonts),
    out,
    pages: [],
    comps: new Map(),
    compTrees: new Map(),
    cyclic: new Set(),
    layerMemo: new Map(),
    stateMemo: new Map(),
    partMemo: new Map(),
  }
  const trees: Tree[] = []
  const take = (t: Tree | null) => void (t && trees.push(t))
  c.header = collect(c, doc.header, 'header') ?? undefined
  c.footer = collect(c, doc.footer, 'footer') ?? undefined
  take(c.header ?? null)
  take(c.footer ?? null)
  for (const p of doc.pages) {
    const t = collect(c, p.root, 'page')
    take(t)
    if (t) c.pages.push(t)
  }
  for (const comp of doc.components) {
    if (!isObj(comp)) continue
    const t = collect(c, comp.root, 'component', comp)
    take(t)
    if (t && typeof comp.id === 'string' && !c.comps.has(comp.id)) {
      c.comps.set(comp.id, comp)
      c.compTrees.set(comp.id, t)
    }
  }
  c.cyclic = cyclicComponents([...c.comps.values()])
  const seen = new Set<string>()
  for (const t of trees)
    checkTree(c, t, t.which === 'component' ? new Set() : seen)
  if (out.length) return
  // Only the private composition/render view contains expanded effects. Keep authored
  // entries for diagnostics and the original document for plug-in rules and callers.
  if (c.effects.size) {
    const project = (w: Node): Node => {
      const motion = c.effects.get(w)
      const children = w.children?.map(project)
      if (!motion && !children?.some((n, i) => n !== w.children![i])) return w
      return { ...w, ...(motion && { motion }), ...(children && { children }) }
    }
    const roots = new Map(trees.map(t => [t.root, project(t.root)]))
    for (const t of trees) t.root = roots.get(t.root)!
    doc = {
      ...doc,
      header: roots.get(doc.header)!,
      footer: roots.get(doc.footer)!,
      pages: doc.pages.map(p => ({ ...p, root: roots.get(p.root)! })),
      components: doc.components.map(comp => ({
        ...comp,
        root: roots.get(comp.root)!,
      })),
    }
    c.comps = new Map(doc.components.map(comp => [comp.id, comp]))
  }
  const components = [...c.comps.values()]
  const env = { fonts: doc.fonts, styles: c.styles, kinds: c.kinds }
  const compMemo = new Map<Tree, { tree: Node; over: boolean }>()
  const composed = (t: Tree) => {
    let hit = compMemo.get(t)
    if (!hit) {
      const budget = { n: 0, over: false }
      const root: Node = t.comp
        ? {
            kind: 'instance',
            component: t.comp.id,
            id: t.root.id,
            name: t.root.name,
            slot: {},
          }
        : t.root
      const tree = unrollInstances(root, components, env, budget)
      hit = { tree, over: budget.over }
      compMemo.set(t, hit)
    }
    return hit
  }
  checkComposedTrees(c, trees, composed)
  checkComposedMotions(c, trees, doc.fonts, doc.look.dark, composed)
  return doc
}

function checkComposedTrees(
  c: Ctx,
  trees: Tree[],
  composed: (t: Tree) => { tree: Node; over: boolean },
) {
  if (!trees.some(t => t.entries.some(e => e.w.kind === 'instance'))) return
  const hdr = c.header ? composed(c.header).tree : undefined
  const ftr = c.footer ? composed(c.footer).tree : undefined
  const hasDynamicComp = [...c.comps.values()].some(
    comp =>
      comp.variants.length > 0 ||
      comp.props.length > 0 ||
      (c.compTrees.get(comp.id)?.entries ?? []).some(({ w }) => {
        const pr = isObj(w.props) ? w.props : {}
        return (
          w.kind === 'free' ||
          w.kind === 'embed' ||
          (w.kind === 'shape' &&
            (pr.shadow !== undefined ||
              (isObj(pr.geometry) &&
                'type' in pr.geometry &&
                pr.geometry.type === 'group'))) ||
          (w.kind === 'text' && pr.textStyle !== undefined) ||
          (w.kind === 'details' && pr.name !== undefined) ||
          (w.kind === 'button' && pr.opens !== undefined) ||
          declsOf(w.style).some(d => d?.reveal || d?.side !== undefined)
        )
      }),
  )
  for (const t of trees) {
    if (!t.entries.some(e => e.w.kind === 'instance')) continue
    const hasOverrides = t.entries.some(
      ({ w }) =>
        w.kind === 'instance' &&
        (w.set !== undefined || w.overrides !== undefined),
    )
    if (!hasDynamicComp && !hasOverrides) continue
    const { tree, over } = composed(t)
    const authored = new Map(t.entries.map(e => [e.w.id, e.w]))
    if (over) continue
    const targets = new Map<string, Node>()
    for (const r of t.which === 'component'
      ? [tree]
      : [tree, hdr, ftr].filter((x): x is Node => !!x))
      walk(r, x => void targets.set(x.id, x))
    walk(tree, (w, parent) => {
      const say = (message: string, path?: string, code?: Code) =>
        addComposed(c, t, authored, tree, w, message, path, code)
      const pr = isObj(w.props) ? w.props : {}
      const gt = isObj(pr.geometry)
        ? (pr.geometry as { type?: unknown; combine?: unknown })
        : undefined
      if (
        w.kind === 'shape' &&
        gt?.type === 'group' &&
        gt.combine === 'subtract'
      )
        for (const cutter of (w.children ?? []).slice(1))
          if (cutter.motion !== undefined)
            addComposed(
              c,
              t,
              authored,
              tree,
              cutter,
              'A mask cutter part in a subtract shape cannot carry motion.',
              'motion',
            )
      if (w.kind === 'free')
        for (const l of ['desktop', 'tablet', 'phone'] as const)
          try {
            effectiveFreeBoxes(w, l)
          } catch {
            say(
              "There is no room for these blocks within the layout's 1,000 rows.",
            )
            break
          }
      if (
        w.kind === 'shape' &&
        typeof pr.shadow === 'string' &&
        !c.styles.shadows.some(x => x.id === pr.shadow)
      )
        say('Its shadow is not one this site has.', 'props.shadow')
      if (
        w.kind === 'text' &&
        pr.textStyle !== undefined &&
        !c.styles.text.some(x => x.id === pr.textStyle)
      )
        say('Its text style is not one this site has.', 'props.textStyle')
      if (
        w.kind === 'details' &&
        pr.name !== undefined &&
        !(typeof pr.name === 'string' && DETAILS_NAME.test(pr.name))
      )
        say(
          'Its name must be 1 to 32 lowercase letters, digits and dashes.',
          'props.name',
        )
      if (
        w.kind === 'embed' &&
        typeof pr.provider === 'string' &&
        Object.hasOwn(EMBEDS, pr.provider) &&
        typeof pr.id === 'string' &&
        !embedIdOk(pr.provider, pr.id)
      )
        say('Its id is not a valid id for that provider.', 'props.id')
      if (
        w.kind === 'button' &&
        typeof pr.opens === 'string' &&
        typeof pr.command === 'string'
      ) {
        const target = targets.get(pr.opens)
        const layer = isObj(target?.props) ? target.props.layer : undefined
        if (!target)
          say(
            'It points at a node that is not in this tree, the header or the footer.',
            'props.opens',
          )
        else if (
          pr.command === 'show-modal' || pr.command === 'close'
            ? layer !== 'dialog'
            : !(layer === 'popover-auto' || layer === 'popover-manual')
        )
          say(
            'It points at a node that cannot take that command.',
            'props.command',
          )
      }
      if (w.style !== undefined) {
        if (
          declsOf(w.style).some(d => d?.reveal) &&
          !(t.which === 'footer' && !parent)
        )
          say("Reveal belongs on the footer's top block only.", 'style')
        if (
          declsOf(w.style).some(d => d?.side !== undefined) &&
          !(t.which === 'header' && parent === tree)
        )
          say("Side belongs on the header's top blocks only.", 'style')
      }
    })
  }
}

export function checkTree(c: Ctx, t0: Tree, seen: Set<string>) {
  const before = c.out.length
  const targets = new Map<string, Node>()
  for (const x of t0.which === 'component' ? [t0] : [t0, c.header, c.footer])
    for (const e of x?.entries ?? []) targets.set(e.w.id, e.w)
  const closers = new Set<unknown>()
  for (const e of t0.entries) {
    const bp = isObj(e.w.props) ? e.w.props : {}
    if (
      e.w.kind === 'button' &&
      (bp.command === 'hide-popover' || bp.command === 'toggle-popover')
    )
      closers.add(bp.opens)
  }
  const here = new Map(t0.entries.map(e => [e.w.id, e.w]))
  const t: TCtx = { ...t0, targets, closers, here }
  for (const e of t.entries) checkId(c, e, seen)
  for (const e of t.entries) checkNode(c, t, e)
  checkTabs(c, t)
  if (t.comp)
    for (const b of componentBad(c, t))
      c.out.push({
        code: 'INVALID_NODE',
        message: b.message,
        nodeId: idOf(t.root),
        ...(b.path === undefined ? {} : { path: b.path }),
      })
  if (c.out.length === before)
    for (const e of t.entries)
      if (e.w.kind === 'free')
        for (const l of ['desktop', 'tablet', 'phone'] as const)
          try {
            effectiveFreeBoxes(e.w, l)
          } catch {
            c.out.push({
              code: 'INVALID_NODE',
              message:
                "There is no room for these blocks within the layout's 1,000 rows.",
              nodeId: idOf(e.w),
            })
            break
          }
}

export function checkId(c: Ctx, e: Entry, seen: Set<string>) {
  const { w } = e
  // A node with an origin starts a block: its descendants are named `<rootId>.<localId>`.
  const root =
    w.origin !== undefined && typeof w.id === 'string' && ID_RE.test(w.id)
  e.ns = root ? w.id : e.parent?.ns
  const id = w.id as unknown
  const ok = (() => {
    if (typeof id !== 'string') return false
    const [a, b, ...more] = id.split('.')
    return b === undefined
      ? ID_RE.test(a)
      : !more.length && a === e.ns && ID_RE.test(a) && ID_RE.test(b)
  })()
  if (!ok)
    add(
      c,
      w,
      `Its id "${idOf(w) ?? '?'}" must be 1 to 20 lowercase letters and digits.`,
      'id',
    )
  else if (seen.has(id as string))
    add(c, w, 'Its id is already used by another node.', 'id')
  else seen.add(id as string)
}

/** Where a node sits: what goes in an instance's slot sits in the slot part, so that part's kind decides what fits. */
export function placedIn(c: Ctx, e: Entry): Node | null {
  const p = e.parent?.w
  if (p?.kind !== 'instance') return p ?? null
  const comp = c.comps.get(p.component as string)
  return (comp && slotPart(c, comp)) || p
}
export const hideOk = (h: unknown) =>
  isObj(h) &&
  Object.keys(h).every(
    k => (k === 'phone' || k === 'tablet' || k === 'desktop') && h[k] === true,
  )
export const sizeOk = (v: unknown) =>
  checkSize(v) !== undefined &&
  (typeof v === 'string' || (isObj(v) && only(v, ['n', 'unit'])))

export function boxBad(b: unknown, cols: number): string | null {
  if (!isObj(b) || !only(b, ['x', 'y', 'w', 'h', 'z']))
    return 'has a position that is not a box.'
  if (!isInt(b.x, 0, cols - 1) || !isInt(b.w, 1, cols) || b.x + b.w > cols)
    return 'has a position outside the columns of its layout.'
  if (!isInt(b.y, 0, 999) || !isInt(b.h, 1, 200) || !isInt(b.z, -9999, 9999))
    return 'has a position with a row or layer that is out of range.'
  return null
}

export function slotBad(
  w: Node,
  parent: { kind: Kind; props?: unknown } | null,
): string | null {
  const s = w.slot as unknown
  if (!isObj(s)) return 'has no position.'
  if (!parent)
    return Object.keys(s).length
      ? 'is the top of the tree and cannot have a position.'
      : null
  const keys = Object.keys(s)
  switch (parent.kind) {
    case 'free': {
      const pc = isObj(parent.props) ? parent.props.cols : undefined
      const cols = isInt(pc, 1, 24) ? pc : 24
      if (
        keys.some(
          k => !['x', 'y', 'w', 'h', 'z', 'tablet', 'phone'].includes(k),
        )
      )
        return 'has a position that does not fit a free layout.'
      const { tablet, phone, ...desktop } = s
      return (
        boxBad(desktop, cols) ??
        (tablet === undefined ? null : boxBad(tablet, cols)) ??
        (phone === undefined ? null : boxBad(phone, cols))
      )
    }
    case 'row':
    case 'column':
      if (keys.some(k => !['grow', 'basis', 'align'].includes(k)))
        return 'has a position that does not fit a row or column.'
      if (s.grow !== undefined && !isNum(s.grow, 0, 12))
        return 'has a grow value outside 0 to 12.'
      if (s.basis !== undefined && !sizeOk(s.basis))
        return 'has a size that is not valid.'
      if (
        s.align !== undefined &&
        !oneOf(s.align, ['start', 'center', 'end', 'stretch'])
      )
        return 'has an alignment that is not valid.'
      return null
    case 'grid':
      if (keys.some(k => !['cols', 'rows'].includes(k)))
        return 'has a position that does not fit a grid.'
      if (
        (s.cols !== undefined && !isInt(s.cols, 1, 12)) ||
        (s.rows !== undefined && !isInt(s.rows, 1, 6))
      )
        return 'spans more of the grid than allowed.'
      return null
    case 'shape':
      return keys.length === 4 &&
        only(s, ['x', 'y', 'w', 'h']) &&
        isNum(s.x, -10000, 10000) &&
        isNum(s.y, -10000, 10000) &&
        isNum(s.w, 0, 10000) &&
        s.w > 0 &&
        isNum(s.h, 0, 10000) &&
        s.h > 0
        ? null
        : 'must sit in its group by x, y, w and h.'
    default:
      return keys.length
        ? 'has a position, but its parent places children by order.'
        : null
  }
}

export function linkBad(v: unknown): string | null {
  const shape =
    'has a link that is not a page, file, web address or email. A link is exactly one of { "page": "/about" }, { "url": "https://…" }, { "email": "name@example.org" } or { "file": "<file id>" }.'
  if (!isObj(v) || Object.keys(v).length !== 1) return shape
  if (Object.hasOwn(v, 'page'))
    return isStr(v.page) && SLUG_RE.test(v.page)
      ? null
      : 'links to a page address that is not valid.'
  if (Object.hasOwn(v, 'file'))
    return isStr(v.file) && v.file ? null : 'links to a file that is not named.'
  if (Object.hasOwn(v, 'url'))
    return isStr(v.url, 2000) && urlOk(v.url)
      ? null
      : 'has a web address that is not allowed.'
  if (Object.hasOwn(v, 'email'))
    return isStr(v.email) && emailOk(v.email)
      ? null
      : 'has an email address that is not valid.'
  return shape
}

/** The problems with a style, each with the path of its field. */
export function styleBad(
  c: Checks,
  kind: Kind,
  style: unknown,
): { message: string; path: string }[] {
  const r = checkStyle(kind, style, c.styles, c.kinds)
  const out = r.problems.map(p => ({
    message: `Its ${p}.`,
    path: /^style(?:\.[A-Za-z0-9_]+|\[\d+\])*/.exec(p)?.[0] ?? 'style',
  }))
  for (const d of declsOf(r.style)) {
    const f = d.font as unknown
    if (typeof f === 'string' && !f.startsWith('sys:') && !c.fonts.has(f))
      out.push({
        message: 'Its style uses a font the site does not have.',
        path: 'style',
      })
  }
  return out
}

/** Path data: commands, numbers and separators only, so nothing typed can close the element or add an attribute. */
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/
const pair = (v: unknown, lo: number, hi: number): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every(x => isNum(x, lo, hi))
/** A size in drawing units (1 to 10,000 each way). */
const viewOk = (v: unknown) => v === undefined || pair(v, 1, 10000)

/** The problem with a shape's geometry, or null. Each geometry names its own keys; any other is refused. */
export function geometryBad(v: unknown): string | null {
  if (!isObj(v) || typeof v.type !== 'string')
    return 'is not a geometry with a type.'
  const keys = (...k: string[]) => only(v, ['type', ...k])
  const ok = (good: boolean) => (good ? null : 'is not valid for its type.')
  switch (v.type) {
    case 'rect':
      return ok(
        keys('radius', 'view') &&
          viewOk(v.view) &&
          (v.radius === undefined ||
            isNum(v.radius, 0, 9999) ||
            (Array.isArray(v.radius) &&
              v.radius.length === 4 &&
              v.radius.every(x => isNum(x, 0, 9999)))),
      )
    case 'ellipse':
      return ok(keys('view') && viewOk(v.view))
    case 'polygon':
      return ok(
        keys('sides', 'rotate') &&
          isInt(v.sides, 3, 12) &&
          (v.rotate === undefined || isNum(v.rotate, -360, 360)),
      )
    case 'star':
      return ok(
        keys('points', 'inner', 'rotate') &&
          isInt(v.points, 3, 24) &&
          isNum(v.inner, 0.1, 0.95) &&
          (v.rotate === undefined || isNum(v.rotate, -360, 360)),
      )
    case 'line':
      return ok(
        keys('from', 'to', 'view') &&
          pair(v.from, 0, 100) &&
          pair(v.to, 0, 100) &&
          viewOk(v.view),
      )
    case 'blob':
      return ok(
        keys('seed', 'smooth', 'points') &&
          isInt(v.seed, 0, 2147483647) &&
          (v.smooth === undefined || isNum(v.smooth, 0, 1)) &&
          (v.points === undefined || isInt(v.points, 3, 12)),
      )
    case 'path':
      return ok(
        keys('d', 'view') &&
          typeof v.d === 'string' &&
          v.d.length <= SHAPE_LIMITS.path &&
          PATH_RE.test(v.d) &&
          viewOk(v.view),
      )
    case 'group':
      return ok(
        keys('view', 'combine') &&
          viewOk(v.view) &&
          (v.combine === undefined ||
            oneOf(v.combine, ['layer', 'union', 'subtract'])),
      )
    case 'scene':
      return ok(keys('view') && viewOk(v.view))
    case 'curve':
      return ok(
        keys('points', 'closed', 'tension', 'view') &&
          Array.isArray(v.points) &&
          v.points.length >= 2 &&
          v.points.length <= 128 &&
          v.points.every(p => pair(p, -10000, 10000)) &&
          (v.closed === undefined || typeof v.closed === 'boolean') &&
          (v.tension === undefined || isNum(v.tension, 0, 1)) &&
          viewOk(v.view),
      )
    case 'arc':
      return ok(
        keys('cx', 'cy', 'r', 'inner', 'start', 'end', 'view') &&
          isNum(v.start, -720, 720) &&
          isNum(v.end, -720, 720) &&
          (v.cx === undefined || isNum(v.cx, -10000, 10000)) &&
          (v.cy === undefined || isNum(v.cy, -10000, 10000)) &&
          (v.r === undefined || isNum(v.r, 0.5, 10000)) &&
          (v.inner === undefined || isNum(v.inner, 0, 10000)) &&
          viewOk(v.view),
      )
    case 'wave':
      return ok(
        keys('y', 'amp', 'freq', 'phase', 'closeBottom', 'view') &&
          (v.y === undefined || isNum(v.y, -10000, 10000)) &&
          isNum(v.amp, 0, 5000) &&
          isNum(v.freq, 0.1, 64) &&
          (v.phase === undefined || isNum(v.phase, -100, 100)) &&
          (v.closeBottom === undefined || typeof v.closeBottom === 'boolean') &&
          viewOk(v.view),
      )
    case 'chart':
      return ok(
        keys('chart', 'series', 'labels', 'view', 'grid', 'legend') &&
          oneOf(v.chart, ['bar', 'line', 'area', 'spark', 'donut']) &&
          Array.isArray(v.series) &&
          v.series.length >= 1 &&
          v.series.length <= 8 &&
          v.series.every(
            s =>
              isObj(s) &&
              only(s, ['name', 'values', 'color']) &&
              (s.name === undefined || isStr(s.name, 40)) &&
              Array.isArray(s.values) &&
              s.values.length >= 1 &&
              s.values.length <= 64 &&
              s.values.every(x => isNum(x, -1e9, 1e9)),
          ) &&
          (v.labels === undefined ||
            (Array.isArray(v.labels) &&
              v.labels.length <= 64 &&
              v.labels.every(l => isStr(l, 40)))) &&
          (v.grid === undefined || typeof v.grid === 'boolean') &&
          (v.legend === undefined || typeof v.legend === 'boolean') &&
          viewOk(v.view),
      )
    case 'diagram': {
      if (
        !keys('dir', 'nodes', 'edges', 'view') ||
        (v.dir !== undefined && !oneOf(v.dir, ['LR', 'TB'])) ||
        !Array.isArray(v.nodes) ||
        v.nodes.length < 1 ||
        v.nodes.length > 32 ||
        !Array.isArray(v.edges) ||
        v.edges.length > 64 ||
        !viewOk(v.view)
      )
        return 'is not valid for its type.'
      const ids = new Set<string>()
      for (const n of v.nodes) {
        if (
          !isObj(n) ||
          !only(n, ['id', 'label', 'sub', 'col', 'row', 'fill']) ||
          typeof n.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,24}$/.test(n.id) ||
          ids.has(n.id) ||
          typeof n.label !== 'string' ||
          n.label.length < 1 ||
          n.label.length > 60 ||
          (n.sub !== undefined && !isStr(n.sub, 60)) ||
          (n.col !== undefined && !isInt(n.col, 0, 31)) ||
          (n.row !== undefined && !isInt(n.row, 0, 31))
        )
          return 'is not valid for its type.'
        ids.add(n.id)
      }
      for (const e of v.edges) {
        if (
          !Array.isArray(e) ||
          e.length < 2 ||
          e.length > 3 ||
          typeof e[0] !== 'string' ||
          typeof e[1] !== 'string' ||
          (e[2] !== undefined && !isStr(e[2], 40))
        )
          return 'is not valid for its type.'
        if (!ids.has(e[0]) || !ids.has(e[1]))
          return `has an edge pointing at an unknown node; allowed: ${[...ids].join(', ')}.`
      }
      return null
    }
    case 'contours':
      return ok(
        keys('seed', 'bands', 'scale', 'view') &&
          isInt(v.seed, 0, 2147483647) &&
          (v.bands === undefined || isInt(v.bands, 2, 24)) &&
          (v.scale === undefined || isNum(v.scale, 0.25, 4)) &&
          viewOk(v.view),
      )
    case 'stamp':
      return ok(
        keys('text', 'center', 'rings', 'teeth', 'rotate', 'view') &&
          typeof v.text === 'string' &&
          v.text.length >= 1 &&
          v.text.length <= 120 &&
          (v.center === undefined || isStr(v.center, 40)) &&
          (v.rings === undefined || v.rings === 1 || v.rings === 2) &&
          (v.teeth === undefined || isInt(v.teeth, 8, 64)) &&
          (v.rotate === undefined || isNum(v.rotate, -360, 360)) &&
          viewOk(v.view),
      )
    default:
      return 'has a type that is not a shape geometry.'
  }
}

const colorBad = (c: Checks, v: unknown): boolean => {
  const k = checkColor(v)
  return (
    k === undefined ||
    (typeof k === 'object' && !c.styles.colors.some(x => x.id === k.style))
  )
}

const paintBad = (c: Checks, v: unknown): string | null => {
  if (v === 'none') return null
  if (isObj(v) && !Object.hasOwn(v, 'style')) {
    const radialOk =
      v.radial === undefined ||
      (Array.isArray(v.radial) &&
        v.radial.length === 3 &&
        isNum(v.radial[0], 0, 100) &&
        isNum(v.radial[1], 0, 100) &&
        isNum(v.radial[2], 0.01, 200))
    const stopsOk =
      Array.isArray(v.stops) &&
      v.stops.length >= 2 &&
      v.stops.length <= 12 &&
      v.stops.every(
        s =>
          isObj(s) &&
          only(s, ['color', 'at', 'alpha']) &&
          !colorBad(c, s.color) &&
          isNum(s.at, 0, 100) &&
          (s.alpha === undefined || isNum(s.alpha, 0, 1)),
      )
    const twoOk =
      v.stops === undefined && !colorBad(c, v.from) && !colorBad(c, v.to)
    if (
      only(v, ['from', 'to', 'stops', 'angle', 'radial']) &&
      (stopsOk || twoOk) &&
      (v.angle === undefined || isNum(v.angle, 0, 360)) &&
      radialOk
    )
      return null
    return 'is not a valid gradient; it takes {"from":<colour>,"to":<colour>,"angle"?:0 to 360,"radial"?:[cx,cy,r]} or {"stops":[...]}, for example {"from":"brand","to":"ink","angle":135}'
  }
  return colorBad(c, v)
    ? 'is not a paint; it takes a site colour name, a #rrggbb colour, a gradient or "none", for example "brand", "#1f2937", {"from":"brand","to":"ink","angle":135} or "none"'
    : null
}

const strokeBad = (c: Checks, v: unknown): boolean =>
  !(
    isObj(v) &&
    only(v, ['color', 'width', 'dash']) &&
    !colorBad(c, v.color) &&
    isNum(v.width, 0, 200) &&
    (v.dash === undefined || pair(v.dash, 0, 1000))
  )

const MARK_SHAPES = [
  'rect',
  'circle',
  'ellipse',
  'line',
  'curve',
  'arc',
  'wave',
  'grid',
  'path',
  'label',
] as const
const MARK_KEYS = [
  ...MARK_SHAPES,
  'at',
  'anchor',
  'size',
  'weight',
  'font',
  'fill',
  'stroke',
  'opacity',
  'blur',
  'rotate',
  'repeat',
]

function marksBad(c: Checks, v: unknown): Bad | null {
  if (!Array.isArray(v) || v.length > 64)
    return bad('must be a list of at most 64 marks.')
  for (let i = 0; i < v.length; i++) {
    const m = v[i]
    if (!isObj(m) || !only(m, MARK_KEYS))
      return bad(`has an invalid mark at index ${i}.`)
    const kinds = MARK_SHAPES.filter(k => m[k] !== undefined)
    if (kinds.length !== 1)
      return bad(`mark ${i} must name exactly one primitive or label.`)
    if (
      m.rect !== undefined &&
      (!Array.isArray(m.rect) ||
        m.rect.length < 4 ||
        m.rect.length > 5 ||
        !m.rect.every(x => isNum(x, -10000, 10000)))
    )
      return bad(`mark ${i} has an invalid rect.`)
    if (
      m.circle !== undefined &&
      (!Array.isArray(m.circle) ||
        m.circle.length !== 3 ||
        !m.circle.every(x => isNum(x, -10000, 10000)) ||
        (m.circle[2] as number) <= 0)
    )
      return bad(`mark ${i} has an invalid circle.`)
    if (
      m.ellipse !== undefined &&
      (!Array.isArray(m.ellipse) ||
        m.ellipse.length !== 4 ||
        !m.ellipse.every(x => isNum(x, -10000, 10000)))
    )
      return bad(`mark ${i} has an invalid ellipse.`)
    if (
      m.line !== undefined &&
      (!Array.isArray(m.line) ||
        m.line.length !== 4 ||
        !m.line.every(x => isNum(x, -10000, 10000)))
    )
      return bad(`mark ${i} has an invalid line.`)
    if (
      m.curve !== undefined &&
      (!isObj(m.curve) ||
        !only(m.curve, ['points', 'closed', 'tension']) ||
        !Array.isArray(m.curve.points) ||
        m.curve.points.length < 2 ||
        m.curve.points.length > 128 ||
        !m.curve.points.every(p => pair(p, -10000, 10000)) ||
        (m.curve.closed !== undefined && typeof m.curve.closed !== 'boolean') ||
        (m.curve.tension !== undefined && !isNum(m.curve.tension, 0, 1)))
    )
      return bad(`mark ${i} has an invalid curve.`)
    if (
      m.arc !== undefined &&
      (!isObj(m.arc) ||
        !only(m.arc, ['cx', 'cy', 'r', 'inner', 'start', 'end']) ||
        !isNum(m.arc.cx, -10000, 10000) ||
        !isNum(m.arc.cy, -10000, 10000) ||
        !isNum(m.arc.r, 0.5, 10000) ||
        (m.arc.inner !== undefined && !isNum(m.arc.inner, 0, 10000)) ||
        !isNum(m.arc.start, -720, 720) ||
        !isNum(m.arc.end, -720, 720))
    )
      return bad(`mark ${i} has an invalid arc.`)
    if (
      m.wave !== undefined &&
      (!isObj(m.wave) ||
        !only(m.wave, ['y', 'amp', 'freq', 'phase', 'closeBottom']) ||
        (m.wave.y !== undefined && !isNum(m.wave.y, -10000, 10000)) ||
        !isNum(m.wave.amp, 0, 5000) ||
        !isNum(m.wave.freq, 0.1, 64) ||
        (m.wave.phase !== undefined && !isNum(m.wave.phase, -100, 100)) ||
        (m.wave.closeBottom !== undefined &&
          typeof m.wave.closeBottom !== 'boolean'))
    )
      return bad(`mark ${i} has an invalid wave.`)
    if (
      m.grid !== undefined &&
      (!isObj(m.grid) ||
        !only(m.grid, ['cols', 'rows']) ||
        !isInt(m.grid.cols, 1, 64) ||
        !isInt(m.grid.rows, 1, 64))
    )
      return bad(`mark ${i} has an invalid grid.`)
    if (
      m.path !== undefined &&
      (typeof m.path !== 'string' ||
        m.path.length > SHAPE_LIMITS.path ||
        !PATH_RE.test(m.path))
    )
      return bad(`mark ${i} has invalid path data.`)
    if (m.label !== undefined && !isStr(m.label, 200))
      return bad(`mark ${i} has an invalid label.`)
    if (m.at !== undefined && !pair(m.at, -10000, 10000))
      return bad(`mark ${i} has an invalid at coordinate.`)
    if (m.anchor !== undefined && !oneOf(m.anchor, ['start', 'middle', 'end']))
      return bad(`mark ${i} has an invalid anchor.`)
    if (m.size !== undefined && !isNum(m.size, 4, 400))
      return bad(`mark ${i} has an invalid text size.`)
    if (m.weight !== undefined && !isInt(m.weight, 100, 900))
      return bad(`mark ${i} has an invalid font weight.`)
    if (
      m.font !== undefined &&
      (typeof m.font !== 'string' ||
        (!m.font.startsWith('sys:') && !c.fonts.has(m.font)))
    )
      return bad(`mark ${i} names a font the site does not have.`)
    if (m.fill !== undefined) {
      const pb = paintBad(c, m.fill)
      if (pb) return bad(`mark ${i} ${pb}`)
    }
    if (m.stroke !== undefined && strokeBad(c, m.stroke))
      return bad(`mark ${i} has an invalid stroke.`)
    if (m.opacity !== undefined && !isNum(m.opacity, 0, 1))
      return bad(`mark ${i} has an invalid opacity.`)
    if (m.blur !== undefined && !isNum(m.blur, 0, 40))
      return bad(`mark ${i} has an invalid blur.`)
    if (
      m.rotate !== undefined &&
      !isNum(m.rotate, -360, 360) &&
      !(
        Array.isArray(m.rotate) &&
        m.rotate.length === 3 &&
        m.rotate.every(x => isNum(x, -10000, 10000))
      )
    )
      return bad(`mark ${i} has an invalid rotate.`)
    if (m.repeat !== undefined) {
      const r = m.repeat
      if (
        !isObj(r) ||
        !only(r, ['count', 'step', 'rotate', 'scale', 'opacity']) ||
        !isInt(r.count, 2, 64) ||
        (r.step !== undefined && !pair(r.step, -10000, 10000)) ||
        (r.scale !== undefined && !isNum(r.scale, 0.1, 4)) ||
        (r.opacity !== undefined && !pair(r.opacity, 0, 1)) ||
        (r.rotate !== undefined &&
          !isNum(r.rotate, -360, 360) &&
          !(
            Array.isArray(r.rotate) &&
            r.rotate.length === 3 &&
            r.rotate.every(x => isNum(x, -10000, 10000))
          ))
      )
        return bad(`mark ${i} has an invalid repeat.`)
    }
  }
  const expanded = expandMarks(v as never, [100, 100])
  if (expanded.over)
    return bad(`expands beyond ${MAX_MARKS} marks.`, 'RESOURCE_LIMIT_EXCEEDED')
  return null
}

export function propBad(
  c: Checks,
  f: PropField,
  v: unknown,
  key: string,
  refs: Refs,
  code = false,
): Bad | null {
  switch (f.type) {
    case 'number':
      return isNum(v, f.min ?? -Infinity, f.max ?? Infinity) &&
        (!f.int || Number.isInteger(v))
        ? null
        : bad('is not a number in range.')
    case 'switch':
      return typeof v === 'boolean' ? null : bad('must be on or off.')
    case 'select':
      return typeof v === 'string' && f.options?.includes(v)
        ? null
        : bad('is not one of the choices.')
    case 'url':
      return typeof v === 'string' && urlOk(v)
        ? null
        : bad('is not an allowed web address.')
    case 'text':
    case 'textarea':
      return typeof v === 'string' && v.length <= (f.maxLength ?? 5000)
        ? null
        : bad('is not text, or is too long.')
    case 'date':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v))
        ? null
        : bad('is not a date.')
    case 'id':
      return typeof v === 'string' && v.length > 0 && v.length <= 100
        ? null
        : bad('is not a valid id.')
    case 'asset':
      return isStr(v) && v ? null : bad('does not name a file.')
    case 'link': {
      const m = linkBad(v)
      return m ? bad(m) : null
    }
    case 'pattern':
      return isObj(v) &&
        only(v, [
          'tile',
          'color',
          'strength',
          'size',
          'fade',
          'cursor',
          'density',
        ]) &&
        oneOf(v.color, ['brand', 'ink', 'gradient']) &&
        isNum(v.strength, 0, 100) &&
        (v.size === undefined || isNum(v.size, 4, 96)) &&
        (v.tile === undefined || oneOf(v.tile, TILES)) &&
        (v.fade === undefined || oneOf(v.fade, ['left', 'right', 'bottom'])) &&
        (v.cursor === undefined || oneOf(v.cursor, ['glow', 'cells'])) &&
        (v.density === undefined ||
          oneOf(v.density, ['top', 'right', 'bottom', 'left']))
        ? null
        : bad('is not a valid pattern.')
    case 'geometry': {
      const m = geometryBad(v)
      if (m) return bad(m)
      if (isObj(v) && v.type === 'chart' && Array.isArray(v.series)) {
        for (const s of v.series)
          if (isObj(s) && s.color !== undefined && colorBad(c, s.color))
            return bad('names a chart series colour that is not allowed.')
      }
      if (isObj(v) && v.type === 'diagram' && Array.isArray(v.nodes)) {
        for (const n of v.nodes)
          if (isObj(n) && n.fill !== undefined && colorBad(c, n.fill))
            return bad('names a diagram node fill colour that is not allowed.')
      }
      return null
    }
    case 'paint': {
      const m = paintBad(c, v)
      return m ? bad(m) : null
    }
    case 'stroke':
      return !strokeBad(c, v)
        ? null
        : bad(
            'is not a valid stroke; it takes {"color":<colour>,"width":0 to 200,"dash"?:[on,off]}, for example {"color":"ink","width":2}',
          )
    case 'marks':
      return marksBad(c, v)
    case 'list':
      return listBad(c, f, v, key, refs, code)
    default:
      return bad('has a type this site does not know.')
  }
}

export function listBad(
  c: Checks,
  f: PropField,
  v: unknown,
  key: string,
  refs: Refs,
  code: boolean,
): Bad | null {
  if (
    !Array.isArray(v) ||
    v.length > (code && key === 'runs' ? CODE_RUNS : (f.max ?? 1000))
  )
    return bad('is not a list, or has too many items.')
  if (f.options)
    return v.length &&
      new Set(v).size === v.length &&
      v.every(x => oneOf(x, f.options!))
      ? null
      : bad('has a choice that is not allowed, or twice.')
  if (key !== 'runs')
    return v.every(x => isStr(x))
      ? null
      : bad('has an item that is not short text.')
  let chars = 0
  for (const r of v) {
    if (isObj(r) && r.br !== undefined) {
      if (r.br !== true || Object.keys(r).length !== 1)
        return bad('has a line break with other fields.')
      continue
    }
    if (
      !isObj(r) ||
      !only(r, RUN_KEYS) ||
      (typeof r.text !== 'string' && r.math === undefined)
    )
      return bad(
        'has an item that is not a text run. A run is { "text": "…" } with optional link, bind or style; a line break is { "br": true }.',
      )
    if (r.math !== undefined && (r.text !== undefined || !mathOk(r.math)))
      return bad(
        'has a run of maths that is not plain MathML, or that also has text.',
      )
    if (r.dark !== undefined && (!code || !isHex6(r.dark)))
      return bad(
        'has a dark colour that is not a #rrggbb colour on a code text.',
      )
    if (r.math !== undefined && code) return bad('has maths in a code text.')
    chars +=
      (typeof r.text === 'string' ? r.text.length : 0) +
      (typeof r.math === 'string' ? r.math.length : 0)
    if (r.link !== undefined) {
      const lp = linkBad(r.link)
      if (lp) return bad(`has a run that ${lp}`)
    }
    for (const ref of [r.bind, r.bindHref]) {
      if (ref === undefined) continue
      const k = refs(ref)
      if (k === 'shape')
        return bad('has a run bound to data in a way that is not allowed.')
      if (k === 'unknown')
        return bad(
          'has a run bound to data that does not exist.',
          'UNKNOWN_SOURCE',
        )
    }
    if (r.style !== undefined) {
      if (!isObj(r.style) || !only(r.style, RUN_STYLE))
        return bad('has a run style that is not allowed.')
      if (checkStyle('text', { base: r.style }, c.styles).problems.length)
        return bad('has a run style with a value that is not allowed.')
      const font = r.style.font
      if (
        typeof font === 'string' &&
        !font.startsWith('sys:') &&
        !c.fonts.has(font)
      )
        return bad('has a run that uses a font the site does not have.')
    }
  }
  return chars <= (code ? CODE_CHARS : (f.maxLength ?? 5000))
    ? null
    : bad('is too long.')
}

export function checkNode(c: Ctx, t: TCtx, e: Entry) {
  const { w } = e
  const say = (message: string, path?: string, code?: Code) =>
    add(c, w, message, path, code)
  for (const k of Object.keys(w))
    if (!NODE_KEYS.has(k))
      say(`It has a field this version does not know: ${k.slice(0, 40)}.`, k)
  const spec = specOf(c, w.kind)
  if (!spec) {
    c.out.push({
      code: 'UNKNOWN_KIND',
      message: `Its kind "${typeof w.kind === 'string' ? w.kind.slice(0, 40) : '?'}" is not one this site knows.`,
      nodeId: idOf(w),
      path: 'kind',
      allowed: [...Object.keys(KINDS), ...c.kinds.keys()],
    })
    return
  }
  if (typeof w.name !== 'string' || w.name.length > 100)
    say('Its name must be text of at most 100 characters.', 'name')
  if (w.required !== undefined) {
    if (typeof w.required !== 'boolean')
      say('Its required mark must be true or false.', 'required')
    else if (!w.required && w.kind !== 'form' && w.kind !== 'field')
      say(
        'Only a form or a field can be marked not required; on any other kind the mark has no effect.',
        'required',
      )
  }
  const refs = refsFor(e.items)
  if (w.kind === 'instance') {
    const ib = instanceBad(c, e, refs)
    if (ib) say(ib.message, ib.path, ib.code)
  } else if (
    w.component !== undefined ||
    w.set !== undefined ||
    w.overrides !== undefined
  )
    say('Only a component use can name a component.', 'component')

  // Where it sits.
  const parent = placedIn(c, e)
  const pspec = parent && specOf(c, parent.kind)
  // An instance sits where its master's top block would.
  const as =
    w.kind === 'instance'
      ? c.comps.get(w.component as string)?.root.kind
      : undefined
  const aspec = (as && specOf(c, as)) || spec
  const akind = as && specOf(c, as) ? as : w.kind
  // The top block of a page, header or footer has no parent to check it, so it must be a container that fits anywhere a box does (a component's root is checked where its instance lands).
  if (
    !parent &&
    t.which !== 'component' &&
    (aspec.role !== 'container' ||
      (aspec.parents !== 'any' && !aspec.parents.includes('box')))
  )
    say(`The top block of a page, header or footer cannot be \`${akind}\`.`)
  if (parent && pspec) {
    if (aspec.parents !== 'any' && !aspec.parents.includes(parent.kind))
      say(
        `A ${aspec.label.toLowerCase()} cannot go inside a ${pspec.label.toLowerCase()}.`,
      )
    if (akind === 'field' && parent.kind !== 'form') {
      let x: Entry | null = e.parent
      while (x && x.w.kind !== 'form') x = x.parent
      if (!x) say('A field has to be inside a form.')
    }
    if (pspec.children?.kinds && !pspec.children.kinds.includes(akind))
      say(
        `A ${pspec.label.toLowerCase()} cannot hold a ${aspec.label.toLowerCase()}.`,
      )
  }
  const sp = slotBad(w, parent && (pspec ? parent : { ...parent, kind: 'box' }))
  if (sp) say(`It ${sp}`, 'slot')

  // Children.
  const count = w.children?.length ?? 0
  // A leaf holds only what its `children` names (a shape's parts); a leaf with no `children` holds nothing.
  if (spec.role === 'leaf' && count && !spec.children)
    say('It cannot hold other nodes.', 'children')
  if (w.kind === 'shape') {
    const gt =
      isObj(w.props) && isObj(w.props.geometry)
        ? (w.props.geometry as { type?: unknown }).type
        : undefined
    if (gt === 'group' ? count < 1 : count)
      say(
        gt === 'group'
          ? 'A group must hold 1 to 32 shapes.'
          : 'Only a group holds shapes.',
        'children',
      )
    if (
      gt === 'group' &&
      (w.props!.geometry as { combine?: unknown }).combine === 'subtract'
    )
      for (const cutter of (w.children ?? []).slice(1))
        if (cutter.motion !== undefined)
          add(
            c,
            cutter,
            'A mask cutter part in a subtract shape cannot carry motion.',
            'motion',
          )
    if (e.parent?.w.kind === 'button')
      for (const layout of [false, 'tablet', true] as const)
        if (effectivePlacement(w, layout).mode !== 'behind') {
          say('A shape in a button is placed behind.', 'placement')
          break
        }
    if (e.parent?.w.kind === 'shape') {
      if (w.style !== undefined)
        say('A shape in a group has no style.', 'style')
      if (w.placement !== undefined)
        say('A shape in a group has no placement.', 'placement')
      let up = 0
      for (let x: Entry | null = e; x?.w.kind === 'shape'; x = x.parent) up++
      if (up > SHAPE_LIMITS.depth)
        say(`Shapes go at most ${SHAPE_LIMITS.depth} deep.`, 'children')
    }
  }
  if (w.kind === 'list' && w.repeat !== undefined && count > 1)
    say('A repeating list must hold exactly 1 node.', 'children')
  if (spec.children && (count < spec.children.min || count > spec.children.max))
    say(
      spec.children.min === spec.children.max
        ? `It must hold exactly ${spec.children.min} node${spec.children.min === 1 ? '' : 's'}.`
        : `It must hold between ${spec.children.min} and ${spec.children.max} nodes.`,
      'children',
    )

  // Props.
  const props = w.props as unknown
  if (props !== undefined && !isObj(props))
    say('Its settings are not an object.', 'props')
  else {
    const pr = props ?? {}
    for (const [k, v] of Object.entries(pr)) {
      const f = Object.hasOwn(spec.props, k) ? spec.props[k] : undefined
      if (!f) {
        say(
          `It has a setting "${k}" that this kind does not have.`,
          `props.${k}`,
        )
        continue
      }
      const p = propBad(
        c,
        f,
        v,
        k,
        refs,
        w.kind === 'text' && pr.level === 'code',
      )
      if (p) say(`Its ${k} ${p.message}`, `props.${k}`, p.code)
    }
    for (const [k, f] of Object.entries(spec.props))
      if (f.required && pr[k] === undefined)
        say(`Its ${k} is missing.`, `props.${k}`)
    if (
      w.kind === 'shape' &&
      typeof pr.shadow === 'string' &&
      !c.styles.shadows.some(x => x.id === pr.shadow)
    )
      say('Its shadow is not one this site has.', 'props.shadow')
    checkSettings(c, t, e, pr, say)
  }

  // Style.
  const ts = isObj(props) ? props.textStyle : undefined
  if (
    w.kind === 'text' &&
    ts !== undefined &&
    !c.styles.text.some(x => x.id === ts)
  )
    say('Its text style is not one this site has.', 'props.textStyle')
  if (w.style !== undefined) {
    const sb = styleBad(c, w.kind, w.style)
    if (
      !sb.length &&
      declsOf(w.style).some(d => d?.reveal) &&
      !(t.which === 'footer' && !e.parent)
    )
      say("Reveal belongs on the footer's top block only.", 'style')
    if (
      !sb.length &&
      declsOf(w.style).some(d => d?.side !== undefined) &&
      !(t.which === 'header' && !e.parent?.parent)
    )
      say("Side belongs on the header's top blocks only.", 'style')
    for (const b of sb) say(b.message, b.path)
    // A layer reacts only to a state this node or a node around it holds, and only to a value that state has.
    if (!sb.length && Array.isArray(w.style.when))
      for (const x of w.style.when) {
        const st = stateIn(c, t, e, x.state)
        if (!st)
          say(
            `Its style reacts to "${x.state}", a state that this node and the nodes around it do not hold.`,
            'style.when',
          )
        else if (!st.values.includes(x.is))
          say(
            `Its style reacts to "${x.state}" being "${x.is}", which is not a value of that state.`,
            'style.when',
          )
      }
  }

  checkStates(c, t, e, say)
  checkMotion(c, t, e)

  checkData(c, e, spec, refs, say)

  // hide, locked, origin, placement.
  if (w.hide !== undefined && !hideOk(w.hide))
    say('Its hide setting is not valid.', 'hide')
  if (w.locked !== undefined && (w.locked as unknown) !== true)
    say('Its lock setting is not valid.', 'locked')
  const o = w.origin as unknown
  if (
    o !== undefined &&
    !(
      isObj(o) &&
      only(o, ['block', 'version', 'look']) &&
      isStr(o.block) &&
      isNum(o.version, 0, 1e9) &&
      isStr(o.look)
    )
  )
    say('Its origin is not valid.', 'origin')
  else if (isObj(o) && !c.reg.block(o.block as string))
    say(
      `Its block "${(o.block as string).slice(0, 40)}" is not one a plug-in provides.`,
      'origin.block',
      'UNKNOWN_BLOCK',
    )
  checkPlacement(w, parent, say)
}

/** Rules that tie settings together: layers, details, buttons. */
export function checkSettings(
  _c: Ctx,
  t: TCtx,
  e: Entry,
  pr: Obj,
  say: (message: string, path?: string, code?: Code) => void,
) {
  const { w } = e
  const parent = e.parent?.w
  if (
    w.kind === 'details' &&
    pr.name !== undefined &&
    !(typeof pr.name === 'string' && DETAILS_NAME.test(pr.name))
  )
    say(
      'Its name must be 1 to 32 lowercase letters, digits and dashes.',
      'props.name',
    )
  if (pr.open === true && w.kind !== 'details') {
    if (pr.layer !== 'popover-manual')
      say('Open on load needs a manual popover.', 'props.open')
    else if (!t.closers.has(w.id))
      say('An open bar needs a close button.', 'props.open')
  }
  if (pr.layer !== undefined)
    for (let a: Entry | null = e; a; a = a.parent)
      if (a.w.repeat !== undefined) {
        say("A layer can't sit inside a repeating list.", 'props.layer')
        break
      }
  if (pr.layer === 'dialog' && parent?.kind === 'list')
    say(
      'Nest the dialog inside the list item; a direct list child must render as li.',
      'props.layer',
    )
  if (
    w.kind === 'embed' &&
    typeof pr.provider === 'string' &&
    Object.hasOwn(EMBEDS, pr.provider) &&
    typeof pr.id === 'string' &&
    !embedIdOk(pr.provider, pr.id)
  )
    say('Its id is not a valid id for that provider.', 'props.id')
  if (w.kind === 'details' && typeof pr.summary !== 'string')
    say('Its summary is missing.', 'props.summary')
  if (w.kind === 'button') {
    if (
      pr.label === undefined &&
      !(isObj(w.bind) && w.bind.label !== undefined)
    )
      say('Its label is missing.', 'props.label')
    if ((pr.command === undefined) !== (pr.opens === undefined))
      say('Its command and its target go together.', 'props.command')
    else if (typeof pr.opens === 'string' && typeof pr.command === 'string') {
      if (pr.link !== undefined)
        say('A button with a command cannot also have a link.', 'props.link')
      const target = t.targets.get(pr.opens)
      const layer = isObj(target?.props) ? target.props.layer : undefined
      if (!target)
        say(
          'It points at a node that is not in this tree, the header or the footer.',
          'props.opens',
        )
      else if (
        pr.command === 'show-modal' || pr.command === 'close'
          ? layer !== 'dialog'
          : !(layer === 'popover-auto' || layer === 'popover-manual')
      )
        say(
          'It points at a node that cannot take that command.',
          'props.command',
        )
    }
  }
}

export function checkPlacement(
  w: Node,
  parent: Node | null,
  say: (message: string, path?: string, code?: Code) => void,
) {
  const placement = w.placement as unknown
  if (placement === undefined) return
  const valid = (v: unknown, partial = false) =>
    isObj(v) &&
    only(
      v,
      partial ? ['mode', 'x', 'y'] : ['mode', 'x', 'y', 'tablet', 'phone'],
    ) &&
    ((partial && v.mode === undefined) || oneOf(v.mode, PLACEMENT_MODES)) &&
    (v.x === undefined || isNum(v.x, -2000, 2000)) &&
    (v.y === undefined || isNum(v.y, -2000, 2000))
  const p = placement as Obj
  if (
    !parent ||
    !valid(p) ||
    (p.tablet !== undefined && !valid(p.tablet, true)) ||
    (p.phone !== undefined && !valid(p.phone, true))
  )
    return say('Its placement is not valid.', 'placement')
  for (const layout of [false, 'tablet', true] as const) {
    const v = effectivePlacement(w, layout)
    if (v.mode !== 'front' && v.mode !== 'behind' && (v.x || v.y))
      say('Only floating placement can have offsets.', 'placement')
    if (
      v.mode.startsWith('wrap-') &&
      (!(w.kind === 'image' || w.kind === 'video') ||
        !['box', 'row', 'column', 'grid', 'table-cell', 'details'].includes(
          parent.kind,
        ))
    )
      say('Wrap text needs media inside a content group.', 'placement')
  }
}
