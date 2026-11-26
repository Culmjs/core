// JSX elements <-> Culm nodes. `want` builds the tree the JSX describes, `emit` writes a node back as JSX, `reconcile` turns the
// difference between a tree and a want into core operations (add, remove, move, setProps, setStyle ...). Nothing here writes; core `apply` does.
import {
  KINDS,
  kindSpec,
  type KindSpec,
  type Node,
  type Registry,
} from '@culmjs/core'
import { ID_RE } from '../shared.ts'
import { JsxError, type El, type Loc } from './parse.ts'
import { STYLE_ALIASES, type Warning } from './normalise.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Attributes that are about the node, not its settings. A setting with one of these names (an embed's `id`) goes in `props={{...}}`. */
const LAYERS: Record<string, string> = {
  style: 'base',
  tablet: 'tablet',
  phone: 'phone',
  hover: 'hover',
  dark: 'dark',
}
const STATE_LAYERS = [
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
]
const EXTRAS = [
  'slot',
  'placement',
  'hide',
  'repeat',
  'bind',
  'showIf',
  'showIfAny',
  'state',
  'on',
  'motion',
]
const RESERVED = new Set([
  'id',
  'nodeName',
  'keep',
  'props',
  'states',
  ...Object.keys(LAYERS),
  ...EXTRAS,
])
/** Written only by inserting a block; never shown, never set. */
const MARKS = ['sample', 'chrome']

const specOf = (kind: string, registry?: Registry): KindSpec | undefined =>
  kindSpec(kind, registry?.kinds()) ?? KINDS[kind as keyof typeof KINDS]

export const kindOf = (
  name: string,
  registry?: Registry,
): string | undefined => {
  const k = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return specOf(k, registry) && k !== 'instance' ? k : undefined
}
export const nameOf = (kind: string) =>
  kind
    .split('-')
    .map(s => s[0]!.toUpperCase() + s.slice(1))
    .join('')
export const ELEMENTS = Object.keys(KINDS)
  .filter(k => k !== 'instance')
  .map(nameOf)

export type Want = {
  id?: string
  kind: string
  name?: string
  keep?: boolean
  props: Obj
  layers: Obj
  extras: Obj
  children: Want[]
  at: Loc
  path: string
}

const need = (
  a: { value: unknown; at: Loc },
  name: string,
  ok: boolean,
  what: string,
) => {
  if (!ok) throw new JsxError(`${name} must be ${what}.`, a.at)
}

/** Names an author brings from HTML and other kits, and the Culm element each stands for. */
const ELEMENT_ALIASES: Record<string, [string, Obj?]> = {
  Div: ['column'],
  Section: ['column'],
  Container: ['column'],
  Stack: ['column'],
  VStack: ['column'],
  Article: ['column'],
  Main: ['column'],
  HStack: ['row'],
  Flex: ['row'],
  P: ['text', { level: 'p' }],
  Paragraph: ['text', { level: 'p' }],
  Span: ['text', { level: 'span' }],
  Label: ['text', { level: 'p' }],
  Heading: ['text', { level: 'h2' }],
  H1: ['text', { level: 'h1' }],
  H2: ['text', { level: 'h2' }],
  H3: ['text', { level: 'h3' }],
  H4: ['text', { level: 'h4' }],
  H5: ['text', { level: 'h5' }],
  H6: ['text', { level: 'h6' }],
  Img: ['image'],
  Hr: ['divider'],
}

