import { kindSpec, type Node, type SiteDocument } from '../document/index.ts'
import { isObj } from '../document/rules.ts'

/** The words an agent writes where Culm has its own: `align left` on a text, `justify space-between`. */
const ALIGN: Record<string, string> = {
  left: 'start',
  right: 'end',
  start: 'start',
  center: 'center',
  end: 'end',
  justify: 'justify',
}
const SIDE: Record<string, string> = { left: 'start', right: 'end' }
const JUSTIFY: Record<string, string> = {
  'space-between': 'between',
  'space-around': 'around',
}
const DISPLAY = new Set([
  'none',
  'block',
  'flex',
  'grid',
  'inline',
  'inline-block',
  'inline-flex',
])
const to = (m: Record<string, string>, v: unknown) =>
  typeof v === 'string' && Object.hasOwn(m, v) ? m[v] : undefined

/** One layer rewritten, or undefined when nothing changed. A canonical key that is already set wins and the alias is dropped. */
function fixLayer(d: unknown, textual: boolean): unknown {
  if (!isObj(d)) return undefined
  const out: Record<string, unknown> = { ...d }
  let changed = false
  const al = textual ? to(ALIGN, out.align) : undefined
  if (al !== undefined) {
    if (out.textAlign === undefined) out.textAlign = al
    delete out.align
    changed = true
  }
  for (const [k, m] of [
    ['textAlign', SIDE],
    ['justify', JUSTIFY],
  ] as const) {
    const v = to(m, out[k])
    if (v !== undefined) {
      out[k] = v
      changed = true
    }
  }
  // display per layout: the existing `hidden`; an explicit `hidden` in the layer wins
  if (typeof out.display === 'string' && DISPLAY.has(out.display)) {
    if (out.hidden === undefined) out.hidden = out.display === 'none'
    delete out.display
    changed = true
  }
  return changed ? out : undefined
}

const isRadius = (v: unknown) =>
  typeof v === 'number' ||
  (Array.isArray(v) && v.length === 4 && v.every(x => typeof x === 'number'))

/** A rect shape's `style.base.radius` moves to `props.geometry.radius`; a geometry radius that is already set wins. */
function fixShape(n: Node): Node {
  const g = n.props?.geometry as { type?: string; radius?: unknown } | undefined
  const base = (n.style as { base?: Record<string, unknown> } | undefined)?.base
  if (
    n.kind !== 'shape' ||
    g?.type !== 'rect' ||
    !isObj(base) ||
    !isRadius(base.radius)
  )
    return n
  const { radius, ...rest } = base
  const style = { ...(n.style as object), base: rest }
  return {
    ...n,
    style: style as Node['style'],
    props: {
      ...n.props,
      geometry: { ...g, radius: g.radius === undefined ? radius : g.radius },
    },
  } as Node
}

function fixNode(n0: Node): Node {
  const n = fixShape(n0)
  const s = n.style as Record<string, unknown> | undefined
  const spec = kindSpec(n.kind)
  const textual =
    !!spec &&
    spec.styles.includes('textAlign') &&
    !spec.styles.includes('align')
  let style = s
  if (isObj(s)) {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'when' && Array.isArray(v)) {
        const w = v.map(x => {
          const f = isObj(x) ? fixLayer(x.decl, textual) : undefined
          return f === undefined ? x : { ...(x as object), decl: f }
        })
        if (w.some((x, i) => x !== v[i])) style = { ...style, when: w }
      } else {
        const f = fixLayer(v, textual)
        if (f !== undefined) style = { ...style, [k]: f }
      }
    }
  }
  const kids = n.children?.map(fixNode)
  const kidsSame = !kids || kids.every((c, i) => c === n.children![i])
  return style === s && kidsSame
    ? n
    : {
        ...n,
        ...(style === s ? {} : { style: style as Node['style'] }),
        ...(kidsSame ? {} : { children: kids }),
      }
}

/**
 * Rewrites the words agents use for Culm's own in every style layer of every tree, before validation. The same object when nothing changed;
 * changed nodes are copied, never mutated.
 * ponytail: override and variant patches and hand-written folder files already hold canonical forms; add them if a refusal shows otherwise.
 */
export function aliasStyles(doc: SiteDocument): SiteDocument {
  const header = fixNode(doc.header)
  const footer = fixNode(doc.footer)
  const pages = doc.pages.map(p => {
    const root = fixNode(p.root)
    return root === p.root ? p : { ...p, root }
  })
  const components = doc.components.map(c => {
    const root = fixNode(c.root)
    return root === c.root ? c : { ...c, root }
  })
  const same =
    header === doc.header &&
    footer === doc.footer &&
    pages.every((p, i) => p === doc.pages[i]) &&
    components.every((c, i) => c === doc.components[i])
  return same ? doc : { ...doc, header, footer, pages, components }
}
