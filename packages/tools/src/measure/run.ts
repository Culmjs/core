import { extname } from 'node:path'
import {
  buildIdentity,
  compilePage,
  compileSite,
  pageScriptPolicy,
  policyMeta,
  type CompileOptions,
  type CompiledPage,
  walk,
  type Data,
  type Problem,
  type Registry,
  type SiteDocument,
  type SiteFonts,
  type SiteIcons,
} from '@culmjs/core'
import {
  MEASURE_PROFILE,
  PROBE_SCRIPT,
  buildReport,
  compareReports,
  runChecks,
  type ContrastRaw,
  type Finding,
  type LayoutRaw,
  type Report,
} from '@culmjs/core/measure'
import type { SiteStore } from '@culmjs/core/ops'
import { openBrowser, type Answer, type Browser, type Page } from './browser.ts'
import { contrastOf } from './contrast.ts'
import {
  deploymentPolicy,
  mediaAddresses,
  MIME,
  NO_SCRIPTS,
} from '../shared.ts'

export type MeasureInput = {
  doc: SiteDocument
  registry: Registry
  data: Data
  /** Fonts the folder holds (`up:<name>`), as `readHeld` reads them. */
  fonts?: SiteFonts
  /** Icons the folder holds (`set:name`), as `readHeld` reads them. */
  icons?: SiteIcons
  revision: number
  /** Page ids; default: every page that is on. */
  pages?: string[]
  /** Window widths; the profile's 1280, 834 and 390 are the ones that can be measured. */
  widths?: number[]
  themes?: ('light' | 'dark')[]
  /** Directions of the site's languages; default: every one it declares. */
  directions?: ('ltr' | 'rtl')[]
  /** Finding classes returned; default 1 and 2. */
  classes?: (1 | 2 | 3)[]
  /** One already open (not closed by the run); else the run opens one and closes it. */
  browser?: Browser
  /** The Chrome to open when no `browser` is given (else `CULM_CHROME`, Playwright's Chromium, the system Chrome). */
  executable?: string
  /** Confirmed project files, for optional media eligibility and the build identity. */
  files?: { path: string; sha256: string }[]
  /** The bytes of a file the page asks for, by project path (`assets/…`, `fonts/…`), or undefined. */
  assets?(path: string): Promise<Uint8Array | undefined>
  /** Called once per page and direction with the probe's layouts, before the checks (the fixture capture reads them). */
  onLayouts?: (page: string, dir: 'ltr' | 'rtl', layouts: LayoutRaw[]) => void
}

const LAYOUT = { 1280: 'desktop', 834: 'tablet', 390: 'phone' } as const
const ORIGIN = 'https://site.culm.invalid'
const HEIGHT = 900
const LOAD_MS = 15000
const FONTS_MS = 5000

const incomplete = (message: string): Problem => ({
  code: 'MEASUREMENT_INCOMPLETE',
  message,
})
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The states the profile leaves out: each declared value that is not the initial one. */
export function skippedStates(doc: SiteDocument, pageId: string): string[] {
  const out: string[] = []
  const done = new Set<string>()
  // The page, its header and footer, and each component an instance in them (or in such a component) draws.
  const todo = [
    doc.pages.find(p => p.id === pageId)?.root,
    doc.header,
    doc.footer,
  ]
  for (let r = todo.pop(); r || todo.length; r = todo.pop()) {
    if (!r) continue
    walk(r, n => {
      for (const s of n.state ?? [])
        for (const v of s.values === 'on-off' ? ['on', 'off'] : s.values)
          if (v !== s.initial) out.push(`state:${s.name}=${v}`)
      const c =
        n.kind === 'instance' && n.component && !done.has(n.component)
          ? doc.components.find(x => x.id === n.component)
          : undefined
      if (c) {
        done.add(c.id)
        todo.push(c.root)
      }
    })
  }
  return out
}

/** Answer the compiled page, its generated assets, and project media and fonts. Other requests are blocked. */
export function measureAnswers(
  page: Extract<CompiledPage, { ok: true }>,
  route: Pick<SiteDocument['pages'][number], 'slug' | 'on'>,
  assets: MeasureInput['assets'],
  missing: { n: number },
  deployed: string,
) {
  const standalone = pageScriptPolicy(page.scripts)
  // A requested draft has no deployed route. Keep its own executable set on
  // that page only; shared project files still have the deployment policy.
  const policy = route.on ? deployed : standalone
  const html = route.on
    ? page.html.replace(policyMeta(standalone), () => policyMeta(deployed))
    : page.html
  const generated = new Map(page.assets?.map(f => ['/' + f.path, f.content]))
  return async (url: string): Promise<Answer | undefined> => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return undefined
    }
    if (u.origin !== ORIGIN) return undefined
    if (u.pathname === route.slug)
      return { type: 'text/html; charset=utf-8', body: html, policy }
    const js = generated.get(u.pathname)
    if (js !== undefined)
      return { type: MIME['.js']!, body: js, policy: deployed }
    const m = /^\/(assets|_fonts)\/(.+)$/.exec(u.pathname)
    if (!m || !assets) return undefined
    let rest: string
    try {
      rest = decodeURIComponent(m[2]!)
    } catch {
      return undefined
    }
    if (/(^|\/)\.\.?(\/|$)|[\\\0]/.test(rest)) return undefined
    const body = await assets(
      `${m[1] === '_fonts' ? 'fonts' : 'assets'}/${rest}`,
    ).catch(() => undefined)
    if (!body) {
      missing.n++
      return undefined
    }
    return {
      type: MIME[extname(rest).toLowerCase()] ?? 'application/octet-stream',
      body,
      policy: deployed,
    }
  }
}

