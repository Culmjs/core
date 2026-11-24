// `write`: the JSX of a page, header or footer -> the operations that make the tree so. Pure: it reads the document and returns operations;
// the server sends them through core `apply`, so every check core makes still runs.
import {
  defaultSiteStyles,
  FONTS,
  fontSlug,
  type Node,
  type Problem,
  type Registry,
  type SiteDocument,
} from '@culmjs/core'
import { plan } from '@culmjs/core/ops'
import { ID_RE, isObj } from '../shared.ts'
import { JsxError, type El } from './parse.ts'
import { safeData, sourceElements, start, type Source } from './formats.ts'
import { KINDS } from '@culmjs/core'
import { reconcile, want, type Plan, type Want } from './tree.ts'
import {
  colour,
  firstFamily,
  normalise,
  pxOf,
  type FontNeed,
  type Warning,
} from './normalise.ts'

export type { Warning }
type Obj = Record<string, unknown>
function mergeFonts(list: unknown[]) {
  const merged = new Map<unknown, unknown>()
  for (const f of list) {
    const ref =
      isObj(f) && typeof f.google === 'string' ? `up:${fontSlug(f.google)}` : f
    const before = merged.get(ref)
    if (
      isObj(f) &&
      isObj(before) &&
      Array.isArray(f.weights) &&
      Array.isArray(before.weights)
    )
      merged.set(ref, {
        ...before,
        weights: [...new Set([...before.weights, ...f.weights])].sort(
          (a, b) => a - b,
        ),
      })
    else if (!merged.has(ref) || isObj(f)) merged.set(ref, f)
  }
  return [...merged.values()]
}
export type Tree = 'header' | 'footer' | { page: string }
export type Built =
  | {
      ok: true
      ops: Obj[]
      /** Every tree this write changes, in the order of the JSX. */
      trees: Tree[]
      /** The node replaced, in a write with a `target`. */
      target?: string
      plan: Plan
      offset: number
      /** The <Site> element, where the look's problems belong. */
      siteAt?: JsxError['at']
      /** Everything wrong in the JSX itself (an unknown element, a setting that is not one); the rest of the tree is still built. */
      errors: Problem[]
      /** Things that were written but will probably not look as meant; the write goes ahead. */
      warnings: Warning[]
    }
  | { ok: false; problems: Problem[] }

/** Two or more `width: "fill"` children of a row, none growing: they size by their content, not in equal parts. */
function fillWarnings(ws: Want[], out: Warning[] = []): Warning[] {
  for (const w of ws) {
    const row =
      w.kind === 'row' &&
      (w.layers.base as Obj | undefined)?.direction !== 'column'
    const fill = w.children.filter(
      c =>
        (c.layers.base as Obj | undefined)?.width === 'fill' &&
        !(c.extras.slot as Obj | undefined)?.grow,
    )
    if (row && fill.length > 1)
      out.push({
        message: `${fill.length} children of this row have width "fill"; they share the row by their content, not in equal parts. For equal parts use <Grid cols={${fill.length}}>, or slot={{grow:1}} on each child.`,
        jsx: { path: w.path, line: w.at.line, column: w.at.col },
      })
    fillWarnings(w.children, out)
  }
  return out
}

const problem = (
  message: string,
  jsx?: { line: number; col: number },
  path?: string,
) =>
  ({
    code: 'INVALID_OPERATION',
    message,
    ...(path ? { path } : {}),
    ...(jsx ? { jsx: { line: jsx.line, column: jsx.col } } : {}),
  }) as Problem
const jsxProblem = (e: JsxError) =>
  ({
    code: 'INVALID_OPERATION',
    message: e.message,
    jsx: {
      ...(e.path ? { path: e.path } : {}),
      line: e.at.line,
      column: e.at.col,
    },
  }) as Problem

