import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { FONTS, buildIdentity, compileSite } from '@culmjs/core'
import type { Manifest, SiteDocument } from '@culmjs/core'
import { SOURCES } from '../shared.ts'
import { inside, media, refusal } from '../folder/files.ts'
import type { Loaded } from '../folder/load.ts'
import type { Located } from '../folder/plugins.ts'
import type { Project } from '../folder/project.ts'

export const MANIFEST_FILE = 'culm-manifest.json'

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  )

/** The SHA-256 of every file under fonts/ and assets/ (project-relative, `/` separators), in path order. Links that leave the project are not read. */
export const fileHashes = async (dir: string) => (await media(dir)).hashes

// ponytail: macOS and Windows file systems ignore case by default, so paths compare lower-cased there; a case-sensitive volume on them is refused slightly more often.
const fold = (p: string) =>
  process.platform === 'darwin' || process.platform === 'win32'
    ? p.toLowerCase()
    : p
const within = (inner: string, outer: string) =>
  fold(inner) === fold(outer) || inside(fold(outer), fold(inner))
/** The real path of a path that may not exist yet: the nearest existing ancestor's real path plus the missing segments. */
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
/** True when the output folder, by real path, is, holds or lies inside the project folder or one of its source folders. */
async function outRefused(dir: string, target: string): Promise<boolean> {
  const out = await realish(target)
  const root = await realish(dir)
  if (within(root, out)) return true
  for (const name of SOURCES) {
    const src = join(root, name)
    if (within(out, src) || within(out, await realish(src))) return true
  }
  return false
}

const bad = (message: string, extra: Partial<Located> = {}): Located => ({
  code: 'INVALID_DOCUMENT',
  message,
  ...extra,
})

/** A page that is on may not take a path build writes. Shared with the dev server. */
export function slugProblems(doc: SiteDocument, loaded: Loaded): Located[] {
  const problems: Located[] = []
  for (const p of doc.pages) {
    const top = p.slug.split('/')[1]
    if (p.on && (top === 'assets' || top === '_fonts' || top === MANIFEST_FILE))
      problems.push(
        loaded.map.locateProblem(
          bad(`The slug "${p.slug}" is a path the build writes ("${top}").`, {
            path: `pages.${p.id}.slug`,
          }),
        ),
      )
  }
  return problems
}

/** The font files the compiled pages ask for (the @font-face rules of the fonts actually used) must be in fonts/. Shared with the dev server. */
export function fontProblems(
  files: { content: string }[],
  hashes: { path: string }[],
  loaded: Loaded,
): Located[] {
  const problems: Located[] = []
  const where = (needle: string) => {
    for (const f of loaded.files) {
      const i = f.text.split('\n').findIndex(l => l.includes(needle))
      if (i >= 0) return { file: f.path, line: i + 1 }
    }
    return {}
  }
  const have = new Set(hashes.map(h => h.path))
  const wanted = new Set(
    files.flatMap(f =>
      [...f.content.matchAll(/@font-face\{[^}]*\/_fonts\/([^)"']+)\)/g)].map(
        m => m[1]!,
      ),
    ),
  )
  for (const file of [...wanted].sort())
    if (!have.has(`fonts/${file}`)) {
      const id = Object.keys(FONTS).find(k =>
        FONTS[k]!.files.some(f => f.file === file),
      )
      problems.push(
        bad(
          `The font file fonts/${file} is missing.`,
          id ? where(`"cat:${id}"`) : {},
        ),
      )
    }
  return problems
}

/**
 * Compiles the site and writes it to `out` (default: the project's `out`). Any problem: nothing is written. `out` is cleared first,
 * but only when it is empty or holds `culm-manifest.json`; any other non-empty folder is refused and left alone.
 */
export async function buildSite(
  project: Project,
  out?: string,
): Promise<
  | { ok: true; out: string; manifest: Manifest; files: string[] }
  | { ok: false; problems: Located[] }
> {
  const { dir, loaded, registry, links } = project
  const target = resolve(dir, out ?? project.config.out)
  const doc = loaded.doc
  if (!doc || loaded.problems.length)
    return {
      ok: false,
      problems: loaded.problems.length
        ? loaded.problems
        : [bad('The project could not be loaded.')],
    }

  const problems: Located[] = []

  // the folder build may clear is never the project folder or one that holds it
  if (await outRefused(dir, target))
    problems.push(
      bad(
        `The output folder "${target}" is, holds or lies inside the project folder or one of its source folders.`,
      ),
    )
  if (!problems.length && (await exists(target))) {
    const st = await lstat(target)
    const names = st.isDirectory() ? await readdir(target) : ['']
    if (!st.isDirectory() || (names.length && !names.includes(MANIFEST_FILE)))
      problems.push(
        bad(
          `The output folder "${target}" is not empty and has no ${MANIFEST_FILE}; it was left as it is.`,
        ),
      )
  }

  problems.push(...slugProblems(doc, loaded))

  const { files: media_, refused, hashes } = await media(dir)
  for (const [rel, why] of refused) problems.push(refusal(rel, why))
  const site = compileSite(doc, {
    registry,
    data: loaded.data,
    links,
    fonts: project.held.fonts,
    icons: project.held.icons,
  })
  problems.push(...site.problems.map(p => loaded.map.locateProblem(p)))
  problems.push(...fontProblems(site.files, hashes, loaded))
  if (problems.length) return { ok: false, problems }

  const manifest: Manifest = {
    ...site.manifest,
    build: await buildIdentity(doc, loaded.data, registry, hashes),
  }
  let cleared = false
  try {
    if (await exists(target))
      // the old manifest goes last, so a failed clear leaves a folder a later build may still clear
      for (const n of (await readdir(target)).sort(
        (x, y) => +(x === MANIFEST_FILE) - +(y === MANIFEST_FILE),
      ))
        await rm(join(target, n), { recursive: true, force: true })
    cleared = true
    await mkdir(target, { recursive: true })
    for (const f of site.files) {
      await mkdir(dirname(join(target, f.path)), { recursive: true })
      await writeFile(join(target, f.path), f.content)
    }
    // regular files only: a link in the project is copied as the file it names, never written as a link
    for (const [rel, real] of media_) {
      const to = join(target, rel.startsWith('fonts/') ? `_${rel}` : rel)
      await mkdir(dirname(to), { recursive: true })
      await copyFile(real, to)
    }
    await writeFile(
      join(target, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2) + '\n',
    )
  } catch (e) {
    return {
      ok: false,
      problems: [
        bad(
          `The build could not write "${target}": ${e instanceof Error ? e.message : String(e)}${cleared ? ` The output folder has no ${MANIFEST_FILE} now; delete it by hand before the next build.` : ''}`,
        ),
      ],
    }
  }
  return {
    ok: true,
    out: target,
    manifest,
    files: [
      ...site.files.map(f => f.path),
      ...hashes.map(h => (h.path.startsWith('fonts/') ? `_${h.path}` : h.path)),
      MANIFEST_FILE,
    ],
  }
}
