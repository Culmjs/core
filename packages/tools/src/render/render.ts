import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  compileFrame,
  compilePage,
  createRegistry,
  emptySite,
  find,
  type Data,
  type FontRef,
  type Look,
  type Node,
  type Problem,
  type Registry,
  type SiteDocument,
  type SiteFonts,
  type SiteIcons,
  type SiteStyles,
} from '@culmjs/core'
import {
  PROBE_SCRIPT,
  runChecks,
  type Finding,
  type LayoutRaw,
} from '@culmjs/core/measure'
import { plan } from '@culmjs/core/ops'
import { inside, readAsset } from '../folder/files.ts'
import { fetchFor } from '../folder/fetch.ts'
import { readHeld } from '../folder/held.ts'
import type { ImageConfig, ImageProvider } from '../image/providers.ts'
import { buildRequest } from '../jsx/batch.ts'
import { previewOps } from '../jsx/write.ts'
import {
  openBrowser,
  type Answer,
  type Browser,
  type Page,
} from '../measure/browser.ts'
import { contrastOf } from '../measure/contrast.ts'
import { isObj, MIME } from '../shared.ts'

export const SIZE_PRESETS: Record<string, [number, number]> = {
  square: [1080, 1080],
  og: [1200, 630],
  poster: [1080, 1350],
  story: [1080, 1920],
  wide: [1600, 900],
  icon: [512, 512],
}

export type RenderInput = {
  out?: string
  node?: unknown
  page?: string
  id?: string
  size?: string | [number, number]
  width?: number
  height?: number
  scale?: number
  format?: 'png' | 'webp' | 'svg'
  transparent?: boolean
  dark?: boolean
  look?: Partial<Look>
  fonts?: unknown[]
}

export type RenderResult =
  | {
      ok: true
      out?: string
      format: 'png' | 'webp' | 'svg'
      width: number
      height: number
      scale: number
      bytes: number
      sha256: string
      svg?: string
      findings: Finding[]
    }
  | { ok: false; problems: Problem[] }

export type RenderEnv = {
  cwd?: string
  containInDir?: boolean
  doc?: SiteDocument
  registry?: Registry
  data?: Data
  fonts?: SiteFonts
  icons?: SiteIcons
  assets?(path: string): Promise<Uint8Array | undefined>
  browser?: Browser
  executable?: string
  images?: ImageConfig
  imageProvider?: ImageProvider
}

const ORIGIN = 'https://frame.culm.invalid'
const LOAD_MS = 15000
const FONTS_MS = 5000

const DEFAULT_LOOK: Look = {
  id: 'render',
  name: 'Render',
  family: 'Minimal',
  brand: '#b45309',
  ink: '#1c1917',
  bg: '#fafaf9',
  headingFont: 'sys:sans',
  bodyFont: 'sys:sans',
  corners: 8,
  dark: 'light',
}

const bad = (
  code: Problem['code'],
  message: string,
  path?: string,
): Problem => ({ code, message, ...(path ? { path } : {}) })

export function resolveDimensions(
  input: RenderInput,
):
  | { ok: true; width: number; height: number }
  | { ok: false; problem: Problem } {
  let w = input.width
  let h = input.height
  if (input.size !== undefined) {
    if (typeof input.size === 'string') {
      const key = input.size.trim().toLowerCase()
      const preset = Object.hasOwn(SIZE_PRESETS, key)
        ? SIZE_PRESETS[key]
        : undefined
      if (preset) {
        w ??= preset[0]
        h ??= preset[1]
      } else {
        const m = /^(\d{2,4})x(\d{2,4})$/.exec(key)
        if (!m)
          return {
            ok: false,
            problem: bad(
              'INVALID_OPERATION',
              `size must be one of ${Object.keys(SIZE_PRESETS).join(', ')} or "WIDTHxHEIGHT".`,
              'size',
            ),
          }
        w ??= Number(m[1])
        h ??= Number(m[2])
      }
    } else if (
      Array.isArray(input.size) &&
      input.size.length === 2 &&
      typeof input.size[0] === 'number' &&
      typeof input.size[1] === 'number'
    ) {
      w ??= input.size[0]
      h ??= input.size[1]
    } else {
      return {
        ok: false,
        problem: bad(
          'INVALID_OPERATION',
          'size must be a preset name, "WxH", or [w, h].',
          'size',
        ),
      }
    }
  }
  const width = Math.round(w ?? 1200)
  const height = Math.round(h ?? 630)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 16 ||
    height < 16 ||
    width > 4096 ||
    height > 4096
  )
    return {
      ok: false,
      problem: bad(
        'INVALID_OPERATION',
        'width and height must be 16 to 4096 pixels.',
        'size',
      ),
    }
  return { ok: true, width, height }
}

