import {
  access,
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

export function compareTarballs(a: string, b: string, prefix: string): number {
  const ver = (f: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\.tgz$/.exec(
      f.slice(prefix.length),
    )
    return m
      ? {
          nums: [+m[1]!, +m[2]!, +m[3]!],
          pre: m[4] ?? '',
        }
      : undefined
  }
  const va = ver(a)
  const vb = ver(b)
  if (!va || !vb) return a < b ? -1 : a > b ? 1 : 0
  for (let i = 0; i < 3; i++)
    if (va.nums[i]! !== vb.nums[i]!) return vb.nums[i]! - va.nums[i]!
  if (va.pre !== vb.pre) {
    if (!va.pre) return -1
    if (!vb.pre) return 1
    return va.pre < vb.pre ? 1 : -1
  }
  return a < b ? -1 : a > b ? 1 : 0
}

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

/** Writes a new site into `dir`: the starter's template (or a minimal single-page site with `blank`), a package.json, a .gitignore and culm.schema.json. Installs nothing. */
export async function init(
  dir: string,
  options: { from?: string; blank?: boolean } = {},
): Promise<{ ok: true; files: string[] } | { ok: false; problems: Problem[] }> {
  const target = resolve(dir)
  let found: string[] = []
  let existed = true
  try {
    found = await readdir(target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') existed = false
    else return refuse(`${target} cannot be used as a folder for a new site.`)
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
      const prefix = `culmjs-${n}-`
      const tar = names
        .filter(f => f.startsWith(prefix) && f.endsWith('.tgz'))
        .sort((a, b) => compareTarballs(a, b, prefix))[0]
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
  let sourceDir = template
  let tempTemplate: string | undefined
  try {
    if (options.blank) {
      tempTemplate = await mkdtemp(join(tmpdir(), 'culm-blank-'))
      sourceDir = tempTemplate
      await writeFile(
        join(sourceDir, 'culm.json'),
        await readFile(join(template, 'culm.json'), 'utf8'),
      )
      const baseSite = JSON.parse(
        (await readFile(join(template, 'site.json'), 'utf8')).replace(
          /^\s*\/\/.*\n/gm,
          '',
        ),
      ) as Record<string, unknown>
      baseSite.name = 'My site'
      baseSite.pages = ['home.json']
      baseSite.header = {
        id: 'header',
        kind: 'column',
        name: 'Header',
        style: {
          base: {
            padding: [16, 16, 16, 16],
            align: 'center',
            border: { width: 1, color: 'line', sides: ['bottom'] },
          },
        },
        children: [
          {
            id: 'hrow',
            kind: 'row',
            name: 'Bar',
            style: {
              base: {
                width: 'fill',
                maxWidth: { n: 1100, unit: 'px' },
                align: 'center',
                justify: 'between',
                wrap: true,
                gap: 16,
              },
            },
            children: [
              {
                id: 'brand',
                kind: 'text',
                name: 'Site name',
                props: { level: 'p', runs: [{ text: 'My site' }] },
                style: { base: { size: 18, weight: 700, color: 'ink' } },
              },
              {
                id: 'hnav',
                kind: 'menu',
                name: 'Menu',
                props: { which: 'menu', foldOn: 'phone' },
                style: { base: { gap: 16 } },
              },
            ],
          },
        ],
      }
      baseSite.footer = {
        id: 'footer',
        kind: 'column',
        name: 'Footer',
        style: {
          base: {
            padding: [24, 16, 24, 16],
            align: 'center',
            border: { width: 1, color: 'line', sides: ['top'] },
          },
        },
        children: [
          {
            id: 'frow',
            kind: 'row',
            name: 'Bar',
            style: {
              base: {
                width: 'fill',
                maxWidth: { n: 1100, unit: 'px' },
                align: 'center',
                justify: 'between',
                wrap: true,
                gap: 16,
              },
            },
            children: [
              {
                id: 'fnote',
                kind: 'text',
                name: 'Note',
                props: { level: 'p', runs: [{ text: 'My site.' }] },
                style: { base: { size: 14, color: 'muted' } },
              },
              {
                id: 'fnav',
                kind: 'menu',
                name: 'Menu',
                props: { which: 'footer' },
                style: { base: { gap: 16 } },
              },
            ],
          },
        ],
      }
      await writeFile(
        join(sourceDir, 'site.json'),
        `${JSON.stringify(baseSite, null, 2)}\n`,
      )
      await mkdir(join(sourceDir, 'pages'), { recursive: true })
      await writeFile(
        join(sourceDir, 'pages/home.json'),
        `${JSON.stringify(
          {
            $schema: '../culm.schema.json',
            id: 'home',
            title: 'Home',
            slug: '/',
            on: true,
            inMenu: true,
            inFooter: false,
            icon: '',
            root: {
              id: 'homeroot',
              kind: 'column',
              name: 'Page',
              style: {
                base: { padding: [40, 16, 40, 16], align: 'center', gap: 16 },
                phone: { padding: [24, 16, 24, 16] },
              },
              children: [
                {
                  kind: 'column',
                  id: 'intro',
                  style: {
                    base: {
                      width: 'fill',
                      maxWidth: { n: 1100, unit: 'px' },
                      gap: 16,
                    },
                  },
                  children: [
                    {
                      kind: 'text',
                      id: 'heading',
                      props: {
                        level: 'h1',
                        textStyle: 'h1',
                        runs: [{ text: 'My site' }],
                      },
                    },
                    {
                      kind: 'text',
                      id: 'lead',
                      props: {
                        level: 'p',
                        textStyle: 'lead',
                        runs: [
                          {
                            text: 'Start editing pages/home.json or connect an agent via culm mcp.',
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      )
    }

    const schema = await schemaFor(sourceDir)
    await mkdir(target, { recursive: true })
    await cp(sourceDir, target, { recursive: true })
    const name =
      basename(target)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+/, '') || 'my-site'
    await writeFile(
      join(target, 'package.json'),
      `${JSON.stringify(
        {
          name,
          private: true,
          type: 'module',
          scripts: {
            dev: 'culm dev',
            build: 'culm build',
            check: 'culm check',
            mcp: 'culm mcp',
          },
          dependencies,
        },
        null,
        2,
      )}\n`,
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
  } catch (e) {
    const dirStillThere = await access(target).then(
      () => true,
      () => false,
    )
    if (dirStillThere) {
      if (!existed)
        await rm(target, { recursive: true, force: true }).catch(() => {})
      else {
        for (const entry of await readdir(target).catch(() => [] as string[]))
          await rm(join(target, entry), { recursive: true, force: true }).catch(
            () => {},
          )
      }
    }
    throw e
  } finally {
    if (tempTemplate)
      await rm(tempTemplate, { recursive: true, force: true }).catch(() => {})
  }
}