export function want(
  el: El,
  index: number,
  parent: string,
  errs: JsxError[],
  warns: Warning[] = [],
  registry?: Registry,
): Want | undefined {
  const alias = ELEMENT_ALIASES[el.name]
  const kind = kindOf(el.name, registry) ?? alias?.[0]
  const path =
    el.sourcePath ?? `${parent ? `${parent} > ` : ''}${el.name}[${index}]`
  const say = (message: string, at: Loc = el.at) =>
    warns.push({
      message: `${path}: ${message}`,
      jsx: { path, line: at.line, column: at.col },
    })
  if (kind && alias && !kindOf(el.name, registry))
    say(`<${el.name}> is not a Culm element; used as <${nameOf(kind)}>`)
  if (!kind) {
    errs.push(
      new JsxError(
        `Unknown element <${el.name}>. Elements: ${ELEMENTS.join(', ')}, and <Site> first.`,
        el.at,
        path,
      ),
    )
    el.children.forEach((c, i) => want(c, i, path, errs, warns, registry))
    return undefined
  }
  const spec = specOf(kind, registry)!
  const w: Want = {
    kind,
    props: { ...alias?.[1] },
    layers: {},
    extras: {},
    children: [],
    at: el.at,
    path,
  }
  for (const [name, a] of el.attrs) {
    try {
      attribute(w, el, spec, name, a, say)
    } catch (e) {
      if (!(e instanceof JsxError)) throw e
      errs.push(new JsxError(e.message, e.at, path))
    }
  }
  try {
    words(w, el, kind)
  } catch (e) {
    if (!(e instanceof JsxError)) throw e
    errs.push(new JsxError(e.message, e.at, path))
  }
  w.children = el.children.flatMap((c, i) => {
    const x = want(c, i, path, errs, warns, registry)
    return x ? [x] : []
  })
  return w
}

function words(w: Want, el: El, kind: string) {
  const text =
    el.parts ?? (el.text !== undefined ? [{ text: el.text }] : undefined)
  if (!text) return
  const key = kind === 'text' ? 'runs' : kind === 'button' ? 'label' : ''
  if (!key)
    throw new JsxError(`<${el.name}> holds no text; put it in a <Text>.`, el.at)
  if (key in w.props)
    throw new JsxError(
      `<${el.name}> has ${key} and text between the tags; give one.`,
      el.at,
    )
  if (key === 'label' && el.parts)
    throw new JsxError('A <Button> label has no line break or marks.', el.at)
  w.props[key] = key === 'runs' ? text : el.text
}

function attribute(
  w: Want,
  el: El,
  spec: KindSpec,
  name: string,
  a: { value: unknown; at: Loc },
  say: (message: string, at?: Loc) => void,
) {
  const v = a.value
  if (name === 'id') {
    need(a, 'id', typeof v === 'string', 'a text')
    w.id = v as string
  } else if (name === 'nodeName') {
    need(a, name, typeof v === 'string', 'a text')
    w.name = v as string
  } else if (name === 'keep') {
    need(a, name, typeof v === 'boolean', 'true or false')
    w.keep = v as boolean
  } else if (name in LAYERS) {
    need(a, name, isObj(v), 'an object: {{ ... }}')
    w.layers[LAYERS[name]!] = v
  } else if (name === 'states') {
    need(a, name, isObj(v), 'an object: {{ pressed: {...} }}')
    for (const [k, x] of Object.entries(v as Obj)) {
      if (k === 'when')
        need(
          a,
          'states.when',
          Array.isArray(x) && x.every(isObj),
          'a list of objects',
        )
      else if (STATE_LAYERS.includes(k))
        need(a, `states.${k}`, isObj(x), 'an object')
      else
        throw new JsxError(
          `states has no "${k}". It has: ${STATE_LAYERS.join(', ')}, when.`,
          a.at,
        )
      w.layers[k] = x
    }
  } else if (name === 'props') {
    need(a, name, isObj(v), 'an object')
    Object.assign(w.props, v)
  } else if (EXTRAS.includes(name)) w.extras[name] = v
  else if (name === 'href' && Object.hasOwn(spec.props, 'link'))
    w.props.link = v
  else if (w.kind === 'image' && (name === 'generate' || name === 'aspect'))
    w.props[name] = v
  else if (
    w.kind === 'shape' &&
    [
      'scene',
      'curve',
      'arc',
      'wave',
      'chart',
      'diagram',
      'contours',
      'stamp',
    ].includes(name)
  )
    w.props[name] = v
  else if (Object.hasOwn(spec.props, name)) w.props[name] = v
  else if (el.name === 'Field' && name === 'type' && typeof v === 'string') {
    // an input's type names the field: email, message (textarea) or name
    const n = { email: 'email', textarea: 'message', text: 'name' }[v]
    if (n && w.props.name === undefined) w.props.name = n
    say(
      `type="${v}" is not a setting of <Field>; ${n ? `set name="${n}"` : 'dropped'}`,
      a.at,
    )
  } else if (/^on[A-Z]|^dangerouslySetInnerHTML$/.test(name))
    throw new JsxError(
      `"${name}" would run code, and a Culm page has none. Use on={{...}} for actions, or a Button link.`,
      a.at,
    )
  else if (
    (spec.styles as string[]).includes(STYLE_ALIASES[name] ?? name) ||
    Object.hasOwn(STYLE_ALIASES, name)
  ) {
    w.layers.base = { ...(w.layers.base as Obj | undefined), [name]: v }
    say(`${name} is a style; written in style={{...}}`, a.at)
  } else
    say(
      `"${name}" is not a setting of <${el.name}> (its settings: ${Object.keys(spec.props).join(', ') || 'none'}); dropped`,
      a.at,
    )
}