const realish = async (p: string): Promise<string> => {
  const rest: string[] = []
  for (let cur = resolve(p); ; cur = dirname(cur)) {
    try {
      return join(await realpath(cur), ...rest)
    } catch {
      if (dirname(cur) === cur) return resolve(p)
      rest.unshift(basename(cur))
    }
  }
}

const imageOut = (rel: string): { ok: false; problem: Problem } | undefined =>
  /\.(svg|png|jpe?g|webp)$/i.test(rel) &&
  !/^(\.culm|node_modules)(\/|$)/.test(rel)
    ? undefined
    : {
        ok: false,
        problem: bad(
          'POLICY_VIOLATION',
          'out must be an image file (.svg, .png, .jpg, .webp) outside .culm and node_modules.',
          'out',
        ),
      }

async function resolveOutPath(
  cwd: string | undefined,
  out: string,
  contain: boolean,
): Promise<
  { ok: true; abs: string; rel: string } | { ok: false; problem: Problem }
> {
  const base = cwd ?? process.cwd()
  if (!out || /[\0]/.test(out))
    return {
      ok: false,
      problem: bad('INVALID_OPERATION', 'out must be a file path.', 'out'),
    }
  if (contain && isAbsolute(out)) {
    const rootReal = await realish(base)
    const outReal = await realish(out)
    if (!inside(rootReal, outReal))
      return {
        ok: false,
        problem: bad(
          'POLICY_VIOLATION',
          'out path must stay inside the project folder.',
          'out',
        ),
      }
    const rel = relative(rootReal, outReal).split(sep).join('/')
    return imageOut(rel) ?? { ok: true, abs: outReal, rel }
  }
  const abs = resolve(base, out)
  if (contain) {
    const rootReal = await realish(base)
    const outReal = await realish(abs)
    if (!inside(rootReal, outReal))
      return {
        ok: false,
        problem: bad(
          'POLICY_VIOLATION',
          'out path must stay inside the project folder.',
          'out',
        ),
      }
    const rel = relative(rootReal, outReal).split(sep).join('/')
    return imageOut(rel) ?? { ok: true, abs: outReal, rel }
  }
  return { ok: true, abs, rel: out }
}

