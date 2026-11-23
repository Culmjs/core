import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Problem } from '@culmjs/core'
import { openProject } from '../folder/project.ts'
import { authoringSchema } from '../schema/authoring.ts'

const PACKAGES = ['core', 'starter', 'tools'] as const

const refuse = (message: string): { ok: false; problems: Problem[] } => ({
  ok: false,
  problems: [{ code: 'INVALID_OPERATION', message }],
})

/** The schema file for the template, made the way `culm schema` makes it. The new folder has no node_modules yet, so a copy gets a stub that re-exports the running starter. */
async function schemaFor(template: string) {
  const tmp = await mkdtemp(join(tmpdir(), 'culm-init-'))
  try {
    await cp(template, tmp, { recursive: true })
    const pkg = join(tmp, 'node_modules/@culmjs/starter')
    await mkdir(pkg, { recursive: true })
    await writeFile(
      join(pkg, 'package.json'),
      '{"name":"@culmjs/starter","type":"module","exports":"./index.js"}',
    )
    await writeFile(
      join(pkg, 'index.js'),
      `export { default } from ${JSON.stringify(import.meta.resolve('@culmjs/starter'))}\n`,
    )
    const p = await openProject(tmp)
    if (p.loaded.problems.length)
      throw new Error(
        `The template does not load: ${p.loaded.problems[0]!.message}`,
      )
    return `${JSON.stringify(authoringSchema(p.registry), null, 2)}\n`
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** Writes a new site into `dir`: the starter's template, a package.json, a .gitignore and culm.schema.json. Installs nothing. */
export async function init(
  dir: string,
  options: { from?: string } = {},
): Promise<{ ok: true; files: string[] } | { ok: false; problems: Problem[] }> {
  const target = resolve(dir)
  let found: string[] = []
  try {
    found = await readdir(target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      return refuse(`${target} cannot be used as a folder for a new site.`)
  }
  if (found.length) {
    const shown = found.sort().slice(0, 5).join(', ')
    return refuse(
      `${target} is not empty (it holds ${shown}${found.length > 5 ? ', ...' : ''}). Run culm init in a new or empty folder.`,
    )
  }

  const version: string = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ).version
  const dependencies: Record<string, string> = {}
  if (options.from === undefined)
    for (const n of PACKAGES) dependencies[`@culmjs/${n}`] = version
  else {
    const from = resolve(options.from)
    const names = await readdir(from).catch(() => [] as string[])
    for (const n of PACKAGES) {
      const tar = names
        .sort()
        .find(f => f.startsWith(`culmjs-${n}-`) && f.endsWith('.tgz'))
      if (!tar)
        return refuse(
          `${from} holds no tarball for @culmjs/${n} (culmjs-${n}-*.tgz).`,
        )
      dependencies[`@culmjs/${n}`] = `file:${join(from, tar)}`
    }
  }

  const starter = dirname(
    fileURLToPath(import.meta.resolve('@culmjs/starter/package.json')),
  )
  const template = join(starter, 'template')
  const schema = await schemaFor(template)

  await mkdir(target, { recursive: true })
  await cp(template, target, { recursive: true })
  const name =
    basename(target)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._-]+/, '') || 'my-site'
  await writeFile(
    join(target, 'package.json'),
    `${JSON.stringify({ name, private: true, type: 'module', dependencies }, null, 2)}\n`,
  )
  await writeFile(join(target, '.gitignore'), 'node_modules\ndist\n.culm/\n')
  await writeFile(join(target, 'culm.schema.json'), schema)
  const files = (
    await readdir(target, { recursive: true, withFileTypes: true })
  )
    .filter(e => e.isFile())
    .map(e => join(e.parentPath, e.name).slice(target.length + 1))
    .sort()
  return { ok: true, files }
}