/** `<Site fonts colors look />`: the setFonts, setLook and setSiteStyles that follow from it. */
function siteOps(
  el: El,
  doc: SiteDocument,
  weights: (
    refs: Record<string, 'heading' | 'body'>,
  ) => Record<'heading' | 'body', number[]>,
  theme?: unknown,
): Obj[] {
  if (el.children.length || el.text !== undefined || el.parts)
    throw new JsxError('<Site /> holds nothing between the tags.', el.at)
  const ops: Obj[] = []
  const a = (k: string) => el.attrs.get(k)
  for (const [k, v] of el.attrs)
    if (!['fonts', 'colors', 'look'].includes(k))
      throw new JsxError(
        `<Site> has fonts, colors and look; "${k}" is not one.`,
        v.at,
      )
  const objOf = (k: string) => {
    const x = a(k)
    if (x && !isObj(x.value))
      throw new JsxError(`${k} must be an object: {{ ... }}.`, x.at)
    return x ? (x.value as Obj) : undefined
  }
  const look: Obj = { ...objOf('look') }
  const fonts: Obj = { ...objOf('fonts') }
  for (const [role, field] of [
    ['heading', 'headingFont'],
    ['body', 'bodyFont'],
  ] as const) {
    if (look[field] !== undefined) {
      fonts[role] = look[field]
      delete look[field]
    }
    const value = fonts[role]
    if (typeof value === 'string' && !/^(?:sys|up|cat|google):/.test(value)) {
      const family = firstFamily(value)
      fonts[role] = family.startsWith('sys:')
        ? family
        : Object.hasOwn(FONTS, fontSlug(family))
          ? `cat:${fontSlug(family)}`
          : `google:${family}`
    }
  }
  if (look.corners !== undefined) {
    const n = look.corners === 'square' ? 0 : pxOf(look.corners)
    if (n === undefined || n < 0)
      throw new JsxError(
        'look.corners needs a nonnegative radius, e.g. "square", 0 or "8px".',
        el.at,
        'look.corners',
      )
    look.corners = n
  }
  for (const k of ['brand', 'ink', 'bg', 'accent'])
    if (look[k] !== undefined) look[k] = colour(look[k]) ?? look[k]
  if (typeof look.dark === 'boolean') look.dark = look.dark ? 'dark' : 'light'
  if (Object.keys(fonts).length) {
    const list: unknown[] = []
    const refs: Record<string, unknown> = {}
    const roles: Record<string, 'heading' | 'body'> = {}
    const later: [{ weights: number[] }, 'heading' | 'body'][] = []
    for (const [role, field] of [
      ['heading', 'headingFont'],
      ['body', 'bodyFont'],
    ] as const) {
      const f = fonts[role]
      if (f === undefined) continue
      if (typeof f !== 'string')
        throw new JsxError(
          `fonts.${role} must be a text like "google:Roboto Slab" or "sys:serif".`,
          el.at,
        )
      if (f.startsWith('google:')) {
        const family = f.slice(7)
        if (!/^[A-Za-z0-9 ]{1,64}$/.test(family) || !fontSlug(family))
          throw new JsxError(
            `fonts.${role}: "${family}" is not a family name (letters, digits, spaces).`,
            el.at,
          )
        refs[field] = `up:${fontSlug(family)}`
        roles[refs[field] as string] = role
        const entry = { google: family, weights: [] as number[] }
        later.push([entry, role])
        list.push(entry)
      } else {
        refs[field] = f
        list.push(f)
      }
    }
    const wt = weights(roles)
    for (const [entry, role] of later) entry.weights = wt[role]
    for (const k of Object.keys(fonts))
      if (k !== 'heading' && k !== 'body')
        throw new JsxError(
          `fonts has heading and body; "${k}" is not one.`,
          a('fonts')!.at,
        )
    const keep = doc.fonts.filter(f => !Object.values(refs).includes(f))
    ops.push({ op: 'setFonts', fonts: mergeFonts([...list, ...keep]) })
    Object.assign(look, refs)
  }
  if (Object.keys(look).length)
    ops.push({ op: 'setLook', look: { ...doc.look, ...look } })
  const colors = objOf('colors')
  if (colors) {
    const have = (doc.styles ?? defaultSiteStyles(doc.look)).colors
    const next = have.map(c => ({ ...c }))
    for (const [id, value] of Object.entries(colors)) {
      if (typeof value !== 'string')
        throw new JsxError(
          `colors.${id} must be a #rrggbb text.`,
          a('colors')!.at,
        )
      const c = next.find(x => x.id === id)
      if (c) c.value = (colour(value) ?? value) as never
      else
        next.push({
          id,
          name: id[0]!.toUpperCase() + id.slice(1),
          value: (colour(value) ?? value) as never,
        })
    }
    ops.push({ op: 'setSiteStyles', styles: { colors: next } })
  }
  if (isObj(theme) && doc.styles) {
    // Registered blocks may refer to named colours and text presets instead of
    // look tokens. Keep only the explicitly changed roles in sync.
    const preset: Obj = {}
    if (theme.headingFont !== undefined || theme.bodyFont !== undefined) {
      preset.text = doc.styles.text.map(t => {
        const role = /^h[1-6]$/.test(t.id) ? 'headingFont' : 'bodyFont'
        return theme[role] !== undefined
          ? { ...t, decl: { ...t.decl, font: look[role] } }
          : t
      })
    }
    const existing = ops.find(op => op.op === 'setSiteStyles')
    if (['brand', 'ink', 'bg'].some(k => theme[k] !== undefined)) {
      const palette =
        (existing?.styles as { colors: typeof doc.styles.colors } | undefined)
          ?.colors ?? doc.styles.colors
      preset.colors = palette.map(c => {
        const role = c.id === 'canvas' ? 'bg' : c.id
        return ['brand', 'ink', 'bg'].includes(role) &&
          theme[role] !== undefined &&
          colors?.[c.id] === undefined
          ? { ...c, value: look[role] }
          : c
      })
    }
    if (Object.keys(preset).length) {
      if (existing) Object.assign(existing.styles as Obj, preset)
      else ops.push({ op: 'setSiteStyles', styles: preset })
    }
  }
  return ops
}

