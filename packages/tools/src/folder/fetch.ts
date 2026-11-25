import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkSiteFont,
  fontSlug,
  ICON_LICENCES,
  ICON_NAME_RE,
  siteIcon,
  type Problem,
  type SiteDocument,
  type SiteFont,
} from '@culmjs/core'
import { isObj } from '../shared.ts'
import { readHeld } from './held.ts'

export type FetchHosts = {
  css: string
  files: string
  licence: string
  icons: string
}
export const HOSTS: FetchHosts = {
  css: 'https://fonts.googleapis.com',
  files: 'https://fonts.gstatic.com',
  licence: 'https://raw.githubusercontent.com/google/fonts/main',
  icons: 'https://api.iconify.design',
}
export type Get = (
  url: string,
  max: number,
) => Promise<{ status: number; url: string; bytes: Uint8Array }>
export type FetchOptions = { hosts?: FetchHosts; get?: Get }

const MAX_FAMILIES = 4
const MAX_ICONS = 60
const MAX_FONT = 2 * 1024 * 1024
const MAX_TEXT = 256 * 1024
// Google sends woff2 only to a current desktop browser.
const AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** The default `Get`: global fetch, `timeout` ms per request, stops reading at `max` bytes (more is an error). */
export function makeGet(timeout = 15000): Get {
  return async (url, max) => {
    const res = await fetch(url, {
      headers: { 'user-agent': AGENT },
      // a redirect would send the request to a host nobody checked
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    })
    const chunks: Uint8Array[] = []
    let n = 0
    const reader = res.body?.getReader()
    for (;;) {
      const r = await reader?.read()
      if (!r || r.done) break
      n += r.value.length
      if (n > max) {
        await reader!.cancel()
        throw new Error(`the reply is larger than ${max} bytes`)
      }
      chunks.push(r.value)
    }
    const bytes = new Uint8Array(n)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.length
    }
    return { status: res.status, url: res.url, bytes }
  }
}

const inv = (message: string, op: number, path?: string): Problem => ({
  code: 'INVALID_OPERATION',
  message,
  op,
  ...(path ? { path } : {}),
})
class Refused extends Error {}
const refuse = (m: string): never => {
  throw new Refused(m)
}

/** True when `url` is on the same origin as `base` and below its path (so a redirect or a `..` cannot leave the host). */
function under(url: string, base: string): boolean {
  try {
    const u = new URL(url)
    const b = new URL(`${base}/`)
    return (
      u.origin === b.origin &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith(b.pathname)
    )
  } catch {
    return false
  }
}

type Face = { style: 'normal' | 'italic'; lo: number; hi: number; url: string }
type Pair = [ital: 0 | 1, weight: number]

/** The latin `@font-face` blocks of a css2 reply. Anything it cannot read as such is a refusal. */
function latinFaces(css: string, files: string): Face[] {
  const out: Face[] = []
  let blocks = 0
  for (const m of css.matchAll(
    /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g,
  )) {
    blocks++
    if (m[1] !== 'latin') continue
    const body = m[2]!
    const style = /font-style:\s*(normal|italic)\s*;/.exec(body)?.[1]
    const w = /font-weight:\s*(\d{3})(?:\s+(\d{3}))?\s*;/.exec(body)
    const url =
      /src:[^;]*?url\(\s*([^)\s'"]+)\s*\)\s*format\(\s*['"]woff2['"]\s*\)/.exec(
        body,
      )?.[1]
    if (!style || !w || !url)
      return refuse('its stylesheet has a block Culm cannot read')
    if (!under(url, files))
      return refuse('its stylesheet points at a file on another host')
    out.push({
      style: style as Face['style'],
      lo: +w[1]!,
      hi: +(w[2] ?? w[1]!),
      url,
    })
  }
  if (!blocks) return refuse('its stylesheet has no font blocks')
  if (!out.length) return refuse('it has no latin subset')
  return out
}

const covers = (f: SiteFont, [i, w]: Pair) =>
  f.files.some(
    x =>
      (x.style === 'italic') === (i === 1) &&
      (Array.isArray(x.weight)
        ? x.weight[0] <= w && w <= x.weight[1]
        : x.weight === w),
  )
