import { after } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import {
  createRegistry,
  memoryStore,
  type BlockDef,
  type Data,
  type Links,
  type Plugin,
  type Registry,
  type Row,
  type SiteDocument,
} from '@culmjs/core'
import starter from '@culmjs/starter'
import { init } from '../../src/cli/init.ts'
import { openProject } from '../../src/folder/project.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { protect } from '../../src/mcp/protect.ts'
import { connectClient, files, serve } from '../mcp/serve.ts'

const made: string[] = []
after(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

/** A site made by `culm init`, finding the starter the way an installed site does. */
export async function starterFolder(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'culm-cuj-'))
  made.push(parent)
  const dir = join(parent, 'site')
  const r = await init(dir)
  if (!r.ok) throw new Error(JSON.stringify(r.problems))
  const pkg = join(dir, 'node_modules/@culmjs/starter')
  await mkdir(pkg, { recursive: true })
  await writeFile(
    join(pkg, 'package.json'),
    '{"name":"@culmjs/starter","type":"module","exports":"./index.js"}',
  )
  await writeFile(
    join(pkg, 'index.js'),
    `export { default } from ${JSON.stringify(import.meta.resolve('@culmjs/starter'))}\n`,
  )
  return dir
}

/** Sets a JSON value in a file of the folder, keeping its comments. */
export async function edit(
  dir: string,
  file: string,
  path: (string | number)[],
  value: unknown,
) {
  const p = join(dir, file)
  const text = await readFile(p, 'utf8')
  await writeFile(
    p,
    applyEdits(
      text,
      modify(text, path, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
  )
}

/** The rows of the template's menu. */
export async function menuRows(dir: string): Promise<Row[]> {
  return parse(await readFile(join(dir, 'data/menu.json'), 'utf8')).rows
}

/** A registry built in code: the starter, the sources `menu` and `links` with sample rows, and (when given) the template's own block. */
export function codeRegistry(rows: Row[], local: BlockDef[] = []): Registry {
  const data: Plugin = {
    name: 'rows',
    version: 1,
    api: [1],
    runs: ['build'],
    trust: 'declarative',
    sources: [
      {
        name: 'menu',
        fields: { name: 'text', text: 'text', price: 'text', image: 'text' },
        sample: rows,
      },
      { name: 'links', fields: { name: 'text', link: 'text' }, sample: [] },
    ],
  }
  const reg = createRegistry()
  reg.use(starter)
  reg.use(data)
  if (local.length)
    reg.use({
      name: 'local',
      version: 1,
      api: [1],
      runs: ['build'],
      trust: 'declarative',
      blocks: local,
    })
  return reg
}

export async function localBlocks(dir: string): Promise<BlockDef[]> {
  const b = parse(
    await readFile(join(dir, 'blocks/opening-hours.json'), 'utf8'),
  )
  delete b.$schema
  return [b]
}

export type Target = {
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ error: boolean; json: any }> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** The registry, rows and links a compile of this target's site uses. */
  registry: Registry
  data: Data
  links: Links
  /** A second, independent client of the same site. */
  another(): Promise<Target['call']>
  /** The head document. */
  doc(): Promise<SiteDocument>
  /** The folder, when the target is one. */
  dir?: string
  files?: () => Promise<Record<string, string>>
}

/** The same MCP client over a folder made by `init`, after `prepare` changed its files. */
export async function folderTarget(
  prepare: (dir: string) => Promise<void> = async () => {},
  executable?: string,
): Promise<Target> {
  const dir = await starterFolder()
  await prepare(dir)
  const { call, project } = await serve(dir, executable)
  return {
    call,
    another: async () => (await serve(dir, executable)).call,
    dir,
    registry: project.registry,
    data: project.loaded.data,
    links: project.links,
    files: () => files(dir),
    doc: async () => {
      const p = await openProject(dir)
      if (p.loaded.problems.length)
        throw new Error(JSON.stringify(p.loaded.problems))
      return p.loaded.doc!
    },
  }
}

/** The same client over a `memoryStore` holding the document `make` builds from the template, with a registry built in code. */
export async function memoryTarget(
  make: (template: SiteDocument) => SiteDocument,
  executable?: string,
): Promise<Target> {
  const dir = await starterFolder()
  const project = await openProject(dir)
  const rows = await menuRows(dir)
  const registry = codeRegistry(rows, await localBlocks(dir))
  const store = memoryStore({ site: make(project.loaded.doc!) })
  const options = {
    store,
    registry,
    site: 'site',
    data: project.loaded.data,
    allow: protect,
    executable,
  }
  const call = await connectClient(createMcpServer(options))
  return {
    call,
    another: () => connectClient(createMcpServer(options)),
    registry,
    data: project.loaded.data,
    links: project.links,
    doc: async () => {
      const h = await store.head('site')
      if ('problems' in h) throw new Error(JSON.stringify(h.problems))
      return h.doc
    },
  }
}