/**
 * The font weights (100 to 900) each role of the site writes, found in the wants and the site's text styles. A heading Text (h1 to h6), and any
 * node whose `font` is the role's family, counts for that role; everything else is body. Both roles always get 400 and 700; a weight the
 * family lacks is skipped by the fetch, so asking for too many is harmless but asking for the wrong role's is not needed.
 */
function weightsByRole(wants: Want[], doc: SiteDocument) {
  const found = { heading: new Set([400, 700]), body: new Set([400, 700]) }
  const ok = (x: unknown): x is number =>
    typeof x === 'number' && x % 100 === 0 && x >= 100 && x <= 900
  const fonts = (n: { layers?: Obj }) =>
    Object.values(n.layers ?? {}).flatMap(l =>
      isObj(l) && typeof l.font === 'string' ? [l.font] : [],
    )
  const weights = (n: { layers?: Obj; props?: Obj }) => [
    ...Object.values(n.layers ?? {}).flatMap(l =>
      isObj(l) && ok(l.weight) ? [l.weight] : [],
    ),
    // a mark inside a Text (<b>, a style on a <span>) has a weight of its own
    ...(Array.isArray(n.props?.runs)
      ? (n.props.runs as unknown[])
      : []
    ).flatMap(r =>
      isObj(r) && isObj(r.style) && ok(r.style.weight) ? [r.style.weight] : [],
    ),
  ]
  const walk = (ws: Want[], refs: Record<string, 'heading' | 'body'>) => {
    for (const w of ws) {
      const own = fonts(w)
        .map(f => refs[f])
        .find(Boolean)
      const role =
        own ??
        (w.kind === 'text' && /^h[1-6]$/.test(String(w.props.level))
          ? 'heading'
          : 'body')
      for (const x of weights(w)) found[role].add(x)
      walk(w.children, refs)
    }
  }
  return (refs: Record<string, 'heading' | 'body'>) => {
    walk(wants, refs)
    for (const t of doc.styles?.text ?? [])
      if (ok(t.decl.weight))
        found[/^h[1-6]$/.test(t.id) ? 'heading' : 'body'].add(t.decl.weight)
    const sorted = (x: Set<number>) => [...x].sort((a, b) => a - b)
    return { heading: sorted(found.heading), body: sorted(found.body) }
  }
}

const SITE_PARTS = ['Header', 'Footer', 'Page']
const pageIdOf = (path: string) =>
  path === '/'
    ? 'home'
    : path
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20)

/** What one tree is to hold, in the author's words. */
type Raw = {
  key: 'header' | 'footer' | { page: string; title?: string; slug?: string }
  wants: Want[]
  /** A write with `target`: the node replaced, its parent and its place there. */
  tgt?: { parent: Node; old: Node; shift: number }
}
const findParent = (n: Node, id: string): Node | undefined => {
  for (const c of n.children ?? []) {
    if (c.id === id) return n
    const r = findParent(c, id)
    if (r) return r
  }
}