const heldPairs = (f: SiteFont): Pair[] =>
  f.files.flatMap(x =>
    (Array.isArray(x.weight) ? x.weight : [x.weight]).map(
      w => [x.style === 'italic' ? 1 : 0, w] as Pair,
    ),
  )

type Fetched = {
  slug: string
  font: SiteFont
  licence: Uint8Array
  woff2: Map<string, Uint8Array>
}

async function fetchFamily(
  family: string,
  asked: Pair[],
  held: SiteFont | undefined,
  hosts: FetchHosts,
  get: Get,
): Promise<Fetched | undefined> {
  if (held && asked.every(p => covers(held, p))) return undefined
  const pairs = new Map<string, Pair>()
  for (const p of [...asked, ...(held ? heldPairs(held) : [])])
    pairs.set(p.join(','), p)
  let sorted = [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const sourceOf = (ps: Pair[]) =>
    `${hosts.css}/css2?family=${family.replaceAll(' ', '+')}:ital,wght@${ps.map(p => p.join(',')).join(';')}&display=swap`
  const one = async (url: string, max: number) => {
    const r = await get(url, max)
    if (r.status !== 200) refuse(`${url} answered ${r.status}`)
    return r
  }
  let css = await get(sourceOf(sorted), MAX_TEXT)
  // Google answers 400 for the whole request when one weight does not exist: ask for each alone and keep the ones it has
  if (css.status === 400 && sorted.length > 1) {
    const have: Pair[] = []
    for (const p of sorted)
      if ((await get(sourceOf([p]), MAX_TEXT)).status === 200) have.push(p)
    // an italic the family lacks stays a refusal; only weights are skipped
    if (
      have.length &&
      [0, 1].every(
        i => !sorted.some(p => p[0] === i) || have.some(p => p[0] === i),
      )
    ) {
      sorted = have
      css = await get(sourceOf(sorted), MAX_TEXT)
    }
  }
  if (css.status !== 200)
    return refuse(
      `Google Fonts answered ${css.status} for that family and those styles`,
    )
  if (!under(css.url, hosts.css))
    refuse('its stylesheet came from another host')
  // ponytail: latin only; add latin-ext and unicode-range when a site writes in another script
  const faces = latinFaces(new TextDecoder().decode(css.bytes), hosts.files)
  // a weight the family lacks is skipped (the browser then uses the nearest face); the family is refused only when none matches
  const has = (p: Pair) =>
    faces.some(
      f =>
        (f.style === 'italic') === (p[0] === 1) && f.lo <= p[1] && p[1] <= f.hi,
    )
  if (!sorted.some(has))
    refuse(`it has no latin file for any of the weights asked`)
  const group = new Map<string, Face>()
  for (const f of faces) {
    const k = `${f.style}|${f.url}`
    const g = group.get(k)
    group.set(
      k,
      g ? { ...g, lo: Math.min(g.lo, f.lo), hi: Math.max(g.hi, f.hi) } : f,
    )
  }
  const woff2 = new Map<string, Uint8Array>()
  const files: SiteFont['files'] = []
  const bytesOf = new Map<string, Uint8Array>()
  for (const f of group.values()) {
    const file = `${f.lo}${f.hi === f.lo ? '' : `-${f.hi}`}${f.style === 'italic' ? '-italic' : ''}.woff2`
    if (woff2.has(file)) return refuse('two files would have the same name')
    let bytes = bytesOf.get(f.url)
    if (!bytes) {
      const r = await one(f.url, MAX_FONT)
      if (!under(r.url, hosts.files))
        return refuse('a file was served from another host')
      if (new TextDecoder('latin1').decode(r.bytes.subarray(0, 4)) !== 'wOF2')
        return refuse('a file is not woff2')
      bytes = r.bytes
      bytesOf.set(f.url, bytes)
    }
    woff2.set(file, bytes)
    files.push({
      weight: f.lo === f.hi ? f.lo : [f.lo, f.hi],
      style: f.style,
      file,
    })
  }
  // licence and kind sit in the folder of the family in the Google Fonts repository
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, '')
  let licence: SiteFont['licence'] | undefined
  let text: Uint8Array | undefined
  let where = ''
  for (const [folder, file, id] of [
    ['ofl', 'OFL.txt', 'OFL-1.1'],
    ['apache', 'LICENSE.txt', 'Apache-2.0'],
    ['ufl', 'UFL.txt', 'UFL-1.0'],
  ] as const) {
    const r = await get(`${hosts.licence}/${folder}/${dir}/${file}`, MAX_TEXT)
    if (r.status === 404) continue
    if (r.status !== 200 || !under(r.url, hosts.licence))
      return refuse(`its licence answered ${r.status}`)
    ;[licence, text, where] = [id, r.bytes, folder]
    break
  }
  if (!licence || !text)
    return refuse(
      /^source sans pro$/i.test(family)
        ? 'its licence was not found: the family was renamed, try "Source Sans 3"'
        : 'its licence was not found',
    )
  const meta = await get(
    `${hosts.licence}/${where}/${dir}/METADATA.pb`,
    MAX_TEXT,
  )
  if (meta.status === 200 && !under(meta.url, hosts.licence))
    return refuse('its metadata came from another host')
  const category =
    meta.status === 200
      ? /^category:\s*"([A-Z_ ]+)"/m.exec(
          new TextDecoder().decode(meta.bytes),
        )?.[1]
      : undefined
  const kind =
    category === 'SERIF'
      ? 'serif'
      : category === 'MONOSPACE'
        ? 'mono'
        : category === 'DISPLAY' || category === 'HANDWRITING'
          ? 'display'
          : 'sans'
  const font = checkSiteFont({
    family,
    kind,
    licence,
    source: sourceOf(sorted),
    files,
  })
  if (!font) return refuse('what it sent cannot be stored as a font')
  return { slug: fontSlug(family), font, licence: text, woff2 }
}