/** The node an `add` operation takes; `deep` false leaves the children to later operations (when some of them are existing nodes to move in). */
export function toNew(w: Want, deep = true): Obj {
  const n: Obj = { kind: w.kind }
  if (w.id !== undefined) n.id = w.id
  if (w.name !== undefined) n.name = w.name
  if (w.keep !== undefined) n.required = w.keep
  if (Object.keys(w.props).length) n.props = w.props
  if (Object.keys(w.layers).length) n.style = w.layers
  Object.assign(n, w.extras)
  if (deep && w.children.length) n.children = w.children.map(c => toNew(c))
  return n
}

// ---- emit

/** A value as the literal the parser reads back: `{ a: 1, "b-c": [2, "x"] }`. */
const lit = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(lit).join(', ')}]`
    : isObj(v)
      ? Object.keys(v).length
        ? `{ ${Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .map(
              ([k, x]) =>
                `${/^[A-Za-z_]\w*$/.test(k) ? k : JSON.stringify(k)}: ${lit(x)}`,
            )
            .join(', ')} }`
        : '{}'
      : (JSON.stringify(v) ?? 'null')
const attr = (k: string, v: unknown) =>
  v === true
    ? k
    : typeof v === 'string'
      ? `${k}=${JSON.stringify(v)}`
      : `${k}={${lit(v)}}`
/** Runs that are only plain words and line breaks, as the text between tags (`a<br />b`); else undefined. */
const wordsOf = (runs: unknown[]): string | undefined => {
  const out: string[] = []
  for (const [i, r] of runs.entries()) {
    if (!isObj(r)) return undefined
    const k = Object.keys(r).join()
    if (k === 'br' && r.br === true) out.push('<br />')
    else if (k === 'text' && typeof r.text === 'string' && plainText(r.text)) {
      if (
        typeof runs[i - 1] === 'object' &&
        isObj(runs[i - 1]) &&
        'text' in (runs[i - 1] as Obj)
      )
        return undefined // two texts in a row would read back as one
      out.push(r.text)
    } else return undefined
  }
  return out.length ? out.join('') : undefined
}
const plainText = (s: string) => s !== '' && !/[<>{}&\\\n]| {2}|^ | $/.test(s)

/** The `href` that reads back as this link, or undefined (a file link, or a web address that would read as a page or an email). */
const hrefOf = (l: unknown): string | undefined => {
  if (!isObj(l) || Object.keys(l).length !== 1) return undefined
  if (typeof l.page === 'string' && /^\/(?!\/)/.test(l.page)) return l.page
  if (typeof l.email === 'string') return `mailto:${l.email}`
  if (
    typeof l.url === 'string' &&
    !l.url.startsWith('mailto:') &&
    !/^\/(?!\/)/.test(l.url)
  )
    return l.url
  return undefined
}
const SHORT: [Obj, string][] = [
  [{ weight: 700 }, 'b'],
  [{ italic: true }, 'i'],
  [{ underline: true }, 'u'],
  [{ strike: true }, 's'],
]
/**
 * Runs that hold marks (a style or a link), as words and marks between the tags: `Hi <b>there</b> <a href="/x">link</a>`; else undefined.
 * Each run is one piece, so the reader gets the same runs back: a word is written plain only where no space would be trimmed and no
 * neighbour would join it, else as `{"..."}`.
 */
const marksOf = (runs: unknown[]): string | undefined => {
  const out: string[] = []
  const last = runs.length - 1
  for (const [i, r] of runs.entries()) {
    if (!isObj(r)) return undefined
    if (r.br === true && Object.keys(r).length === 1) {
      out.push('<br />')
      continue
    }
    if (typeof r.text !== 'string' || r.text === '') return undefined
    if (Object.keys(r).some(k => !['text', 'style', 'link'].includes(k)))
      return undefined
    const style =
      isObj(r.style) && Object.keys(r.style).length ? r.style : undefined
    if (r.style !== undefined && !style) return undefined
    const href = r.link === undefined ? undefined : hrefOf(r.link)
    if (r.link !== undefined && href === undefined) return undefined
    const prev = runs[i - 1] as Obj | undefined
    const next = runs[i + 1] as Obj | undefined
    const plain =
      /^[^<>{}&\\\n]+$/.test(r.text) &&
      !/ {2}/.test(r.text) &&
      !(r.text.startsWith(' ') && (i === 0 || prev?.br === true)) &&
      !(r.text.endsWith(' ') && (i === last || next?.br === true)) &&
      // a plain word right after a plain word would read back as one
      !(!style && !href && prev && !prev.style && !prev.link && 'text' in prev)
    const word = plain ? r.text : `{${JSON.stringify(r.text)}}`
    if (!style && !href) {
      out.push(word)
      continue
    }
    const short = !href && SHORT.find(([s]) => canon(s) === canon(style))
    const tag = href ? 'a' : short ? short[1] : 'span'
    const at = [
      href ? `href=${JSON.stringify(href)}` : '',
      style && !short ? attr('style', style) : '',
    ].filter(Boolean)
    out.push(`<${tag}${at.map(x => ` ${x}`).join('')}>${word}</${tag}>`)
  }
  return out.length ? out.join('') : undefined
}

export function emit(n: Node, ind = '', registry?: Registry): string {
  const spec = specOf(n.kind, registry)
  if (!spec || n.kind === 'instance')
    throw new Error(`a ${n.kind} cannot be shown as JSX`)
  const attrs = [attr('id', n.id)]
  if (n.name !== spec.label) attrs.push(attr('nodeName', n.name))
  if (n.required !== undefined) attrs.push(attr('keep', n.required))
  let text: string | undefined
  const held: Obj = {}
  for (const [k, v] of Object.entries(n.props ?? {})) {
    if (MARKS.includes(k) || v === undefined) continue
    const words =
      k === 'runs' && Array.isArray(v)
        ? (wordsOf(v) ??
          ((v as unknown[]).some(r => isObj(r) && ('style' in r || 'link' in r))
            ? marksOf(v)
            : undefined))
        : undefined
    if (words !== undefined) text = words
    else if (RESERVED.has(k)) held[k] = v
    else attrs.push(attr(k, v))
  }
  if (Object.keys(held).length) attrs.push(attr('props', held))
  const s = n.style ?? {}
  for (const [a, layer] of Object.entries(LAYERS))
    if (s[layer as 'base']) attrs.push(attr(a, s[layer as 'base']))
  const states: Obj = {}
  for (const k of [...STATE_LAYERS, 'when'])
    if (s[k as 'open']) states[k] = s[k as 'open']
  if (Object.keys(states).length) attrs.push(attr('states', states))
  for (const k of EXTRAS) {
    const v = (n as unknown as Obj)[k]
    if (
      v !== undefined &&
      !(k === 'slot' && isObj(v) && !Object.keys(v).length)
    )
      attrs.push(attr(k, v))
  }
  const name = nameOf(n.kind)
  const head = `${ind}<${name} ${attrs.join(' ')}`
  const open =
    head.length > 100
      ? `${ind}<${name}\n${attrs.map(a => `${ind}  ${a}`).join('\n')}\n${ind}`
      : head
  const kids = n.children ?? []
  if (!kids.length && text === undefined)
    return `${open}${head.length > 100 ? '' : ' '}/>`
  if (text !== undefined && !kids.length) return `${open}>${text}</${name}>`
  return `${open}>\n${kids.map(c => emit(c, `${ind}  `)).join('\n')}\n${ind}</${name}>`
}

// ---- reconcile

export type Entry = {
  op: Obj
  want?: Want
  /** Index in write.ops when an ordered JSON edit produced this core operation. */
  editIndex?: number
  editPath?: string
}
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    isObj(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  ) ?? 'u'

/** The keys of `to` that differ from `from`, and null for those only `from` has. */
function delta(from: Obj, to: Obj): Obj {
  const out: Obj = {}
  for (const k of Object.keys(to))
    if (canon(to[k]) !== canon(from[k])) out[k] = to[k]
  for (const k of Object.keys(from)) if (!(k in to)) out[k] = null
  return out
}
const some = (o: Obj) => Object.keys(o).length > 0

function update(tree: unknown, o: Node, w: Want, out: Entry[]) {
  const at = { tree, id: o.id }
  const push = (op: Obj) => out.push({ op: { ...op, ...at }, want: w })
  const oldProps = Object.fromEntries(
    Object.entries(o.props ?? {}).filter(([k]) => !MARKS.includes(k)),
  )
  const props = delta(oldProps, w.props)
  const rename = w.name !== undefined && w.name !== o.name
  if (some(props) || rename)
    push({ op: 'setProps', props, ...(rename ? { name: w.name } : {}) })
  const s = (o.style ?? {}) as Obj
  for (const L of [
    'base',
    'tablet',
    'phone',
    'hover',
    ...STATE_LAYERS,
    'dark',
  ]) {
    const decl = delta((s[L] as Obj) ?? {}, (w.layers[L] as Obj) ?? {})
    if (some(decl)) push({ op: 'setStyle', layer: L, decl })
  }
  const oldWhen = (s.when as Obj[] | undefined) ?? []
  const newWhen = (w.layers.when as Obj[] | undefined) ?? []
  const same = (a: Obj, b: Obj) => a.state === b.state && a.is === b.is
  for (const nw of newWhen) {
    const decl = delta(
      (oldWhen.find(x => same(x, nw))?.decl as Obj) ?? {},
      (nw.decl as Obj) ?? {},
    )
    if (some(decl))
      push({
        op: 'setStyle',
        layer: { when: { state: nw.state, is: nw.is } },
        decl,
      })
  }
  for (const ow of oldWhen)
    if (!newWhen.some(x => same(x, ow)))
      push({
        op: 'setStyle',
        layer: { when: { state: ow.state, is: ow.is } },
        decl: Object.fromEntries(
          Object.keys((ow.decl as Obj) ?? {}).map(k => [k, null]),
        ),
      })
  const x = o as unknown as Obj
  const slot =
    canon(o.slot ?? {}) !== canon(w.extras.slot ?? {})
      ? { slot: w.extras.slot ?? {} }
      : {}
  const placement =
    canon(x.placement) !== canon(w.extras.placement)
      ? { placement: w.extras.placement ?? null }
      : {}
  if (some(slot) || some(placement))
    push({ op: 'setSlot', ...slot, ...placement })
  for (const l of ['desktop', 'tablet', 'phone']) {
    const was = ((o.hide as Obj | undefined)?.[l] ?? false) === true
    const now = ((w.extras.hide as Obj | undefined)?.[l] ?? false) === true
    if (was !== now) push({ op: 'setHidden', layout: l, hidden: now })
  }
  for (const [opName, keys] of [
    ['bindData', ['repeat', 'bind', 'showIf', 'showIfAny']],
    ['setStates', ['state', 'on']],
    ['setMotion', ['motion']],
  ] as const) {
    const d: Obj = {}
    for (const k of keys)
      if (canon(x[k]) !== canon(w.extras[k])) d[k] = w.extras[k] ?? null
    if (some(d)) push({ op: opName, ...d })
  }
  if (w.keep !== undefined && w.keep !== o.required)
    push({ op: 'setRequired', required: w.keep })
}

/** The first words of a want's own text, or of the first text below it: what its readable id is made of. */
function idWords(w: Want): string[] {
  const own = Array.isArray(w.props.runs)
    ? (w.props.runs as Obj[])
        .map(r => (typeof r.text === 'string' ? r.text : ''))
        .join(' ')
    : [
        w.props.label,
        w.props.alt,
        w.props.placeholder,
        w.props.summary,
        w.props.name,
        w.props.which,
      ].find(x => typeof x === 'string' && x !== '')
  const t = typeof own === 'string' ? own : ''
  const out =
    t
      .toLowerCase()
      .normalize('NFKD')
      .match(/[a-z0-9]+/g) ?? []
  if (out.length) return out
  for (const c of w.children) {
    const x = idWords(c)
    if (x.length) return x
  }
  return []
}

export type Plan = {
  entries: Entry[]
  byId: Map<string, Want>
  kinds: Map<string, string>
}

/**
 * The operations that make the children of `root` into `wants`.
 * A want that names an existing node of the tree by `id` (same kind) keeps that node, wherever it was: it is moved under its new
 * parent when that differs, and only what differs in it is changed. Every other want is added, with a fresh id when it names none
 * or one it cannot have. Nodes nothing names are removed, last; so a required node can be re-parented into a new layout.
 */
export function reconcile(
  tree: unknown,
  root: Node,
  wants: Want[],
  used: Set<string>,
): Plan {
  const old = new Map<string, Node>()
  const oldParent = new Map<string, string>()
  const index = (n: Node) => {
    old.set(n.id, n)
    for (const c of n.children ?? []) {
      oldParent.set(c.id, n.id)
      index(c)
    }
  }
  index(root)
  // who keeps which node, and under which new parent
  const claimed = new Map<Want, Node>()
  const taken = new Set<string>()
  const walkW = (ws: Want[]) => {
    for (const w of ws) {
      const m = w.id === undefined ? undefined : old.get(w.id)
      if (m && m.kind === w.kind && m.id !== root.id && !taken.has(m.id)) {
        claimed.set(w, m)
        taken.add(m.id)
      }
    }
    for (const w of ws) {
      if (w.id !== undefined && !claimed.has(w)) used.add(w.id) // given and free: an add may keep it
      walkW(w.children)
    }
  }
  walkW(wants)
  const hasClaimed = (w: Want): boolean =>
    w.children.some(c => claimed.has(c) || hasClaimed(c))
  const kept = new Set(taken)
  const below = (n: Node): boolean =>
    (n.children ?? []).some(c => kept.has(c.id) || below(c))

  const entries: Entry[] = []
  const tail: Entry[] = []
  // 1. removals that lose nothing kept; 3. (at the end) the containers whose kept nodes were moved out
  const sweep = (n: Node) => {
    for (const c of n.children ?? []) {
      if (kept.has(c.id)) sweep(c)
      else if (!below(c)) entries.push({ op: { op: 'remove', tree, id: c.id } })
      else {
        sweep(c)
        tail.push({ op: { op: 'remove', tree, id: c.id } })
      }
    }
  }
  sweep(root)
  // ids: a want that is added keeps its own id only if it is a valid id nothing in the tree has; else one read from its kind and words.
  // The ids of nodes this write removes are free again, so writing the same page twice gives the same ids.
  const reusable = new Set<string>()
  const freed = (n: Node) => {
    reusable.add(n.id)
    n.children?.forEach(freed)
  }
  for (const e of entries) freed(old.get(e.op.id as string)!)
  const free = (id: string) => !used.has(id) || reusable.has(id)
  const byId = new Map<string, Want>()
  const seen = new Set<string>()
  const readable = (w: Want) => {
    const head =
      w.kind === 'text' && /^h[1-6]$/.test(String(w.props.level))
        ? String(w.props.level)
        : w.kind.replace(/-/g, '')
    const words = idWords(w).slice(0, 3).join('')
    const base = (head + words).slice(0, 17)
    let id = base
    for (let k = 2; !free(id) || seen.has(id); k++)
      id = base.slice(0, 20 - String(k).length) + k
    return id
  }
  const idsOf = (ws: Want[]) => {
    for (const w of ws) {
      const m = claimed.get(w)
      if (m) w.id = m.id
      else if (
        w.id === undefined ||
        !ID_RE.test(w.id) ||
        old.has(w.id) ||
        seen.has(w.id)
      )
        w.id = readable(w)
      seen.add(w.id!)
      used.add(w.id!)
      byId.set(w.id!, w)
      idsOf(w.children)
    }
  }
  idsOf(wants)
  // the children of each parent as they are now, kept up to date as nodes move
  const real = new Map<string, string[]>()
  const at = new Map(oldParent)
  const gone = new Set(entries.map(e => e.op.id as string))
  const listOf = (id: string) => {
    let l = real.get(id)
    if (!l) {
      l = (old.get(id)?.children ?? [])
        .map(c => c.id)
        .filter(x => !gone.has(x) && at.get(x) === id)
      real.set(id, l)
    }
    return l
  }
  const place = (parent: string, ws: Want[]) => {
    const list = listOf(parent)
    const stay = new Set(ws.flatMap(w => (claimed.has(w) ? [w.id!] : [])))
    let prev: string | undefined
    for (const w of ws) {
      const m = claimed.get(w)
      const after = () => (prev === undefined ? 0 : list.indexOf(prev) + 1)
      if (!m) {
        const to = after()
        list.splice(to, 0, w.id!)
        at.set(w.id!, parent)
        const deep = !hasClaimed(w)
        entries.push({
          op: { op: 'add', tree, parent, index: to, node: toNew(w, deep) },
          want: w,
        })
        if (!deep) place(w.id!, w.children)
      } else {
        const cur = list.indexOf(m.id)
        const p0 = prev === undefined ? -1 : list.indexOf(prev)
        const inOrder =
          cur > p0 && !list.slice(p0 + 1, cur).some(x => stay.has(x))
        if (!inOrder) {
          const src = cur >= 0 ? list : listOf(at.get(m.id)!)
          src.splice(src.indexOf(m.id), 1)
          const to = after()
          list.splice(to, 0, m.id)
          at.set(m.id, parent)
          entries.push({
            op: { op: 'move', tree, id: m.id, parent, index: to },
            want: w,
          })
        }
        update(tree, m, w, entries)
        place(m.id, w.children)
      }
      prev = w.id
    }
  }
  place(root.id, wants)
  entries.push(...tail)
  const kinds = new Map([...old].map(([id, n]) => [id, n.kind]))
  return { entries, byId, kinds }
}