/** `document.fonts.ready`, but no longer than 5 s; false when it ran out. */
const fontsLoaded = (page: Page) =>
  page.evaluate<boolean>(
    `Promise.race([document.fonts.ready.then(()=>true), new Promise(r=>setTimeout(()=>r(false), ${FONTS_MS}))])`,
  )

async function measurePage(
  browser: Browser,
  i: MeasureInput,
  compileOptions: CompileOptions,
  policy: string,
  pageId: string,
  dir: 'ltr' | 'rtl',
  lang: string | undefined,
  widths: number[],
  themes: ('light' | 'dark')[],
): Promise<{
  findings: Finding[]
  measured: Report['measured']
  incomplete: Report['incomplete']
  blocked: string[]
}> {
  const { doc, registry } = i
  const node = doc.pages.find(p => p.id === pageId)
  const revision = i.revision
  const checks = (
    problems: Problem[],
    layouts: LayoutRaw[],
    contrast: ContrastRaw[],
    loaded: { fonts: boolean; assets: boolean },
  ) =>
    runChecks({
      revision,
      page: pageId,
      dir,
      layouts,
      contrast,
      doc,
      registry,
      loaded,
      problems,
    })

  const compiled = compilePage(doc, pageId, {
    ...compileOptions,
    mode: 'measure',
    ...(lang ? { lang } : {}),
  })
  if (!compiled.ok)
    return {
      findings: checks(compiled.problems, [], [], {
        fonts: true,
        assets: true,
      }),
      measured: [],
      incomplete: [
        {
          page: pageId,
          dir,
          problem: incomplete(
            `Page "${pageId}" could not be compiled, so it was not measured.`,
          ),
        },
      ],
      blocked: [],
    }

  const layouts: LayoutRaw[] = []
  const contrast: ContrastRaw[] = []
  const measured: Report['measured'] = []
  const loaded = { fonts: true, assets: true }
  const missing = { n: 0 }
  let page: Page | undefined
  try {
    page = await browser.newPage()
    await page.answer(
      measureAnswers(compiled, node!, i.assets, missing, policy),
    )
    const went = await page.goto(ORIGIN + node!.slug, LOAD_MS)
    if (!went.ok)
      throw new Error(
        `the page did not load: ${went.problem ?? 'no reason given'}`,
      )
    for (const width of widths) {
      await page.setViewport(width, HEIGHT)
      const probeTheme = themes.includes('light') ? 'light' : themes[0]
      if (probeTheme) {
        await page.setScheme(probeTheme)
        if (!(await fontsLoaded(page))) loaded.fonts = false
        layouts.push({
          layout: LAYOUT[width as keyof typeof LAYOUT],
          ...(await page.evaluate<Omit<LayoutRaw, 'layout'>>(
            `(${PROBE_SCRIPT})(document, window, ${width})`,
          )),
        })
      }
      for (const theme of themes) {
        await page.setScheme(theme)
        contrast.push(...(await contrastOf(page, theme, width)))
        measured.push({ page: pageId, width, theme, dir })
      }
    }
    loaded.assets = page.blocked.length === 0 && missing.n === 0
    i.onLayouts?.(pageId, dir, layouts)
    return {
      findings: checks(compiled.problems, layouts, contrast, loaded),
      measured,
      incomplete: [],
      blocked: [...page.blocked],
    }
  } catch (e) {
    return {
      findings: checks(compiled.problems, [], [], loaded),
      measured: [],
      incomplete: [
        {
          page: pageId,
          dir,
          problem: incomplete(
            `Page "${pageId}" could not be measured: ${why(e)}`,
          ),
        },
      ],
      blocked: page ? [...page.blocked] : [],
    }
  } finally {
    await page?.close().catch(() => {})
  }
}

/**
 * Measures the pages of one revision in a real Chrome, over its DevTools pipe: each page in each direction its site's languages declare, at each width and in each
 * colour scheme. Never throws for the document or the options; what could not be measured is in `incomplete`, and a missing Chrome makes every page incomplete.
 */
export async function runMeasure(input: MeasureInput): Promise<Report> {
  try {
    return await measureAll(input)
  } catch (e) {
    // a document that is not a site (a page list that is missing, say): nothing could be measured
    return {
      revision: input.revision,
      build: '',
      profile: MEASURE_PROFILE,
      browser: '',
      findings: [],
      measured: [],
      incomplete: ids(input).map(page => ({
        page,
        problem: incomplete(`The document could not be measured: ${why(e)}`),
      })),
      blocked: [],
      skipped: [],
    }
  }
}