const plain = async (p: string) => {
  try {
    const s = await lstat(p)
    return s.isDirectory() && !s.isSymbolicLink()
  } catch {
    return undefined
  }
}

/** Writes the fetched families: each is built whole in a temporary folder, then swapped in by rename. */
async function store(dir: string, got: Fetched[]): Promise<void> {
  const root = join(dir, 'fonts')
  if ((await plain(root)) === false) refuse('fonts/ is not a plain folder')
  await mkdir(root, { recursive: true })
  if ((await plain(root)) !== true) refuse('fonts/ is not a plain folder')
  const made: string[] = []
  try {
    const staged = got.map(g => {
      const tmp = join(root, `.fetch-${randomUUID()}`)
      made.push(tmp)
      return { g, tmp }
    })
    for (const { g, tmp } of staged) {
      if ((await plain(join(root, g.slug))) === false)
        refuse(`fonts/${g.slug} is not a plain folder`)
      await mkdir(tmp)
      await writeFile(join(tmp, 'LICENSE'), g.licence)
      for (const [name, bytes] of g.woff2)
        await writeFile(join(tmp, name), bytes)
      await writeFile(
        join(tmp, 'font.json'),
        `${JSON.stringify(g.font, null, 2)}\n`,
      )
    }
    for (const { g, tmp } of staged) {
      const to = join(root, g.slug)
      if (await plain(to)) {
        const old = join(root, `.old-${randomUUID()}`)
        made.push(old)
        await rename(to, old)
      }
      await rename(tmp, to)
    }
  } finally {
    for (const m of made) await rm(m, { recursive: true, force: true })
  }
}

// ---- icons ----

type NodeLike = {
  id?: unknown
  kind?: unknown
  props?: unknown
  children?: unknown
}
/** The icon names a node names, by the prop its kind reads: an icon's `name`, a button's `icon`. */
const iconProp = (kind: unknown) =>
  kind === 'icon' ? 'name' : kind === 'button' ? 'icon' : undefined