export function buildWrite(
  doc: SiteDocument,
  registry: Registry,
  a: Source & {
    page?: string
    theme?: unknown
    title?: string
    path?: string
    target?: string
    append?: boolean
  },
): Built {
  let els: El[]
  const errs: JsxError[] = []
  const warns: Warning[] = []
  try {
    els = sourceElements(a, errs, warns)
    if (a.theme !== undefined) {
      if (!isObj(a.theme))
        throw new JsxError('theme must be an object.', start, 'theme')
      safeData(a.theme, 'theme')
      if (els[0]?.name === 'Site' && els[0].attrs.has('look'))
        throw new JsxError(
          'Supply theme or Site.look, not both.',
          start,
          'theme',
        )
      if (els[0]?.name !== 'Site')
        els.unshift({ name: 'Site', at: start, attrs: new Map(), children: [] })
      els[0]!.attrs.set('look', { at: start, value: a.theme })
    }
  } catch (e) {
    if (e instanceof JsxError) return { ok: false, problems: [jsxProblem(e)] }
    throw e
  }
  const first = els[0]?.name === 'Site' ? els.shift()! : undefined
  const siteMode = els.some(e => SITE_PARTS.includes(e.name))
  const refuse = (
    message: string,
    at?: JsxError['at'],
    path?: string,
  ): Built => ({
    ok: false,
    problems: [
      at
        ? jsxProblem(new JsxError(message, at, path))
        : problem(message, undefined, path),
    ],
  })
  const wantsOf = (list: El[], prefix: string) =>
    list.flatMap((e, i) => {
      const w = want(e, i, prefix, errs, warns)
      return w ? [w] : []
    })

  const raws: Raw[] = []
  let target = a.target
  if (
    a.append &&
    (siteMode ||
      a.target !== undefined ||
      !a.page ||
      ['header', 'footer'].includes(a.page) ||
      !els.length)
  )
    return refuse(
      'append takes a page id and one or more section elements.',
      undefined,
      'append',
    )
  if (siteMode) {
    if (a.target !== undefined)
      return refuse(
        'A write with target takes one element, not <Header>, <Footer> or <Page>.',
        undefined,
        'target',
      )
    const seen = new Set<string>()
    for (const [i, e] of els.entries()) {
      if (!SITE_PARTS.includes(e.name))
        return refuse(
          `A whole-site write holds <Site>, <Header>, <Footer> and <Page> only; <${e.name}> goes inside one of them.`,
          e.at,
        )
      const prefix = `${e.name}[${i}]`
      if (e.text !== undefined || e.parts)
        return refuse(`<${e.name}> holds elements, not text.`, e.at, prefix)
      const known = e.name === 'Page' ? ['id', 'path', 'title'] : []
      for (const [k, v] of e.attrs)
        if (!known.includes(k))
          return refuse(
            e.name === 'Page'
              ? `<Page> has id, path and title; "${k}" is not one.`
              : `<${e.name}> has no attributes; "${k}" is not one.`,
            v.at,
            prefix,
          )
      let key: Raw['key']
      if (e.name === 'Page') {
        const text = (k: string) => {
          const v = e.attrs.get(k)
          if (v && typeof v.value !== 'string')
            throw new JsxError(`${k} must be a text.`, v.at, prefix)
          return v?.value as string | undefined
        }
        try {
          const path =
            text('path') ??
            a.path ??
            (a.page
              ? (doc.pages.find(p => p.id === a.page)?.slug ??
                (a.page === 'home' ? '/' : `/${a.page}`))
              : '/')
          const title = text('title')
          key = {
            page:
              text('id') ??
              a.page ??
              doc.pages.find(p => p.slug === path)?.id ??
              pageIdOf(path),
            ...(title !== undefined || a.title !== undefined
              ? { title: title ?? a.title }
              : {}),
            slug: path,
          }
        } catch (x) {
          if (x instanceof JsxError)
            return { ok: false, problems: [jsxProblem(x)] }
          throw x
        }
      } else key = e.name.toLowerCase() as 'header' | 'footer'
      const id = typeof key === 'string' ? key : key.page
      if (seen.has(id))
        return refuse(`"${id}" is written twice in this write.`, e.at, prefix)
      seen.add(id)
      raws.push({ key, wants: wantsOf(e.children, prefix) })
    }
  } else if (target !== undefined) {
    if (els.length !== 1)
      return refuse(
        'A write with target holds exactly one element: the one that replaces it.',
        els[1]?.at,
      )
    const trees: [Raw['key'], Node][] = [
      ['header', doc.header],
      ['footer', doc.footer],
      ...doc.pages.map(p => [{ page: p.id }, p.root] as [Raw['key'], Node]),
    ]
    if (
      target.endsWith('.root') &&
      !trees.some(([, root]) => findParent(root, target!))
    )
      target = target.slice(0, -5)
    for (const [key, root] of trees) {
      const parent = findParent(root, target)
      if (!parent) continue
      const name = typeof key === 'string' ? key : key.page
      if (typeof a.page === 'string' && a.page !== name)
        return refuse(
          `"${a.target}" is in "${name}", not in "${a.page}"; leave page out.`,
          undefined,
          'page',
        )
      const old = parent.children!.find(c => c.id === target)!
      const wants = wantsOf(els, '')
      if (wants[0] && wants[0].id === undefined) wants[0].id = target
      raws.push({
        key,
        wants,
        tgt: { parent, old, shift: parent.children!.indexOf(old) },
      })
      break
    }
    if (!raws.length)
      return refuse(
        `There is no node with id "${a.target}". Use find to get the id.`,
        undefined,
        'target',
      )
  } else if (!first || els.length) {
    const page =
      a.page ??
      (a.html !== undefined || a.json !== undefined ? 'home' : undefined)
    if (typeof page !== 'string')
      return refuse(
        'page must be a page id, "header" or "footer".',
        undefined,
        'page',
      )
    raws.push({
      key:
        page === 'header' || page === 'footer'
          ? page
          : {
              page,
              ...(a.title !== undefined ? { title: a.title } : {}),
              ...(a.path !== undefined ? { slug: a.path } : {}),
            },
      wants: wantsOf(els, ''),
    })
  }

  const all = raws.flatMap(r => r.wants)
  // CSS-style values into Culm's forms (a font the site lacks is added to its fonts)
  const siteRefs = new Set<string>()
  const fa = first?.attrs.get('fonts')?.value
  if (isObj(fa))
    for (const v of Object.values(fa))
      if (typeof v === 'string')
        siteRefs.add(v.startsWith('google:') ? `up:${fontSlug(v.slice(7))}` : v)
  const needs = new Map<string, FontNeed | 'cat'>()
  normalise(all, { doc, siteRefs, warns, needs })

  let site: Obj[] = []
  let siteAt: JsxError['at'] | undefined
  // a new site's page is white, as a page written in CSS is (the starter's off-white is for sites that never had a write)
  const base =
    doc.look.bg === '#fafaf9'
      ? { ...doc, look: { ...doc.look, bg: '#ffffff' } }
      : doc
  if (first) {
    siteAt = first.at
    try {
      site = siteOps(first, base, weightsByRole(all, doc), a.theme)
    } catch (e) {
      if (!(e instanceof JsxError)) throw e
      errs.push(new JsxError(e.message, e.at, e.path ?? 'Site[0]'))
    }
  }
  // the site centres a block with a max width, as a web page does
  const pre: Obj[] = [
    ...(doc.centreMaxWidth === true
      ? []
      : [{ op: 'setSite', centreMaxWidth: true }]),
    ...(base !== doc && !site.some(o => o.op === 'setLook')
      ? [{ op: 'setLook', look: base.look }]
      : []),
    ...site,
  ]
  if (needs.size) {
    const added = [...needs].map(([ref, n]) =>
      n === 'cat'
        ? ref
        : { google: n.family, weights: [...n.weights].sort((x, y) => x - y) },
    )
    const op = pre.find(o => o.op === 'setFonts')
    if (op) op.fonts = mergeFonts([...(op.fonts as unknown[]), ...added])
    else pre.push({ op: 'setFonts', fonts: [...doc.fonts, ...added] })
  }

  // where each tree's root is, and what comes before its operations
  type Spec = { tree: Tree; root: Node; pre: Obj[]; raw: Raw }
  const specs: Spec[] = []
  const adds: Obj[] = []
  for (const raw of raws) {
    const { key } = raw
    if (raw.tgt) {
      const tree: Tree = typeof key === 'string' ? key : { page: key.page }
      specs.push({
        tree,
        root: { ...raw.tgt.parent, children: [raw.tgt.old] },
        pre: [],
        raw,
      })
    } else if (typeof key === 'string') {
      const root = doc[key]
      const stripped: Obj[] = []
      // the starter's root is padded, ruled and centred; the JSX cannot reach it, so what it draws is the author's: the first element fills the bar
      for (const L of ['base', 'tablet', 'phone'] as const) {
        const have = (root.style?.[L] ?? {}) as Obj
        const decl = Object.fromEntries(
          ['padding', 'border', 'align']
            .filter(k => have[k] !== undefined)
            .map(k => [k, null]),
        )
        if (Object.keys(decl).length)
          stripped.push({
            op: 'setStyle',
            tree: key,
            id: root.id,
            layer: L,
            decl,
          })
      }
      specs.push({ tree: key, root, pre: stripped, raw })
    } else {
      if (!ID_RE.test(key.page))
        return refuse(
          'page must be "header", "footer" or a page id of 1 to 20 lowercase letters or digits.',
          undefined,
          'page',
        )
      const have = doc.pages.find(p => p.id === key.page)
      if (have) {
        const set: Obj = {}
        if (key.title !== undefined && key.title !== have.title)
          set.title = key.title
        if (key.slug !== undefined && key.slug !== have.slug)
          set.slug = key.slug
        specs.push({
          tree: { page: key.page },
          root: have.root,
          pre: Object.keys(set).length
            ? [{ op: 'setPage', page: key.page, ...set }]
            : [],
          raw,
        })
      } else {
        adds.push({
          op: 'addPage',
          page: key.page,
          title: key.title ?? key.page[0]!.toUpperCase() + key.page.slice(1),
          slug: key.slug ?? (key.page === 'home' ? '/' : `/${key.page}`),
          inMenu: true,
        })
        specs.push({
          tree: { page: key.page },
          root: undefined as never,
          pre: [],
          raw,
        })
      }
    }
  }
  if (adds.length) {
    // the new pages' root ids are core's to choose: ask it, with all the pages at once
    const r = plan(doc, registry, {
      site: 'x',
      baseRevision: 0,
      key: 'x',
      ops: adds as never[],
    })
    if (!r.ok) return { ok: false, problems: r.problems }
    for (const sp of specs)
      if (!sp.root && typeof sp.tree === 'object')
        sp.root = r.doc.pages.find(
          p => p.id === (sp.tree as { page: string }).page,
        )!.root
  }
  // the ids already taken in the id space of header, footer and pages
  const used = new Set<string>()
  const collect = (n: Node) => {
    used.add(n.id)
    n.children?.forEach(collect)
  }
  for (const r of [doc.header, doc.footer, ...doc.pages.map(p => p.root)])
    collect(r)
  const entries: Plan['entries'] = [...pre, ...adds].map(op => ({ op }))
  const byId = new Map<string, Want>()
  const kinds = new Map<string, string>()
  for (const sp of specs) {
    used.add(sp.root.id)
    entries.push(...sp.pre.map(op => ({ op })))
    // Reconcile new sections against an empty slice, not against existing siblings.
    const made = reconcile(
      sp.tree,
      a.append ? { ...sp.root, children: [] } : sp.root,
      sp.raw.wants,
      used,
    )
    const shift = a.append ? (sp.root.children?.length ?? 0) : sp.raw.tgt?.shift
    if (shift)
      // the replaced node's place among its siblings
      for (const e of made.entries)
        if (
          (e.op.op === 'add' || e.op.op === 'move') &&
          e.op.parent === sp.root.id
        )
          e.op.index = (e.op.index as number) + shift
    entries.push(...made.entries)
    made.byId.forEach((w, id) => byId.set(id, w))
    made.kinds.forEach((k, id) => kinds.set(id, k))
  }
  return {
    ok: true,
    ops: entries.map(e => e.op),
    trees: specs.map(sp => sp.tree),
    ...(target !== undefined ? { target } : {}),
    plan: { entries, byId, kinds },
    offset: 0,
    ...(siteAt ? { siteAt } : {}),
    errors: errs.map(jsxProblem),
    warnings: [...warns, ...fillWarnings(all)],
  }
}