/** The pages a broken document was asked to measure, or its page ids as far as they can be read. */
export function ids(input: MeasureInput): string[] {
  if (input.pages?.length) return input.pages
  const ps = (input.doc as { pages?: unknown } | undefined)?.pages
  const found = Array.isArray(ps)
    ? ps.flatMap(p => (typeof p?.id === 'string' ? [p.id as string] : []))
    : []
  return found.length ? found : ['']
}

async function measureAll(input: MeasureInput): Promise<Report> {
  const { doc } = input
  const asked = input.widths ?? Object.keys(LAYOUT).map(Number)
  const widths = asked.filter(w => w in LAYOUT)
  const themes = input.themes ?? ['light', 'dark']
  const langs = doc.languages?.length ? doc.languages : [{ code: 'en' }]
  const declared = new Map<'ltr' | 'rtl', string>()
  for (const l of langs) {
    const d = l.dir === 'rtl' ? 'rtl' : 'ltr'
    if (!declared.has(d)) declared.set(d, l.code)
  }
  const dirs = [...declared.keys()].filter(
    d => !input.directions || input.directions.includes(d),
  )
  const pages = input.pages ?? doc.pages.filter(p => p.on).map(p => p.id)
  const classes = input.classes ?? [1, 2]
  let build = ''
  try {
    build = await buildIdentity(doc, input.data, input.registry, input.files)
  } catch {
    // data that cannot be written as JSON: the compile of each page reports it
  }
  const profile = { version: MEASURE_PROFILE, widths, themes, directions: dirs }

  let browser = input.browser
  let own = false
  let none: Problem[] = []
  if (!browser) {
    const o = await openBrowser(
      input.executable ? { executable: input.executable } : {},
    )
    if (o.ok) {
      browser = o.browser
      own = true
    } else none = o.problems
  }
  try {
    const compileOptions: CompileOptions = {
      registry: input.registry,
      data: input.data,
      links: { page: slug => slug, file: id => `/assets/${id}` },
      availableMedia: input.files && mediaAddresses(input.files),
      fonts: input.fonts,
      icons: input.icons,
    }
    const policy = browser
      ? deploymentPolicy(compileSite(doc, compileOptions))
      : NO_SCRIPTS
    const per: Parameters<typeof buildReport>[3] = []
    for (const page of pages) {
      const one = {
        page,
        findings: [] as Finding[],
        measured: [] as Report['measured'],
        incomplete: [] as Report['incomplete'],
        blocked: [] as string[],
        skipped: skippedStates(doc, page),
      }
      if (!browser) one.incomplete.push({ page, problem: none[0]! })
      else
        for (const dir of dirs) {
          const r = await measurePage(
            browser,
            input,
            compileOptions,
            policy,
            page,
            dir,
            declared.get(dir),
            widths,
            themes,
          )
          one.findings.push(...r.findings)
          one.measured.push(...r.measured)
          one.incomplete.push(...r.incomplete)
          one.blocked.push(...r.blocked)
        }
      for (const w of asked.filter(w => !(w in LAYOUT)))
        one.incomplete.push({
          page,
          width: w,
          problem: incomplete(
            `The width ${w} is not in the profile (${Object.keys(LAYOUT).join(', ')}), so it was not measured.`,
          ),
        })
      one.findings = one.findings.filter(f => classes.includes(f.class))
      per.push(one)
    }
    return buildReport(
      input.revision,
      build,
      { ...profile, browser: browser?.version ?? '' },
      per,
    )
  } finally {
    if (own) await browser!.close()
  }
}

/**
 * Measures the revision `since` and the head of the site in one browser session, and returns the head's report with `compareReports`. A revision the store does not
 * hold is UNSUPPORTED_CAPABILITY; a site it does not hold is its own problem.
 */
export async function measureSince(
  input: Omit<MeasureInput, 'doc' | 'revision'> & {
    store: SiteStore
    site: string
    since: number
  },
): Promise<
  | { ok: true; report: Report; comparison: ReturnType<typeof compareReports> }
  | { ok: false; problems: Problem[] }
> {
  const { store, site, since, ...rest } = input
  const head = await store.head(site)
  if ('problems' in head) return { ok: false, problems: head.problems }
  const before =
    Number.isInteger(since) && since >= 0 && since <= head.revision
      ? await store.get(site, since)
      : undefined
  if (!before)
    return {
      ok: false,
      problems: [
        {
          code: 'UNSUPPORTED_CAPABILITY',
          message: `The store does not hold revision ${since} of "${site}".`,
          path: 'since',
        },
      ],
    }
  let browser = rest.browser
  let own = false
  if (!browser) {
    const o = await openBrowser(
      rest.executable ? { executable: rest.executable } : {},
    )
    if (o.ok) {
      browser = o.browser
      own = true
    }
  }
  try {
    const shared = { ...rest, ...(browser ? { browser } : {}) }
    const old = await runMeasure({ ...shared, doc: before, revision: since })
    const report = await runMeasure({
      ...shared,
      doc: head.doc,
      revision: head.revision,
    })
    return {
      ok: true,
      report,
      comparison: compareReports(old, report, head.doc),
    }
  } finally {
    if (own) await browser!.close()
  }
}