/** Every `set:name` the batch gives to an icon or a button: in an `add` (at any depth), or in a `setProps` of one (held or added earlier). */
function iconNames(doc: SiteDocument, ops: unknown[]): Map<string, number> {
  const out = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const note = (id: unknown, kind: unknown) => {
    if (typeof id !== 'string' || typeof kind !== 'string') return
    kinds.set(id, (kinds.get(id) ?? new Set()).add(kind))
  }
  const walk = (n: unknown, fn: (n: NodeLike) => void, depth = 0) => {
    if (!isObj(n) || depth > 64) return
    fn(n)
    if (Array.isArray(n.children))
      for (const c of n.children) walk(c, fn, depth + 1)
  }
  const roots = [
    ...doc.pages.map(p => p.root),
    doc.header,
    doc.footer,
    ...(doc.components ?? []).map(c => c.root),
  ]
  for (const r of roots) walk(r, n => note(n.id, n.kind))
  const take = (kind: unknown, props: unknown, op: number) => {
    const key = iconProp(kind)
    if (!key || !isObj(props)) return
    const v = props[key]
    if (
      typeof v === 'string' &&
      v.length <= 80 &&
      ICON_NAME_RE.test(v) &&
      !out.has(v)
    )
      out.set(v, op)
  }
  ops.forEach((op, i) => {
    if (!isObj(op)) return
    if (op.op === 'add')
      walk(op.node, n => {
        note(n.id, n.kind)
        take(n.kind, n.props, i)
      })
    else if (op.op === 'setProps' && typeof op.id === 'string')
      for (const k of kinds.get(op.id) ?? []) take(k, op.props, i)
  })
  return out
}

type Icon = { set: string; name: string; svg: string }

const clean = (v: unknown, max = 200) =>
  typeof v === 'string'
    ? v
        .replace(/[^\x20-\x7e]/g, ' ')
        .trim()
        .slice(0, max)
    : ''
const url = (v: unknown) =>
  /^https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(clean(v, 300))
    ? clean(v, 300)
    : ''

class Policy extends Error {}
/** A refusal about one icon, by its `set:name`. */
class IconError extends Refused {
  constructor(
    readonly full: string,
    m: string,
  ) {
    super(m)
  }
}

/** One set: the licence check (refused unless allowed), the LICENSE file, then the wanted icons as svg text. Nothing but LICENSE is written here. */
async function fetchSet(
  dir: string,
  set: string,
  names: string[],
  hosts: FetchHosts,
  get: Get,
): Promise<Icon[]> {
  const info = await get(
    `${hosts.icons}/collection?prefix=${set}&info=true`,
    MAX_TEXT,
  )
  if (info.status !== 200)
    refuse(`Iconify answered ${info.status} for the set ${set}`)
  if (!under(info.url, hosts.icons))
    refuse('Iconify answered from another host')
  const meta = parse(info.bytes)
  const lic =
    isObj(meta) && isObj(meta.info) && isObj(meta.info.license)
      ? meta.info.license
      : undefined
  const spdx = lic && typeof lic.spdx === 'string' ? lic.spdx : ''
  if (!ICON_LICENCES.includes(spdx))
    throw new Policy(
      `The icon set ${set} is licensed ${clean(spdx, 40) || 'unknown'}; Culm fetches only ${ICON_LICENCES.join(', ')}.`,
    )
  const about = isObj(meta) && isObj(meta.info) ? meta.info : {}
  const author = isObj(about.author) ? about.author : {}
  await writeLicence(
    dir,
    set,
    [
      `Set: ${clean(about.name, 80) || set}`,
      `Author: ${clean(author.name, 80) || 'unknown'}`,
      `Licence: ${spdx}`,
      `Title: ${clean(lic!.title, 80) || spdx}`,
      `URL: ${url(lic!.url) || 'none given'}`,
      `Source: ${hosts.icons}/${set}.json`,
      '',
    ].join('\n'),
  )
  const r = await get(
    `${hosts.icons}/${set}.json?icons=${names.join(',')}`,
    MAX_TEXT,
  )
  if (r.status !== 200) refuse(`Iconify answered ${r.status} for ${set}`)
  if (!under(r.url, hosts.icons)) refuse('Iconify answered from another host')
  const data = parse(r.bytes)
  if (!isObj(data) || !isObj(data.icons)) return refuse('Iconify sent no icons')
  const aliases = isObj(data.aliases) ? data.aliases : {}
  const num = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 4096 ? v : d
  return names.map(name => {
    const full = `${set}:${name}`
    const bad = (m: string): never => {
      throw new IconError(full, m)
    }
    const icon = Object.hasOwn(data.icons as object, name)
      ? (data.icons as Record<string, unknown>)[name]
      : undefined
    if (!icon && Object.hasOwn(aliases, name))
      return bad(`${full} is an alias; name the icon it points at`)
    if (!isObj(icon) || typeof icon.body !== 'string')
      return bad(`${full} is not in the set`)
    if (icon.rotate || icon.hFlip || icon.vFlip)
      return bad(`${full} uses something Culm does not draw`)
    const w = num(icon.width, num(data.width, 16))
    const h = num(icon.height, num(data.height, w))
    const left = num(icon.left, num(data.left, 0))
    const top = num(icon.top, num(data.top, 0))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${w} ${h}">${icon.body}</svg>`
    if (!siteIcon(svg)) return bad(`${full} uses something Culm does not draw`)
    return { set, name, svg }
  })
}

