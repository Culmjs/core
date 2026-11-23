import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../../src/cli/init.ts'
import { main } from '../../src/cli/main.ts'

const version: string = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
).version
const made: string[] = []
after(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true })
})
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'culm-init-'))
  made.push(d)
  return d
}
const list = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).sort()

test('init into a new folder writes the template, package.json, .gitignore and culm.schema.json, and installs nothing', async () => {
  const dir = join(await tmp(), 'my-site')
  const r = await init(dir)
  assert.ok(r.ok, JSON.stringify(r))
  const names = await list(dir)
  for (const f of [
    'culm.json',
    'site.json',
    'pages/home.json',
    'pieces/visit-card.json',
    'blocks/opening-hours.json',
    'data/menu.json',
    'assets/loaf.svg',
    'package.json',
    '.gitignore',
    'culm.schema.json',
  ])
    assert.ok(names.includes(f), `missing ${f}`)
  assert.ok(!existsSync(join(dir, 'node_modules')))
  assert.equal(
    await readFile(join(dir, '.gitignore'), 'utf8'),
    'node_modules\ndist\n.culm/\n',
  )
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'my-site')
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
})

test('the version written is the version of the running tools', async () => {
  const dir = join(await tmp(), 'v')
  await init(dir)
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies, {
    '@culmjs/core': version,
    '@culmjs/starter': version,
    '@culmjs/tools': version,
  })
})

test('init into an existing empty folder works', async () => {
  const dir = await tmp()
  assert.ok((await init(dir)).ok)
  assert.ok(existsSync(join(dir, 'site.json')))
})

for (const [label, name] of [
  ['a file', 'notes.txt'],
  ['only a dot file', '.hidden'],
] as const)
  test(`init into a folder that holds ${label} is refused and lists the names; nothing is written`, async () => {
    const dir = await tmp()
    await writeFile(join(dir, name), 'x')
    const r = await init(dir)
    assert.ok(!r.ok)
    assert.match(JSON.stringify(r), new RegExp(name.replace('.', '\\.')))
    assert.deepEqual(await list(dir), [name])
  })

test('the refusal lists at most five names', async () => {
  const dir = await tmp()
  for (const n of 'abcdefgh') await writeFile(join(dir, `f-${n}`), '')
  const r = await init(dir)
  assert.ok(!r.ok)
  const text = JSON.stringify(r)
  assert.equal((text.match(/f-[a-h]/g) ?? []).length, 5)
})

test('init twice: the second run is refused and no file changes', async () => {
  const dir = join(await tmp(), 'twice')
  assert.ok((await init(dir)).ok)
  const before = await Promise.all(
    (await list(dir)).map(f => readFile(join(dir, f)).catch(() => null)),
  )
  assert.ok(!(await init(dir)).ok)
  const files = await list(dir)
  const after = await Promise.all(
    files.map(f => readFile(join(dir, f)).catch(() => null)),
  )
  assert.deepEqual(after, before)
})

test('init into a path with a space works', async () => {
  const dir = join(await tmp(), 'my bakery site')
  const r = await init(dir)
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(existsSync(join(dir, 'pages/home.json')))
})

test('--from writes file: paths to the three tarballs; a folder that lacks one of them is refused', async () => {
  const from = await tmp()
  for (const n of ['core', 'starter', 'tools'])
    await writeFile(join(from, `culmjs-${n}-0.0.0.tgz`), '')
  const dir = join(await tmp(), 'f')
  const r = await init(dir, { from })
  assert.ok(r.ok, JSON.stringify(r))
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  for (const n of ['core', 'starter', 'tools'])
    assert.equal(
      pkg.dependencies[`@culmjs/${n}`],
      `file:${join(from, `culmjs-${n}-0.0.0.tgz`)}`,
    )
  await rm(join(from, 'culmjs-starter-0.0.0.tgz'))
  const dir2 = join(await tmp(), 'g')
  const r2 = await init(dir2, { from })
  assert.ok(!r2.ok)
  assert.match(JSON.stringify(r2), /starter/)
  assert.ok(!existsSync(dir2))
})

test('culm init <dir> through the command, and a usage error without a folder', async () => {
  const dir = join(await tmp(), 'cmd')
  let out = ''
  let err = ''
  const io = {
    cwd: await tmp(),
    out: (s: string) => void (out += s),
    err: (s: string) => void (err += s),
  }
  assert.equal(await main(['init', dir], io), 0, err)
  assert.ok(existsSync(join(dir, 'culm.json')))
  assert.equal(await main(['init'], io), 2)
  assert.equal(await main(['init', dir], io), 1)
})

test("init's next-step hint quotes a path with a space or a quote, and leaves a plain one alone", async () => {
  const cwd = await tmp()
  const hint = async (name: string) => {
    let out = ''
    const io = { cwd, out: (s: string) => void (out += s), err: () => {} }
    assert.equal(await main(['init', name], io), 0)
    return out
  }
  assert.match(await hint('my site'), /Next: cd 'my site' && npm install/)
  assert.match(await hint("it's"), /Next: cd 'it'\\''s' && npm install/)
  assert.match(await hint('plain-site'), /Next: cd plain-site && npm install/)
})