const STYLE_LAYER = /^style\.(\w+)\.(\w+)/
const nameOfKind = (k: string) =>
  k
    .split('-')
    .map(s => s[0]!.toUpperCase() + s.slice(1))
    .join('')

/** A problem of core with the element and the place in the JSX it belongs to, and a way to put it right where one is known. */
export function locate(b: Extract<Built, { ok: true }>, p: Problem): Problem {
  const x = p as Problem & { fix?: string; jsx?: unknown }
  const entry = p.op === undefined ? undefined : b.plan.entries[p.op - b.offset]
  let w: Want | undefined = p.nodeId ? b.plan.byId.get(p.nodeId) : undefined
  if (!w && p.op !== undefined) {
    w = entry?.want
    const m = /^node((?:\.children\.\d+)*)/.exec(p.path ?? '')
    if (w && m?.[1])
      for (const i of m[1].split('.children.').slice(1))
        w = w.children[Number(i)] ?? w
  }
  const kind = w?.kind ?? (p.nodeId ? b.plan.kinds.get(p.nodeId) : undefined)
  const spec = kind ? KINDS[kind as keyof typeof KINDS] : undefined
  const style = STYLE_LAYER.exec(p.path ?? '')
  if (spec && style) {
    const key = style[2]!
    if (/not a style property|does not apply/.test(p.message))
      x.fix =
        Object.hasOwn(spec.props, key) || /^(tablet|phone)?[cC]ols$/.test(key)
          ? `"${key}" is a setting, not a style: write it as an attribute of <${nameOfKind(kind!)}> (${Object.keys(spec.props).join(', ')}).`
          : `<${nameOfKind(kind!)}> takes these styles: ${spec.styles.join(', ')}.`
  }
  if (p.path?.endsWith('.font') && !x.fix)
    x.fix =
      'Set a Google family once in <Site fonts={{ heading: "google:Name", body: "google:Name" }} /> and write it in a style as font: "up:name-in-lower-case-dashes"; sys:sans, sys:serif and sys:mono need nothing.'
  if (p.path === 'look' && b.siteAt)
    x.jsx = { path: 'Site[0]', line: b.siteAt.line, column: b.siteAt.col }
  else if (w) x.jsx = { path: w.path, line: w.at.line, column: w.at.col }
  if (p.rule === 'required' && p.nodeId && !w && b.plan.kinds.has(p.nodeId))
    x.fix = `Keep it: write <${nameOfKind(b.plan.kinds.get(p.nodeId)!)} id="${p.nodeId}" ... /> inside this tree (read format jsx shows it); its place and the layout round it are yours.`
  if (
    /must be 1 to 20 lowercase letters and digits/.test(p.message) &&
    p.nodeId?.includes('.')
  )
    x.fix =
      'An id with a dot lives inside the block the tree came with. Keep the first element of the read (its id has no dot, such as "hd") as the top element and put the rest inside it.'
  if (/cannot hold other nodes/.test(p.message))
    x.fix =
      'A Text, Image, Icon, Divider, Menu or Field holds no elements; put them beside it.'
  return entry?.editIndex === undefined ? x : { ...x, op: entry.editIndex }
}

