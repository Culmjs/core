import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
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

// Reserve the same source directory names on all platforms, including when
// the output does not exist yet or the project moves between file systems.
const fold = (p: string) => p.toLowerCase()
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
    if (
      p.on &&
      ['assets', '_fonts', '_culm', '_headers', MANIFEST_FILE].includes(top)
    )
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
  files: { path: string; content: string }[],
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
    files
      .filter(f => f.path.endsWith('index.html'))
      .flatMap(f =>
        [
          ...(
            f.content.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
          ).matchAll(/@font-face\{[^}]*\/_fonts\/([^)"']+)\)/g),
        ].map(m => m[1]!),
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
 * Stages a complete bundle before replacing `out` (default: the project's `out`). Only a missing,
 * empty or previously built destination can be replaced.
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
  let staging: string | undefined
  let backup: string | undefined
  try {
    await mkdir(dirname(target), { recursive: true })
    staging = await mkdtemp(
      join(dirname(target), `.${basename(target)}-build-`),
    )
    const next = join(staging, 'next')
    await mkdir(next)
    for (const f of site.files) {
      await mkdir(dirname(join(next, f.path)), { recursive: true })
      await writeFile(join(next, f.path), f.content)
    }
    // regular files only: a link in the project is copied as the file it names, never written as a link
    for (const [rel, real] of media_) {
      const to = join(next, rel.startsWith('fonts/') ? `_${rel}` : rel)
      await mkdir(dirname(to), { recursive: true })
      await copyFile(real, to)
    }
    await writeFile(
      join(next, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2) + '\n',
    )
    if (await exists(target)) {
      const previous = join(staging, 'previous')
      await rename(target, previous)
      backup = previous
    }
    await rename(next, target)
    backup = undefined
  } catch (e) {
    if (backup) {
      try {
        await rename(backup, target)
        backup = undefined
      } catch {
        /* Preserve the previous bundle at the named backup. */
      }
    }
    return {
      ok: false,
      problems: [
        bad(
          `The build could not write "${target}": ${e instanceof Error ? e.message : String(e)}${backup ? ` The previous output is at "${backup}".` : ''}`,
        ),
      ],
    }
  } finally {
    if (staging && !backup)
      await rm(staging, { recursive: true, force: true }).catch(() => {})
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