const parse = (b: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(b))
  } catch {
    return undefined
  }
}

/** `assets/icons/<set>`, each step a plain folder (a link or a file in the way is refused). */
async function iconDir(dir: string, set: string): Promise<string> {
  let at = dir
  for (const part of ['assets', 'icons', set]) {
    at = join(at, part)
    if ((await plain(at)) === false)
      refuse(`${at.slice(dir.length + 1)} is not a plain folder`)
    await mkdir(at, { recursive: true })
    if ((await plain(at)) !== true)
      refuse(`${at.slice(dir.length + 1)} is not a plain folder`)
  }
  return at
}

/** Writes through a temporary name and a rename, so a reader never sees half a file. */
async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.fetch-${randomUUID()}`
  try {
    await writeFile(tmp, data, { flag: 'wx' })
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true })
  }
}

async function writeLicence(
  dir: string,
  set: string,
  text: string,
): Promise<void> {
  const d = await iconDir(dir, set)
  if ((await readdir(d)).includes('LICENSE')) return
  await writeAtomic(join(d, 'LICENSE'), text)
}

async function storeIcons(dir: string, icons: Icon[]): Promise<void> {
  for (const i of icons)
    await writeAtomic(join(await iconDir(dir, i.set), `${i.name}.svg`), i.svg)
}

type Want = {
  op: number
  index: number
  family: string
  weights: number[]
  italic: boolean
}

/**
 * Before core sees a batch of operations on a folder site: fetches what it names (a Google family in `setFonts`), stores it in the
 * folder, and returns the operations with each such entry written as `up:<name>`.
 * With `defer`, only normalize and inspect held files; the returned `publish()`
 * performs the ordinary fetch and returns its problems after the caller checks the normalized batch.
 */
export async function fetchFor(
  dir: string,
  doc: SiteDocument,
  ops: unknown[],
  o: FetchOptions = {},
  defer = false,
): Promise<
  | { ok: true; ops: unknown[]; publish?: () => Promise<Problem[]> }
  | { ok: false; problems: Problem[] }
> {
  const hosts = o.hosts ?? HOSTS
  const get = o.get ?? makeGet()
  const heldAll = await readHeld(dir)
  const held = heldAll.fonts
  const wants: Want[] = []
  const problems: Problem[] = []
  const names = new Set(Object.keys(held))
  // pass 1: what the batch asks for, checked
  ops.forEach((op, i) => {
    if (!isObj(op) || op.op !== 'setFonts' || !Array.isArray(op.fonts)) return
    op.fonts.forEach((f: unknown, j: number) => {
      const path = `fonts.${j}`
      if (typeof f === 'string' && f.startsWith('up:')) {
        if (
          !names.has(f.slice(3)) &&
          !wants.some(w => `up:${fontSlug(w.family)}` === f)
        )
          problems.push(
            inv(
              `${f.slice(0, 80)} is not held by this site; name the family as {google:"Name"} to fetch it.`,
              i,
              path,
            ),
          )
        return
      }
      if (!isObj(f) || !('google' in f)) return
      const { google, weights = [400, 700], italic = false } = f
      if (
        typeof google !== 'string' ||
        !/^[A-Za-z0-9 ]{1,64}$/.test(google) ||
        !fontSlug(google)
      )
        return void problems.push(
          inv(
            'google must be a family name: letters, digits and spaces, at most 64.',
            i,
            `${path}.google`,
          ),
        )
      if (
        !Array.isArray(weights) ||
        weights.length < 1 ||
        weights.length > 9 ||
        !weights.every(
          w => Number.isInteger(w) && w >= 100 && w <= 900 && w % 100 === 0,
        )
      )
        return void problems.push(
          inv(
            'weights must be 1 to 9 numbers from 100 to 900 in steps of 100.',
            i,
            `${path}.weights`,
          ),
        )
      if (typeof italic !== 'boolean')
        return void problems.push(
          inv('italic must be true or false.', i, `${path}.italic`),
        )
      wants.push({
        op: i,
        index: j,
        family: google,
        weights: weights as number[],
        italic,
      })
    })
  })
  if (problems.length) return { ok: false, problems }
  const families = new Map<string, Want[]>()
  for (const w of wants)
    families.set(fontSlug(w.family), [
      ...(families.get(fontSlug(w.family)) ?? []),
      w,
    ])
  if (families.size > MAX_FAMILIES)
    return {
      ok: false,
      problems: [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          message: `A batch fetches at most ${MAX_FAMILIES} font families; this one names ${families.size}.`,
          op: wants[0]!.op,
        },
      ],
    }
  const wantIcons = [...iconNames(doc, ops)].filter(
    ([n]) => !Object.hasOwn(heldAll.icons, n),
  )
  if (wantIcons.length > MAX_ICONS)
    return {
      ok: false,
      problems: [
        {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          message: `A batch fetches at most ${MAX_ICONS} icons; this one names ${wantIcons.length}.`,
          op: wantIcons[0]![1],
        },
      ],
    }
  const normalized = ops.map((op, i) =>
    wants.some(w => w.op === i) && isObj(op) && Array.isArray(op.fonts)
      ? {
          ...op,
          fonts: op.fonts.map((f: unknown, j: number) => {
            const w = wants.find(x => x.op === i && x.index === j)
            return w ? `up:${fontSlug(w.family)}` : f
          }),
        }
      : op,
  )
  const ready = { ok: true as const, ops: normalized }
  if (!wantIcons.length && !families.size) return ready
  if (defer) return { ...ready, publish }
  const failed = await publish()
  return failed.length ? { ok: false, problems: failed } : ready

  // All I/O that can publish held assets (including icon licences) follows
  // normalization. MCP can check these exact ops before it runs this phase.
  async function publish(): Promise<Problem[]> {
    const got: Fetched[] = []
    for (const [slug, ws] of families) {
      const asked = new Map<string, Pair>()
      for (const w of ws)
        for (const wt of w.weights)
          for (const i of w.italic ? [0, 1] : [0])
            asked.set(`${i},${wt}`, [i as 0 | 1, wt])
      try {
        const g = await fetchFamily(
          ws[0]!.family,
          [...asked.values()],
          held[slug],
          hosts,
          get,
        )
        if (g) got.push(g)
      } catch (e) {
        return [
          {
            code: 'FETCH_FAILED',
            message: `Could not fetch the font "${ws[0]!.family}": ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
            op: ws[0]!.op,
          },
        ]
      }
    }
    const icons: Icon[] = []
    const sets = new Map<string, [name: string, op: number][]>()
    for (const [n, op] of wantIcons) {
      const [set, name] = n.split(':') as [string, string]
      sets.set(set, [...(sets.get(set) ?? []), [name, op]])
    }
    for (const [set, ns] of sets) {
      let op = Math.min(...ns.map(x => x[1]))
      const list = ns
        .map(x => `${set}:${x[0]}`)
        .join(', ')
        .slice(0, 120)
      try {
        icons.push(
          ...(await fetchSet(
            dir,
            set,
            ns.map(x => x[0]),
            hosts,
            get,
          )),
        )
      } catch (e) {
        const m = (e instanceof Error ? e.message : String(e)).slice(0, 200)
        if (e instanceof IconError)
          op = wantIcons.find(([n]) => n === e.full)?.[1] ?? op
        return [
          e instanceof Policy
            ? { code: 'POLICY_VIOLATION', message: m, rule: 'icon-licence', op }
            : {
                code: 'FETCH_FAILED',
                message: `Could not fetch the icon ${list}: ${m}`,
                op,
              },
        ]
      }
    }
    try {
      if (got.length) await store(dir, got)
      await storeIcons(dir, icons)
    } catch (e) {
      return [
        {
          code: 'FETCH_FAILED',
          message: `Could not store ${got[0] ? `the font "${got[0].font.family}"` : `the icon ${icons[0] ? `${icons[0].set}:${icons[0].name}` : ''}`}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
          op: wants[0]?.op ?? wantIcons[0]?.[1] ?? 0,
        },
      ]
    }
    return []
  }
}
