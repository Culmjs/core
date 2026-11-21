import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { FONTS, buildIdentity, compileSite } from '@culmjs/core'
import type { Manifest } from '@culmjs/core'
import { RESERVED, type Located } from '../folder/plugins.ts'
import type { Project } from '../folder/project.ts'

export const MANIFEST_FILE = 'culm-manifest.json'

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  )

/** The SHA-256 of every file under fonts/ and assets/ (project-relative, `/` separators), in path order. Symbolic links are not followed. */
export async function fileHashes(
  dir: string,
): Promise<{ path: string; sha256: string }[]> {
  const out: { path: string; sha256: string }[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(dir, rel), {
      withFileTypes: true,
    }).catch(() => [])
    for (const e of entries) {
      const p = `${rel}/${e.name}`
      if (e.isDirectory()) await walk(p)
      else if (e.isFile())
        out.push({
          path: p,
          sha256: createHash('sha256')
            .update(await readFile(join(dir, p)))
            .digest('hex'),
        })
    }
  }
  await walk('fonts')
  await walk('assets')
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const bad = (message: string, extra: Partial<Located> = {}): Located => ({
  code: 'INVALID_DOCUMENT',
  message,
  ...extra,
})

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

  const where = (needle: string) => {
    for (const f of loaded.files) {
      const i = f.text.split('\n').findIndex(l => l.includes(needle))
      if (i >= 0) return { file: f.path, line: i + 1 }
    }
    return {}
  }
  const problems: Located[] = []

  // the folder build may clear is never the project folder or one that holds it
  const up = relative(target, resolve(dir))
  const inside = relative(resolve(dir), target)
  if (RESERVED.test(inside.split(sep).join('/')))
    problems.push(
      bad(`The output folder "${inside}" is, or lies inside, a source folder.`),
    )
  else if (up === '' || !(up === '..' || up.startsWith(`..${sep}`)))
    problems.push(
      bad(`The output folder "${target}" is, or holds, the project folder.`),
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

  // a page may not take a path build writes
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

  const hashes = await fileHashes(dir)
  const site = compileSite(doc, { registry, data: loaded.data, links })
  problems.push(...site.problems.map(p => loaded.map.locateProblem(p)))
  // the font files the compiled pages ask for (the @font-face rules of the fonts actually used) are in fonts/
  const have = new Set(hashes.map(h => h.path))
  const wanted = new Set(
    site.files.flatMap(f =>
      [...f.content.matchAll(/\/_fonts\/([^)"']+)\)/g)].map(m => m[1]!),
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
  if (problems.length) return { ok: false, problems }

  const manifest: Manifest = {
    ...site.manifest,
    build: await buildIdentity(doc, loaded.data, registry, hashes),
  }
  try {
    if (await exists(target))
      // the old manifest goes last, so a failed clear leaves a folder a later build may still clear
      for (const n of (await readdir(target)).sort(
        (x, y) => +(x === MANIFEST_FILE) - +(y === MANIFEST_FILE),
      ))
        await rm(join(target, n), { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    for (const f of site.files) {
      await mkdir(dirname(join(target, f.path)), { recursive: true })
      await writeFile(join(target, f.path), f.content)
    }
    for (const [from, to] of [
      ['assets', 'assets'],
      ['fonts', '_fonts'],
    ] as const)
      if (await exists(join(dir, from)))
        await cp(join(dir, from), join(target, to), { recursive: true })
    await writeFile(
      join(target, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2) + '\n',
    )
  } catch (e) {
    return {
      ok: false,
      problems: [
        bad(
          `The build could not write "${target}": ${e instanceof Error ? e.message : String(e)}`,
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