/** Every problem of a write at once: what is wrong in the JSX itself, then what core refuses when the rest is checked as `apply` checks it. Sorted by place. */
export function diagnose(
  b: Extract<Built, { ok: true }>,
  doc: SiteDocument,
  registry: Registry,
  allow?: Parameters<typeof plan>[3],
): Problem[] {
  const out = [...b.errors]
  if (b.ops.length) {
    // a Google family is fetched by the server later; core is asked about the name it will get
    const ops = previewOps(b.ops)
    const r = plan(
      doc,
      registry,
      { site: 'x', baseRevision: 0, key: 'x', ops: ops as never },
      allow,
    )
    if (!r.ok)
      out.push(
        ...r.problems
          // a node lost only because its element had an error is not a second problem
          .filter(p => !(b.errors.length && p.rule === 'required'))
          .map(p => locate(b, p)),
      )
  }
  const at = (p: Problem) =>
    (p as { jsx?: { line: number; column: number } }).jsx
  const seen = new Set<string>()
  return out
    .filter(p => {
      const k = `${p.message}|${JSON.stringify((p as { jsx?: unknown }).jsx)}|${p.path}|${p.nodeId}`
      return seen.has(k) ? false : (seen.add(k), true)
    })
    .sort(
      (p, q) =>
        (at(p)?.line ?? 0) - (at(q)?.line ?? 0) ||
        (at(p)?.column ?? 0) - (at(q)?.column ?? 0),
    )
}

export const previewOps = (ops: Obj[]) =>
  ops.map(o =>
    o.op === 'setFonts'
      ? {
          ...o,
          fonts: (o.fonts as unknown[]).map(f =>
            isObj(f) && typeof f.google === 'string'
              ? `up:${fontSlug(f.google)}`
              : f,
          ),
        }
      : o,
  )
