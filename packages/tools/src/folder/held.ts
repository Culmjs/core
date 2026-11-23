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

/**
 * What the project folder holds that a build uses: the fonts under `fonts/<name>/font.json`, and the icons under
 * `assets/icons/<set>/<name>.svg` (each next to its set's `LICENSE`, and accepted by `siteIcon`). A font counts only when its file passes
 * `checkSiteFont`, sits in the folder named by its family, and every file it lists is there. Anything else is skipped, never read as a font.
 */
export async function readHeld(
  dir: string,
): Promise<{ fonts: SiteFonts; icons: SiteIcons }> {
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
  return { fonts, icons: await readIcons(dir) }
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
