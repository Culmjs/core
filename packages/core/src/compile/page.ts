import {
  walk,
  type Node,
  type Problem,
  type SiteDocument,
} from '../document/index.ts'
import { dropSamples } from '../document/samples.ts'
import { nodeCanShow } from '../document/visibility.ts'
import { isObj, urlOk } from '../document/rules.ts'
import { expand, type Data } from '../data/index.ts'
import { checkRows, type Registry } from '../registry/index.ts'
import { BASE_CSS } from '../style/baseCss.ts'
import { STATES } from '../style/decl.ts'
import { stylesOf } from '../style/siteStyles.ts'
import type { SiteIcons } from './siteIcon.ts'
import { fontFaceCss, fontFamily, type SiteFonts } from '../style/fonts.ts'
import type { FontRef } from '../document/index.ts'
import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
  TIMELINE_SCRIPT,
  GPU_HOST_SCRIPT,
  GPU_LOADER_SCRIPT,
  GPU_HOST_PATH,
} from '../scripts/index.ts'
import { checkedSite } from '../validate/validate.ts'
import { BUDGETS, byteLength, checkBudgets, type PageStats } from './budgets.ts'
import { PLAYBACK_TIMELINE_SCRIPT } from '../scripts/scriptsMin.ts'
import { el } from './elementsBase.ts'
import {
  stateAttrs,
  toElements,
  triggerTargets,
  type ElementCtx,
} from './elements.ts'
import { writeHtml, type HtmlNode } from './html.ts'
import { type Links } from './links.ts'
import { prepareStyles } from './styles.ts'
import { motionCss } from './motion.ts'
import { lowerGpu } from './gpu.ts'
import type { CheckedEffect } from '../validate/gpu.ts'
import {
  executableHashes,
  scriptPolicy,
  withPolicy,
  type PageScript,
} from './gpuPolicy.ts'

export type CompileOptions = {
  registry: Registry
  data?: Data
  /** `measure` is live plus a `data-id` on every node, for the probe; it is never written to a site. */
  mode?: 'live' | 'edit' | 'measure'
  links?: Links
  /** Confirmed local media pathnames. A missing poster keeps the authored background.
   * Without an inventory, posters use the checked local Links.file result. */
  availableMedia?: ReadonlySet<string>
  lang?: string
  fontBase?: string
  /** The fonts the site's folder holds (`up:<name>`), read by the tools; core opens no file. */
  fonts?: SiteFonts
  /** The icons the site's folder holds (`set:name`), read by the tools; core opens no file. */
  icons?: SiteIcons
}

export type CompiledAsset = { path: string; content: string }
export type CompiledPage =
  | {
      ok: true
      html: string
      css: string
      scripts: PageScript[]
      assets?: CompiledAsset[]
      gpu?: { usesWasm: boolean }
      stats: PageStats
      problems: Problem[]
    }
  | { ok: false; problems: Problem[] }

/** The problem for a compile step that threw: the layout and style code can throw on a value that passed the checks. */
export const failed = (pageId: string, e: unknown): Problem[] => [
  {
    code: 'INVALID_DOCUMENT',
    message: `Page "${pageId}" could not be compiled: ${e instanceof Error ? e.message : String(e)}`,
  },
]

/** Problems with the options, the document, or the rows supplied for a registered source; empty when the compile may go on. Every entry point checks through here. */
export function checkedInput(doc: SiteDocument, options: CompileOptions) {
  const { registry, data } = options
  const bad = optionProblems(options)
  const checked = checkedSite(doc, registry)
  const problems = [...bad, ...checked.problems]
  if (problems.length || !checked.doc) return { doc, problems }
  const rows =
    isObj(data) && (isObj(data.rows) || Array.isArray(data.rows))
      ? data.rows
      : {}
  return {
    doc: checked.doc,
    effects: checked.effects,
    problems: registry
      .sources()
      .flatMap(s =>
        Object.hasOwn(rows, s.name) ? checkRows(s, rows[s.name]) : [],
      ),
  }
}

/** The problem for a page that expansion cut at the element or depth limit: the same for every entry point. */
export const cutProblems = (over: boolean): Problem[] =>
  over
    ? [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          path: 'elements',
          message: `The page was cut at ${BUDGETS.elements} elements or ${BUDGETS.depth} levels.`,
        },
      ]
    : []

