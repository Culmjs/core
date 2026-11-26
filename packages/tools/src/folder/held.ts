import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import {
  checkSiteFont,
  fontSlug,
  ICON_NAME_RE,
  siteIcon,
  type SiteFonts,
  type SiteIcons,
} from '@culmjs/core'
import { walkFiles } from './files.ts'
import type { ResolvedAsset } from '../image/generate.ts'

/**
 * What the project folder holds that a build uses: the fonts under `fonts/<name>/font.json`, the icons under
 * `assets/icons/<set>/<name>.svg` (each next to its set's `LICENSE`, and accepted by `siteIcon`), and generated images
 * under `assets/gen/<stem>.(webp|png|jpg)`.
 */
export async function readHeld(dir: string): Promise<{
  fonts: SiteFonts
  icons: SiteIcons
  generated: Map<string, ResolvedAsset>
}> {
  const fonts: SiteFonts = {}
  // a folder that cannot be read holds nothing; the loader reports it
  const { files } = await walkFiles(dir, ['fonts'], () => true, true).catch(
    () => ({ files: new Map<string, string>() }),
  )
  for (const [rel, real] of files) {
    const m = /^fonts\/([^/]+)\/font\.json$/.exec(rel)
    if (!m) continue
    try {
      // the font's folder is a real folder, and every file of it really lives in it
      const own = join(await realpath(join(dir, 'fonts')), m[1]!)
      if (
        !(await lstat(join(dir, 'fonts', m[1]!))).isDirectory() ||
        (await realpath(own)) !== own ||
        !(await realpath(real)).startsWith(own + sep)
      )
        continue
      const f = checkSiteFont(JSON.parse(await readFile(real, 'utf8')))
      if (
        f &&
        fontSlug(f.family) === m[1] &&
        (
          await Promise.all(
            f.files.map(async x => {
              const r = files.get(`fonts/${m[1]}/${x.file}`)
              return (
                r !== undefined && (await realpath(r)).startsWith(own + sep)
              )
            }),
          )
        ).every(Boolean)
      )
        fonts[m[1]!] = f
    } catch {
      // unreadable or not JSON: not a font
    }
  }
  return {
    fonts,
    icons: await readIcons(dir),
    generated: await readGenerated(dir),
  }
}

const GEN_FILE = /^assets\/(gen\/[^/]+)\.(webp|png|jpg)$/
const GEN_META = /^assets\/(gen\/[^/]+)\.json$/

async function readGenerated(dir: string): Promise<Map<string, ResolvedAsset>> {
  const out = new Map<string, ResolvedAsset>()
  const { files } = await walkFiles(
    dir,
    ['assets'],
    rel => GEN_FILE.test(rel) || GEN_META.test(rel),
    true,
  ).catch(() => ({ files: new Map<string, string>() }))
  for (const [rel] of files) {
    const m = GEN_FILE.exec(rel)
    if (!m) continue
    const stem = m[1]!
    let width: number | undefined
    let height: number | undefined
    const metaReal = files.get(`assets/${stem}.json`)
    if (metaReal) {
      try {
        const meta = JSON.parse(await readFile(metaReal, 'utf8')) as {
          width?: unknown
          height?: unknown
        }
        if (typeof meta.width === 'number' && meta.width > 0) width = meta.width
        if (typeof meta.height === 'number' && meta.height > 0)
          height = meta.height
      } catch {
        // ignore unreadable sidecar
      }
    }
    out.set(stem, {
      assetId: `${stem}.${m[2]!}`,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    })
  }
  return out
}

const ICON_FILE = /^assets\/icons\/([^/]+)\/([^/]+)\.svg$/
const ICON_LICENCE = /^assets\/icons\/[^/]+\/LICENSE$/

async function readIcons(dir: string): Promise<SiteIcons> {
  const icons: SiteIcons = {}
  const { files } = await walkFiles(
    dir,
    ['assets'],
    rel => ICON_FILE.test(rel) || ICON_LICENCE.test(rel),
    true,
  ).catch(() => ({ files: new Map<string, string>() }))
  for (const [rel, real] of files) {
    const m = ICON_FILE.exec(rel)
    if (!m || !files.has(`assets/icons/${m[1]}/LICENSE`)) continue
    const name = `${m[1]}:${m[2]}`
    if (!ICON_NAME_RE.test(name)) continue
    try {
      const text = await readFile(real, 'utf8')
      if (siteIcon(text)) icons[name] = text
    } catch {
      // unreadable: not an icon
    }
  }
  return icons
}
