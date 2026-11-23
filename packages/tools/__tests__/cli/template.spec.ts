import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { compilePage } from '@culmjs/core'
import { LOOK, STYLES } from '@culmjs/starter'
import { authoringSchema } from '../../src/schema/authoring.ts'
import { buildSite } from '../../src/build/bundle.ts'
import { openProject } from '../../src/folder/project.ts'
import { main } from '../../src/cli/main.ts'

const TEMPLATE = new URL('../../../starter/template/', import.meta.url).pathname
const made: string[] = []
after(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true })
})

/** A copy of the template that finds the plug-in the way an installed site does. */
async function copy() {
  const dir = await mkdtemp(join(tmpdir(), 'culm-template-'))
  made.push(dir)
  await cp(TEMPLATE, dir, { recursive: true })
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
async function jsonFiles(dir: string, sub = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(join(dir, sub), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const rel = sub ? `${sub}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await jsonFiles(dir, rel)))
    else if (e.name.endsWith('.json')) out.push(rel)
  }
  return out
}

test('the template loads and builds with no problem and no notice', async () => {
  const dir = await copy()
  const p = await openProject(dir)
  assert.deepEqual(p.loaded.problems, [])
  assert.deepEqual(p.loaded.notices, [])
  const r = await buildSite(p)
  assert.ok(r.ok, JSON.stringify(r))
})

test('the template compiles within every ceiling', async () => {
  const p = await openProject(await copy())
  assert.deepEqual(p.loaded.problems, [])
  const doc = p.loaded.doc!
  for (const page of doc.pages) {
    const r = compilePage(doc, page.id, {
      registry: p.registry,
      data: p.loaded.data,
      links: p.links,
    })
    assert.ok(r.ok, `${page.slug}: ${JSON.stringify(!r.ok && r.problems)}`)
    assert.deepEqual(r.problems, [])
  }
})

test('it has a page at "/" and four pages', async () => {
  const p = await openProject(await copy())
  const pages = p.loaded.doc!.pages
  assert.equal(pages.length, 4)
  assert.ok(pages.some(x => x.slug === '/'))
})

test('every JSON file passes authoringSchema, names $schema and carries a comment', async () => {
  const dir = await copy()
  const p = await openProject(dir)
  const check = new Ajv2020({ allErrors: true }).compile(
    JSON.parse(JSON.stringify(authoringSchema(p.registry))),
  )
  for (const f of await jsonFiles(dir)) {
    const text = await readFile(join(dir, f), 'utf8')
    const value = parse(text)
    assert.ok(value.$schema, `${f} names no $schema`)
    assert.match(text, /\/\/|\/\*/, `${f} has no comment`)
    assert.ok(check(value), `${f}: ${JSON.stringify(check.errors)}`)
  }
})

test('site.json look and styles equal tokens.ts', async () => {
  const site = parse(await readFile(join(TEMPLATE, 'site.json'), 'utf8'))
  assert.deepEqual(site.look, LOOK)
  assert.deepEqual(site.styles, STYLES)
})

test('visit-card is used on exactly three pages', async () => {
  const dir = TEMPLATE
  let n = 0
  for (const f of await readdir(join(dir, 'pages')))
    if (
      (await readFile(join(dir, 'pages', f), 'utf8')).includes(
        'visit-card.json',
      )
    )
      n++
  assert.equal(n, 3)
})

test('data/menu.json has the four fields and eight rows, and every image names a file in assets/', async () => {
  const d = parse(await readFile(join(TEMPLATE, 'data/menu.json'), 'utf8'))
  assert.deepEqual(Object.keys(d.fields), ['name', 'text', 'price', 'image'])
  assert.equal(d.rows.length, 8)
  for (const r of d.rows) {
    assert.ok(r.name)
    assert.ok((await stat(join(TEMPLATE, 'assets', r.image))).isFile())
  }
  for (const f of await readdir(join(TEMPLATE, 'assets')))
    assert.ok((await stat(join(TEMPLATE, 'assets', f))).size < 2000)
})

test('header and footer are short forms; opening-hours is a block written as JSON with no function field', async () => {
  const site = parse(await readFile(join(TEMPLATE, 'site.json'), 'utf8'))
  assert.equal(site.header.block, 'page-header')
  assert.equal(site.footer.block, 'page-footer')
  const text = await readFile(
    join(TEMPLATE, 'blocks/opening-hours.json'),
    'utf8',
  )
  assert.doesNotMatch(text, /"fn"|onInsert/)
})

test('expanding every short form and loading again gives the same document', async () => {
  const dir = await copy()
  const before = (await openProject(dir)).loaded.doc
  const shorts: [string, string][] = []
  for (const f of await jsonFiles(dir)) {
    if (f.startsWith('blocks/') || f.startsWith('data/')) continue
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (typeof o.block === 'string' && typeof o.id === 'string')
          shorts.push([f, o.id])
        Object.values(o).forEach(walk)
      }
    }
    walk(parse(await readFile(join(dir, f), 'utf8')))
  }
  assert.ok(shorts.length >= 10)
  for (const [f, id] of shorts) {
    let err = ''
    const code = await main(['expand', f, id], {
      cwd: dir,
      out: () => {},
      err: s => void (err += s),
    })
    assert.equal(code, 0, `${f} ${id}: ${err}`)
  }
  const after = await openProject(dir)
  assert.deepEqual(after.loaded.problems, [])
  assert.deepEqual(after.loaded.doc, before)
})

test('every heading node of the template is required', async () => {
  const p = await openProject(await copy())
  const bad: string[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const n = v as Record<string, unknown> & {
        id: string
        props?: { level?: string }
      }
      if (
        n.kind === 'text' &&
        /^h[1-6]$/.test(n.props?.level ?? '') &&
        !n.required
      )
        bad.push(n.id)
      Object.values(n).forEach(walk)
    }
  }
  walk(p.loaded.doc)
  assert.deepEqual(bad, [])
})