/** A font address is written bare into `url(...)`: it must be a plain path or address. */
export function optionProblems(o: CompileOptions): Problem[] {
  const f = o.fontBase
  const bad = (message: string, path: string): Problem => ({
    code: 'INVALID_DOCUMENT',
    message,
    path,
  })
  return [
    ...(o.mode === undefined ||
    o.mode === 'live' ||
    o.mode === 'edit' ||
    o.mode === 'measure'
      ? []
      : [bad('mode must be "live", "edit" or "measure".', 'mode')]),
    ...(f === undefined ||
    (typeof f === 'string' && urlOk(f) && !/["'()\\;{}<>\s]/.test(f))
      ? []
      : [bad('fontBase must be a plain path or web address.', 'fontBase')]),
  ]
}

/** Defaults and what follows from the document: a page is at its slug. */
export function resolve(doc: SiteDocument, o: CompileOptions) {
  const L = o.links
  const lang = o.lang ?? doc.languages?.[0]?.code ?? 'en'
  return {
    // measure is live in every branch; `ids` is the one place it differs
    mode: o.mode === 'edit' ? ('edit' as const) : ('live' as const),
    ids: o.mode === 'measure',
    availableMedia: o.availableMedia,
    links: {
      // wrapped, not spread: a class instance keeps its prototype methods and their `this`
      page: (slug: string) => (L ? L.page(slug) : slug),
      ...(L?.form ? { form: () => (L.form as () => string)() } : {}),
      // checked once here, so image, video and background image all get undefined for an unsafe address
      file: (id: string) => {
        const f = L?.file(id)
        return f !== undefined && urlOk(f) ? f : undefined
      },
    } satisfies Links,
    lang,
    rtl: doc.languages?.find(l => l.code === lang)?.dir === 'rtl',
    fontBase: o.fontBase ?? '/_fonts',
    fonts: o.fonts,
    icons: o.icons,
    data: o.data ?? { rows: {} },
    kinds: o.registry.kinds(),
  }
}

const SHELL = 's-shell'

/** Expands the roots, then compiles them as one tree so they share a style block and its classes. */
export function prepare(
  doc: SiteDocument,
  roots: Node[],
  o: CompileOptions,
  prefix?: string,
) {
  const r = resolve(doc, o)
  const styles = stylesOf(doc)
  const done = roots.map(root =>
    expand(root, {
      kinds: r.kinds,
      data: r.data,
      components: doc.components,
      fonts: doc.fonts,
      styles,
    }),
  )
  // A published page leaves out untouched sample content; the editor keeps it, it says what to write.
  if (r.mode === 'live') for (const d of done) d.tree = dropSamples(d.tree)
  const shell: Node = {
    id: SHELL,
    kind: 'box',
    name: 'Shell',
    slot: {},
    children: done.map(d => d.tree),
  }
  const stylesForPage = prepareStyles(shell, {
    look: doc.look,
    centre: doc.centreMaxWidth === true,
    mode: r.mode,
    styles: doc.styles,
    dir: r.rtl ? 'rtl' : undefined,
    kinds: r.kinds,
    prefix,
    style: {
      fileUrl: r.links.file,
      fontFamily: ref => fontFamily(ref, r.fonts),
    },
  })
  stylesForPage.classOf.delete(SHELL)
  return {
    ...r,
    shell,
    trees: done.map(d => d.tree),
    ...stylesForPage,
    depth: Math.max(...done.map(d => d.depth)),
    over: done.some(d => d.over),
  }
}

/** Every font the look, the styles and the runs of the trees name, once each. */
export function fontsOf(doc: SiteDocument, shell: Node): FontRef[] {
  const fonts = new Set<FontRef>([doc.look.headingFont, doc.look.bodyFont])
  if (doc.look.labelFont) fonts.add(doc.look.labelFont)
  walk(shell, w => {
    const s = w.style
    for (const k of STATES) {
      const f = s?.[k]?.font
      if (f) fonts.add(f)
    }
    for (const x of s?.when ?? []) if (x.decl.font) fonts.add(x.decl.font)
    const ts =
      w.kind === 'text'
        ? doc.styles?.text.find(x => x.id === w.props?.textStyle)?.decl.font
        : undefined
    if (ts) fonts.add(ts)
    const runs = w.props?.runs
    if (Array.isArray(runs))
      for (const r of runs)
        if (r && typeof r === 'object' && 'text' in r && r.style?.font)
          fonts.add(r.style.font)
    const marks = w.props?.marks
    if (Array.isArray(marks))
      for (const m of marks)
        if (
          m &&
          typeof m === 'object' &&
          'font' in m &&
          typeof m.font === 'string'
        )
          fonts.add(m.font as FontRef)
  })
  return [...fonts]
}

const anyElement = (
  e: HtmlNode | string,
  f: (e: HtmlNode) => boolean,
): boolean =>
  typeof e !== 'string' &&
  (f(e) || (e.children ?? []).some(c => anyElement(c, f)))
// The GPU reservation counts inside SVG glyphs too. Their checked raw bodies
// contain only SVG tags and local drawing attributes; never scan script/data.
const countElements = (e: HtmlNode | string, glyphs: boolean): number =>
  typeof e === 'string'
    ? 0
    : 1 +
      (glyphs && e.raw?.kind === 'icon'
        ? (e.raw.content.match(/<[a-z]/g)?.length ?? 0)
        : 0) +
      (e.children ?? []).reduce((n, c) => n + countElements(c, glyphs), 0)

/** A published header or footer with nothing in it, or hidden, draws no strip. The editor always keeps both, so there is somewhere to drop blocks. */
const shows = (w: Node, mode: 'edit' | 'live') =>
  mode === 'edit' || (!!w.children?.length && nodeCanShow(w))

type Prepared = ReturnType<typeof prepare>

/** The site wrapper with the three trees in it, as the page and the editor's subtrees both draw it. */
export function siteElement(
  doc: SiteDocument,
  page: SiteDocument['pages'][number],
  p: Prepared,
  mail: { used: boolean },
  rendered?: Map<Node, HtmlNode>,
): HtmlNode {
  const [root, header, footer] = p.trees
  const { mode } = p
  const ctx: ElementCtx = {
    classOf: p.classOf,
    rendered,
    doc,
    links: p.links,
    ...(p.fonts ? { fonts: p.fonts } : {}),
    availableMedia: p.availableMedia,
    ...(p.icons ? { icons: p.icons } : {}),
    mode,
    ...(p.ids ? { ids: true } : {}),
    kinds: p.kinds,
    // the editor shows the address as written; its page has no script to join it
    ...(mode === 'live' ? { mail } : {}),
    current: page.id,
    targets: triggerTargets(header, root, footer),
  }
  const strip = (tag: string, cls: string, tree: Node, holds?: true) =>
    el(tag, { class: cls }, [toElements(tree, holds ? { ...ctx, holds } : ctx)])
  return el(
    'div',
    {
      class: `s-site s-scheme-${doc.look.dark}${mode === 'live' ? ' s-site--live' : ''}`,
      // The header root's states are site-wide, so they sit on this wrapper; the page and footer hold their own where they are.
      ...stateAttrs(header),
    },
    [
      shows(header, mode) && strip('header', 's-header', header, true),
      el('main', {}, [toElements(root, ctx)]),
      shows(footer, mode) && strip('footer', 's-footer', footer),
    ],
  )
}

export function compilePage(
  doc: SiteDocument,
  pageId: string,
  options: CompileOptions,
): CompiledPage {
  try {
    const { doc: projected, effects, problems } = checkedInput(doc, options)
    if (problems.length) return { ok: false, problems }
    const page = projected.pages.find(p => p.id === pageId)
    if (!page)
      return {
        ok: false,
        problems: [
          {
            code: 'INVALID_DOCUMENT',
            message: `There is no page "${pageId}".`,
            path: 'pages',
          },
        ],
      }
    return build(projected, page, options, effects)
  } catch (e) {
    return { ok: false, problems: failed(pageId, e) }
  }
}

export function build(
  doc: SiteDocument,
  page: SiteDocument['pages'][number],
  options: CompileOptions,
  effects: ReadonlyMap<string, CheckedEffect> | undefined,
  siteHashes?: Set<string>,
): CompiledPage {
  const p = prepare(doc, [page.root, doc.header, doc.footer], options)
  const { mode } = p
  const mail = { used: false }
  let hasGpu = false,
    hasSteps = false
  if (mode === 'live')
    for (const tree of p.trees)
      walk(tree, w => {
        if (w.motion) {
          if ('gpu' in w.motion) hasGpu = page.on
          else hasSteps = true
        }
      })
  const rendered = hasGpu || hasSteps ? new Map<Node, HtmlNode>() : undefined
  const site = siteElement(doc, page, p, mail, rendered)
  const motion =
    hasSteps && rendered
      ? motionCss(p.trees, site, rendered, options.registry, p)
      : undefined
  if (motion?.problems.length) return { ok: false, problems: motion.problems }
  // Pin meters, their table/list wrappers and compound path geometry are now
  // in the emitted tree. GPU lowering only adds attributes to this subtree.
  const siteCount = countElements(site, hasGpu)
  const gpu =
    hasGpu && rendered && effects
      ? lowerGpu(
          site,
          rendered,
          p,
          effects,
          siteCount + 3 <= BUDGETS.elements,
          options.availableMedia,
          options.registry.gpu,
        )
      : undefined
  const scripts: PageScript[] = []
  const timeline = motion?.playbackOnly
    ? PLAYBACK_TIMELINE_SCRIPT
    : TIMELINE_SCRIPT
  if (mode === 'live') {
    const open = anyElement(site, e => e.attrs?.['data-s-open'] !== undefined)
    // Decided from what was written, not from the source trees: a node that is not drawn writes nothing for the script to read.
    // Every `data-s-*` attribute is the script's (a state, or `data-s-on`) except the pattern cursor (the base script) and `open`.
    const states = anyElement(site, e =>
      Object.entries(e.attrs ?? {}).some(
        ([k, v]) =>
          k.startsWith('data-s-') &&
          k !== 'data-s-pattern' &&
          k !== 'data-s-open' &&
          v !== undefined &&
          v !== false,
      ),
    )
    scripts.push({
      name: 'base',
      code:
        BASE_SCRIPT +
        (open ? OPEN_SCRIPT : '') +
        (mail.used ? EMAIL_SCRIPT : ''),
    })
    if (states) scripts.push({ name: 'states', code: STATES_SCRIPT })
    if (motion?.timeline) scripts.push({ name: 'timeline', code: timeline })
    if (gpu)
      scripts.push({
        name: 'gpuLoader',
        code: GPU_LOADER_SCRIPT,
        ...(gpu.worker && { worker: true }),
      })
  }

  const css =
    fontFaceCss(fontsOf(doc, p.shell), p.fontBase, p.fonts) +
    BASE_CSS +
    p.sheet(motion?.inlineClasses, motion?.hostAlpha).css +
    (motion?.css ?? '') +
    (gpu?.css ?? '')
  const body: HtmlNode[] = [site]
  if (gpu) body.push(gpu.element)
  const written = scripts.map(s => s.code).join(';')
  if (scripts.length)
    body.push({ tag: 'script', raw: { kind: 'script', content: written } })
  let html = `<!doctype html>${writeHtml({
    tag: 'html',
    attrs: { lang: p.lang, dir: p.rtl ? 'rtl' : undefined },
    children: [
      {
        tag: 'head',
        children: [
          { tag: 'meta', attrs: { charset: 'utf-8' } },
          {
            tag: 'meta',
            attrs: {
              name: 'viewport',
              content: 'width=device-width, initial-scale=1',
            },
          },
          { tag: 'title', children: [`${page.title} · ${doc.name}`] },
          { tag: 'style', raw: { kind: 'style', content: css } },
        ],
      },
      { tag: 'body', children: body },
    ],
  })}`
  if (mode === 'live') {
    const hashes = executableHashes(scripts)
    if (siteHashes) hashes.forEach(h => siteHashes.add(h))
    else html = withPolicy(html, scriptPolicy(hashes, gpu?.worker))
  }

  const stats: PageStats = {
    bytes: byteLength(html),
    styleBytes: byteLength(css),
    // Preserve the original base joins. The GPU loader pays for its own separator.
    scriptBytes: {
      base: scripts.length
        ? byteLength(scripts[0].code) + scripts.length - 1 - Number(!!gpu)
        : 0,
      states: byteLength(scripts.find(s => s.name === 'states')?.code ?? ''),
      ...(motion?.timeline && { timeline: byteLength(timeline) }),
      ...(gpu && {
        gpuLoader: byteLength(GPU_LOADER_SCRIPT) + 1,
        gpuHost: byteLength(GPU_HOST_SCRIPT),
      }),
    },
    // Site + inert/executable body scripts, plus one reserved live display slot.
    elements: siteCount + body.length - 1 + Number(!!gpu?.worker),
    depth: p.depth,
    ...(gpu && { gpuData: gpu.stats }),
  }
  return {
    ok: true,
    html,
    css,
    scripts,
    ...(gpu && {
      gpu: { usesWasm: gpu.usesWasm },
      assets: [{ path: GPU_HOST_PATH, content: GPU_HOST_SCRIPT }],
    }),
    stats,
    problems: [
      ...cutProblems(p.over),
      // a cut page already says so: its elements ceiling is the same cause
      ...checkBudgets(stats).filter(b => !(p.over && b.path === 'elements')),
    ],
  }
}
