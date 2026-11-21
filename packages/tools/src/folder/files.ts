import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

/** True when `real` is a path strictly inside `root` (both real paths). */
export const inside = (root: string, real: string) => {
  const r = relative(root, real)
  return r !== '' && !(r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r))
}

/** Project-relative path (`/` separators) to its real path, and to the reason a link was refused. */
export type Walked = {
  files: Map<string, string>
  refused: Map<string, string>
}

/**
 * The one reader of project files. Lists the regular files under `roots` (files or folders of the project), following nothing whose
 * real path leaves the project root: such a link is listed in `refused` (not read), and a link inside the project to a file counts
 * as that file. A link to a folder is skipped. `keep` filters by project-relative path.
 */
export async function walkFiles(
  dir: string,
  roots: string[],
  keep: (rel: string) => boolean = () => true,
): Promise<Walked> {
  const root = await realpath(dir)
  const files = new Map<string, string>()
  const refused = new Map<string, string>()
  const one = async (rel: string): Promise<void> => {
    const abs = join(dir, rel)
    let info
    try {
      info = await lstat(abs)
    } catch {
      return
    }
    if (info.isSymbolicLink()) {
      let real: string
      try {
        real = await realpath(abs)
      } catch {
        refused.set(rel, 'its target cannot be read')
        return
      }
      if (!inside(root, real)) {
        refused.set(rel, 'it is a symbolic link that leaves the project')
        return
      }
      if ((await stat(real)).isFile() && keep(rel)) files.set(rel, real)
      return
    }
    if (info.isDirectory()) {
      for (const name of (await readdir(abs)).sort())
        await one(posix.join(rel, name))
    } else if (info.isFile() && keep(rel)) files.set(rel, abs)
  }
  for (const rel of roots) await one(rel)
  return { files, refused }
}

/** Every file under assets/ and fonts/ with the SHA-256 of its bytes, in path order; the links refused. */
export async function media(dir: string) {
  const { files, refused } = await walkFiles(dir, ['fonts', 'assets'])
  const hashes = await Promise.all(
    [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(async ([path, real]) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(real))
          .digest('hex'),
      })),
  )
  return { files, refused, hashes }
}

/**
 * The real path of `rest` under the project folder `base` (`assets`, `fonts`), or undefined. The lexical path stays inside `base`;
 * the real path must be a regular file inside the project. Checked on every call: a link can change while a server runs.
 */
export async function resolveFile(
  dir: string,
  base: string,
  rest: string,
): Promise<string | undefined> {
  try {
    const from = resolve(dir, base)
    const abs = resolve(from, rest)
    if (!inside(from, abs)) return undefined
    const real = await realpath(abs)
    if (!inside(await realpath(dir), real) || !(await stat(real)).isFile())
      return undefined
    return real
  } catch {
    return undefined
  }
}

/** The bytes of a project file `assets/…` or `fonts/…` by the rule of `resolveFile`, or undefined. */
export async function readAsset(dir: string, path: string) {
  const [base, ...rest] = path.split('/')
  const real = await resolveFile(dir, base!, rest.join('/'))
  return real ? readFile(real).catch(() => undefined) : undefined
}

/** The text of a refusal, as the loader words it. */
export const refusal = (rel: string, why: string) => ({
  code: 'POLICY_VIOLATION' as const,
  message: `${rel} is refused: ${why}.`,
  file: rel,
  line: 1,
  column: 1,
})
