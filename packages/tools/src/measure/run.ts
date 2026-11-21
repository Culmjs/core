import { extname } from 'node:path'
import {
  buildIdentity,
  compilePage,
  walk,
  type Data,
  type Node,
  type Problem,
  type Registry,
  type SiteDocument,
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

export type MeasureInput = {
  doc: SiteDocument
  registry: Registry
  data: Data
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
  /** The font and asset files of the project, for the build identity. */
  files?: { path: string; sha256: string }[]
  /** The bytes of a file the page asks for, by project path (`assets/…`, `fonts/…`), or undefined. */
  assets?(path: string): Promise<Uint8Array | undefined>
}

const LAYOUT = { 1280: 'desktop', 834: 'tablet', 390: 'phone' } as const
const ORIGIN = 'https://site.culm.invalid'
const HEIGHT = 900
const LOAD_MS = 15000
const FONTS_MS = 5000
const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

const incomplete = (message: string): Problem => ({
  code: 'MEASUREMENT_INCOMPLETE',
  message,
})
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The states the profile leaves out: each declared value that is not the initial one. */
function skippedStates(doc: SiteDocument, pageId: string): string[] {
  const out: string[] = []
  const root = doc.pages.find(p => p.id === pageId)?.root
  for (const r of [root, doc.header, doc.footer])
    if (r)
      walk(r, n => {
        for (const s of n.state ?? [])
          for (const v of s.values === 'on-off' ? ['on', 'off'] : s.values)
            if (v !== s.initial) out.push(`state:${s.name}=${v}`)
      })
  return out
}

/** Answers the page's own requests: the compiled page at its address, and the project's assets and fonts. Everything else is undefined (blocked). */
function answers(
  html: string,
  slug: string,
  assets: MeasureInput['assets'],
  missing: { n: number },
) {
  return async (url: string): Promise<Answer | undefined> => {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return undefined
    }
    if (u.origin !== ORIGIN) return undefined
    if (u.pathname === slug)
      return { type: 'text/html; charset=utf-8', body: html }
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
      type: TYPES[extname(rest).toLowerCase()] ?? 'application/octet-stream',
      body,
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
  // ponytail: the checks read the page's own tree; what a component instance or a block adds inside it is measured but has no outline (its findings still name the node).
  const root: Node = node?.root ?? {
    id: pageId,
    kind: 'column',
    name: pageId,
    slot: {},
  }
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
      root,
      registry,
      loaded,
      problems,
    })

  const compiled = compilePage(doc, pageId, {
    registry,
    data: i.data,
    mode: 'measure',
    links: { page: slug => slug, file: id => `/assets/${id}` },
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

  const slug = node!.slug
  const layouts: LayoutRaw[] = []
  const contrast: ContrastRaw[] = []
  const measured: Report['measured'] = []
  const loaded = { fonts: true, assets: true }
  const missing = { n: 0 }
  let page: Page | undefined
  try {
    page = await browser.newPage()
    await page.answer(answers(compiled.html, slug, i.assets, missing))
    const went = await page.goto(ORIGIN + slug, LOAD_MS)
    if (!went.ok)
      throw new Error(
        `the page did not load: ${went.problem ?? 'no reason given'}`,
      )
    for (const width of widths) {
      await page.setViewport(width, HEIGHT)
      await page.setScheme('light')
      if (!(await fontsLoaded(page))) loaded.fonts = false
      // Geometry is measured in the light theme only.
      if (themes.includes('light'))
        layouts.push({
          layout: LAYOUT[width as keyof typeof LAYOUT],
          ...(await page.evaluate<Omit<LayoutRaw, 'layout'>>(
            `(${PROBE_SCRIPT})(document, window, ${width})`,
          )),
        })
      for (const theme of themes) {
        await page.setScheme(theme)
        contrast.push(...(await contrastOf(page, theme, width)))
        measured.push({ page: pageId, width, theme, dir })
      }
    }
    loaded.assets = page.blocked.length === 0 && missing.n === 0
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
  const { doc } = input
  const widths = (input.widths ?? Object.keys(LAYOUT).map(Number)).filter(
    w => w in LAYOUT,
  )
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