async function writeAtomicFile(
  abs: string,
  bytes: Uint8Array | string,
): Promise<void> {
  await mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.render-${randomUUID()}`
  try {
    await writeFile(tmp, bytes)
    await rename(tmp, abs)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

function frameAnswers(html: string, slug: string, assets: RenderEnv['assets']) {
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
    if (!body) return undefined
    return {
      type: MIME[extname(rest).toLowerCase()] ?? 'application/octet-stream',
      body,
    }
  }
}

function pickNode(
  doc: SiteDocument,
  pageId: string,
  nodeId: string,
): Node | undefined {
  const tree =
    pageId === 'header'
      ? doc.header
      : pageId === 'footer'
        ? doc.footer
        : doc.pages.find(p => p.id === pageId)?.root
  return tree ? find(tree, nodeId) : undefined
}

export async function renderImage(
  input: RenderInput,
  env: RenderEnv = {},
): Promise<RenderResult> {
  const format =
    input.format ??
    (input.out?.toLowerCase().endsWith('.svg')
      ? 'svg'
      : input.out?.toLowerCase().endsWith('.webp')
        ? 'webp'
        : 'png')
  if (!['png', 'webp', 'svg'].includes(format))
    return {
      ok: false,
      problems: [
        bad('INVALID_OPERATION', 'format must be png, webp, or svg.', 'format'),
      ],
    }

  const scale = input.scale ?? 1
  if (!Number.isInteger(scale) || scale < 1 || scale > 4)
    return {
      ok: false,
      problems: [
        bad('INVALID_OPERATION', 'scale must be 1, 2, 3, or 4.', 'scale'),
      ],
    }

  const dims = resolveDimensions(input)
  if (!dims.ok) return { ok: false, problems: [dims.problem] }
  const { width, height } = dims

  let outInfo: { abs: string; rel: string } | undefined
  if (input.out !== undefined) {
    const o = await resolveOutPath(env.cwd, input.out, env.containInDir ?? true)
    if (!o.ok) return { ok: false, problems: [o.problem] }
    outInfo = { abs: o.abs, rel: o.rel }
  } else if (format !== 'svg') {
    return {
      ok: false,
      problems: [
        bad('INVALID_OPERATION', 'out is required for png and webp.', 'out'),
      ],
    }
  }

  const registry = env.registry ?? createRegistry()
  let doc: SiteDocument
  let html: string
  let pageId = input.page ?? 'home'
  let fonts = env.fonts
  let icons = env.icons
  const assets =
    env.assets ?? (env.cwd ? (p: string) => readAsset(env.cwd!, p) : undefined)

  if (input.node !== undefined) {
    if (!isObj(input.node))
      return {
        ok: false,
        problems: [bad('INVALID_OPERATION', 'node must be an object.', 'node')],
      }
    const baseLook: Look = {
      ...(env.doc?.look ?? DEFAULT_LOOK),
      ...(isObj(input.look) ? (input.look as Partial<Look>) : {}),
      dark: input.dark ? 'dark' : 'light',
    }
    const seedDoc = emptySite('Frame', baseLook)
    if (env.doc?.styles) seedDoc.styles = env.doc.styles
    if (env.doc?.fonts?.length) seedDoc.fonts = [...env.doc.fonts]

    const built = buildRequest(seedDoc, registry, {
      page: 'home',
      ops: [{ op: 'insert', node: input.node }],
    })
    if (!built.ok) return { ok: false, problems: built.problems }
    if (built.errors.length) return { ok: false, problems: built.errors }

    let ops = built.ops
    if (Array.isArray(input.fonts) && input.fonts.length)
      ops = [
        { op: 'setFonts', fonts: [...seedDoc.fonts, ...input.fonts] },
        ...ops,
      ]

    if (env.cwd) {
      const f = await fetchFor(env.cwd, seedDoc, ops, {
        images: env.images,
        imageProvider: env.imageProvider,
      })
      if (!f.ok) return { ok: false, problems: f.problems }
      ops = f.ops as typeof ops
      const held = await readHeld(env.cwd)
      fonts = { ...fonts, ...held.fonts }
      icons = { ...icons, ...held.icons }
    } else {
      ops = previewOps(ops)
    }

    const planned = plan(seedDoc, registry, {
      site: 'frame',
      baseRevision: 0,
      key: 'frame',
      ops: ops as never,
    })
    if (!planned.ok) return { ok: false, problems: planned.problems }
    const inserted = planned.doc.pages[0]?.root.children?.[0]
    if (!inserted)
      return {
        ok: false,
        problems: [
          bad(
            'INVALID_OPERATION',
            'node produced no renderable element.',
            'node',
          ),
        ],
      }

    const frame = compileFrame(
      {
        node: inserted,
        width,
        height,
        look: planned.doc.look,
        fonts: planned.doc.fonts as FontRef[],
        styles: planned.doc.styles as SiteStyles | undefined,
        transparent: input.transparent,
        dark: input.dark,
        format: format === 'svg' ? 'svg' : 'html',
      },
      {
        registry,
        data: env.data,
        mode: 'measure',
        links: { page: slug => slug, file: id => `/assets/${id}` },
        ...(fonts ? { fonts } : {}),
        ...(icons ? { icons } : {}),
      },
    )
    if (!frame.ok) return { ok: false, problems: frame.problems }
    if (format === 'svg') {
      const svg = frame.svg!
      const bytes = Buffer.from(svg, 'utf8')
      if (outInfo) await writeAtomicFile(outInfo.abs, bytes)
      return {
        ok: true,
        ...(outInfo ? { out: outInfo.rel } : {}),
        format: 'svg',
        width,
        height,
        scale: 1,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        svg,
        findings: [],
      }
    }
    doc = frame.doc
    html = frame.html!
    pageId = 'home'
  } else {
    if (!env.doc)
      return {
        ok: false,
        problems: [
          bad(
            'INVALID_OPERATION',
            'Supply a node or open a Culm site.',
            'node',
          ),
        ],
      }
    doc = env.doc
    if (format === 'svg') {
      if (!input.id)
        return {
          ok: false,
          problems: [
            bad(
              'INVALID_OPERATION',
              'SVG export requires a shape node or id.',
              'format',
            ),
          ],
        }
      const found = pickNode(doc, pageId, input.id)
      if (!found)
        return {
          ok: false,
          problems: [
            bad(
              'INVALID_OPERATION',
              `No node "${input.id}" on "${pageId}".`,
              'id',
            ),
          ],
        }
      const frame = compileFrame(
        {
          node: found,
          width,
          height,
          look: doc.look,
          fonts: doc.fonts,
          styles: doc.styles,
          transparent: input.transparent,
          dark: input.dark,
          format: 'svg',
        },
        {
          registry,
          data: env.data,
          links: { page: slug => slug, file: id => `/assets/${id}` },
          ...(fonts ? { fonts } : {}),
          ...(icons ? { icons } : {}),
        },
      )
      if (!frame.ok) return { ok: false, problems: frame.problems }
      const svg = frame.svg!
      const bytes = Buffer.from(svg, 'utf8')
      if (outInfo) await writeAtomicFile(outInfo.abs, bytes)
      return {
        ok: true,
        ...(outInfo ? { out: outInfo.rel } : {}),
        format: 'svg',
        width,
        height,
        scale: 1,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        svg,
        findings: [],
      }
    }

    const compiled = compilePage(doc, pageId, {
      registry,
      data: env.data,
      mode: 'measure',
      links: { page: slug => slug, file: id => `/assets/${id}` },
      ...(fonts ? { fonts } : {}),
      ...(icons ? { icons } : {}),
    })
    if (!compiled.ok) return { ok: false, problems: compiled.problems }
    html = compiled.html
    if (input.transparent) {
      html = html.replace(
        '</style>',
        'html,body,.s-site,.s-site main{background:transparent!important}</style>',
      )
    }
  }

  let browser = env.browser
  let ownBrowser = false
  if (!browser) {
    const opened = await openBrowser({ executable: env.executable })
    if (!opened.ok) return { ok: false, problems: opened.problems }
    browser = opened.browser
    ownBrowser = true
  }

  const slug = doc.pages.find(p => p.id === pageId)?.slug ?? '/'
  let page: Page | undefined
  try {
    page = await browser.newPage()
    await page.setViewport(width, height)
    await page.setScheme(input.dark ? 'dark' : 'light')
    await page.setReducedMotion(true)
    await page.answer(frameAnswers(html, slug, assets))
    const went = await page.goto(ORIGIN + slug, LOAD_MS)
    if (!went.ok)
      return {
        ok: false,
        problems: [
          bad(
            'MEASUREMENT_INCOMPLETE',
            `Render failed to load: ${went.problem ?? 'unknown error'}`,
          ),
        ],
      }
    await page.evaluate<boolean>(
      `Promise.race([Promise.all([document.fonts.ready, ...[...document.images].map(i=>i.complete?null:new Promise(r=>{i.onload=r;i.onerror=r}))]).then(()=>true), new Promise(r=>setTimeout(()=>r(false), ${FONTS_MS}))])`,
    )

    let clip: { x: number; y: number; w: number; h: number } | undefined
    if (input.id) {
      const box = await page.evaluate<{
        x: number
        y: number
        w: number
        h: number
      } | null>(
        `(() => { const el = document.querySelector('[data-id=' + ${JSON.stringify(input.id)} + ']'); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: Math.max(0, r.left + window.scrollX), y: Math.max(0, r.top + window.scrollY), w: Math.ceil(r.width), h: Math.ceil(r.height) } : null; })()`,
      )
      if (!box)
        return {
          ok: false,
          problems: [
            bad(
              'INVALID_OPERATION',
              `Node "${input.id}" was not rendered or has zero size.`,
              'id',
            ),
          ],
        }
      clip = box
    }

    const scheme = input.dark ? 'dark' : 'light'
    const layoutName =
      width <= 600 ? 'phone' : width <= 1024 ? 'tablet' : 'desktop'
    const probeRaw = await page.evaluate<Omit<LayoutRaw, 'layout'>>(
      `(${PROBE_SCRIPT})(document, window, ${width})`,
    )
    const contrastRaw = await contrastOf(page, scheme, width)
    const FRAME_CHECKS = new Set([
      'invalid',
      'off-screen',
      'overflow',
      'broken-word',
      'h-scroll',
      'overlap',
      'contrast',
      'tap-target',
      'shape-covers',
      'shape-complex',
      'crowded-phone-row',
    ])
    const findings = runChecks({
      revision: 0,
      page: pageId,
      dir: 'ltr',
      layouts: [{ layout: layoutName, ...probeRaw }],
      contrast: contrastRaw,
      doc,
      registry,
      loaded: { fonts: true, assets: true },
      problems: [],
    }).filter(f =>
      input.node !== undefined || input.id !== undefined
        ? FRAME_CHECKS.has(f.check)
        : f.class <= 2,
    )

    const bytes = await page.capture({
      format: format as 'png' | 'webp',
      clip,
      scale,
      transparent: input.transparent,
    })
    if (outInfo) await writeAtomicFile(outInfo.abs, bytes)
    return {
      ok: true,
      ...(outInfo ? { out: outInfo.rel } : {}),
      format,
      width: clip ? clip.w : width,
      height: clip ? clip.h : height,
      scale,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      findings,
    }
  } finally {
    await page?.close().catch(() => {})
    if (ownBrowser) await browser.close().catch(() => {})
  }
}
