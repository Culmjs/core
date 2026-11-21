import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIdentity } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { CLIENT_MARKER } from '../../src/dev/client.ts'
import { openProject } from '../../src/folder/project.ts'
import { buildSite, fileHashes, MANIFEST_FILE } from '../../src/build/bundle.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'
const IMG = `{ "id": "loafpic", "kind": "image", "name": "Loaf", "props": { "assetId": "loaf.svg", "alt": "A loaf" } },`

/** A copy of the fixture with assets/loaf.svg and an image of it on the about page. */
async function site() {
  const dir = await copyFixture('site-basic')
  await mkdir(join(dir, 'assets'))
  await writeFile(join(dir, 'assets/loaf.svg'), SVG)
  const about = join(dir, 'pages/about.json')
  const t = await readFile(about, 'utf8')
  assert.ok(t.includes('"children": ['))
  await writeFile(about, t.replace('"children": [', `"children": [\n${IMG}`))
  return dir
}
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )
const all = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).sort()

test('build writes index.html, menu/index.html, about/index.html, assets/, _fonts/ and culm-manifest.json with a 64-character `build`', async () => {
  const dir = await site()
  await mkdir(join(dir, 'fonts'))
  await writeFile(join(dir, 'fonts/x.woff2'), 'font')
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
  assert.equal(r.out, join(dir, 'dist'))
  const names = await all(r.out)
  for (const n of [
    'index.html',
    'menu/index.html',
    'about/index.html',
    'assets/loaf.svg',
    '_fonts/x.woff2',
    MANIFEST_FILE,
  ])
    assert.ok(names.includes(n), n)
  const m = JSON.parse(await readFile(join(r.out, MANIFEST_FILE), 'utf8'))
  assert.match(m.build, /^[0-9a-f]{64}$/)
  assert.deepEqual(m, r.manifest)
  for (const f of r.files) assert.ok(await exists(join(r.out, f)), f)
})

test('the manifest build equals buildIdentity(doc, data, registry, fileHashes)', async () => {
  const dir = await site()
  const p = await openProject(dir)
  const r = await buildSite(p, join(dir, 'elsewhere'))
  assert.ok(r.ok)
  const hashes = await fileHashes(dir)
  assert.deepEqual(
    hashes.map(h => h.path),
    ['assets/loaf.svg'],
  )
  assert.equal(
    r.manifest.build,
    await buildIdentity(p.loaded.doc!, p.loaded.data, p.registry, hashes),
  )
})

test('a non-empty out folder with no manifest is refused and left untouched', async () => {
  const dir = await site()
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/keep.txt'), 'mine')
  const r = await buildSite(await openProject(dir))
  assert.equal(r.ok, false)
  assert.deepEqual(await all(join(dir, 'dist')), ['keep.txt'])
  assert.equal(await readFile(join(dir, 'dist/keep.txt'), 'utf8'), 'mine')
  // the project folder itself is no output folder
  assert.equal((await buildSite(await openProject(dir), dir)).ok, false)
  assert.ok(await exists(join(dir, 'pages/home.json')))
})

test('an out folder with a manifest is cleared first: a stale page file is gone', async () => {
  const dir = await site()
  const p = await openProject(dir)
  assert.ok((await buildSite(p)).ok)
  await mkdir(join(dir, 'dist/old'))
  await writeFile(join(dir, 'dist/old/index.html'), 'stale')
  await writeFile(join(dir, 'dist/stale.txt'), 'stale')
  assert.ok((await buildSite(p)).ok)
  assert.equal(await exists(join(dir, 'dist/old')), false)
  assert.equal(await exists(join(dir, 'dist/stale.txt')), false)
  assert.ok(await exists(join(dir, 'dist/index.html')))
})

test('a site with no page at "/" writes nothing', async () => {
  const dir = await site()
  const home = join(dir, 'pages/home.json')
  await writeFile(
    home,
    (await readFile(home, 'utf8')).replace('"slug": "/"', '"slug": "/home"'),
  )
  const r = await buildSite(await openProject(dir))
  assert.equal(r.ok, false)
  assert.equal(await exists(join(dir, 'dist')), false)
})

test('any problem writes nothing and comes back with file and line', async () => {
  const dir = await site()
  const about = join(dir, 'pages/about.json')
  await writeFile(
    about,
    (await readFile(about, 'utf8')).replace('"kind": "text"', '"kind": "nope"'),
  )
  const r = await buildSite(await openProject(dir))
  assert.ok(!r.ok)
  assert.ok(r.problems.length > 0)
  assert.ok(
    r.problems.some(
      p => p.file === 'pages/about.json' && typeof p.line === 'number',
    ),
  )
  assert.equal(await exists(join(dir, 'dist')), false)
})

test('a page whose slug collides with what build writes is a problem with file and line', async () => {
  for (const slug of ['/assets', '/_fonts', `/${MANIFEST_FILE}`]) {
    const dir = await site()
    const about = join(dir, 'pages/about.json')
    await writeFile(
      about,
      (await readFile(about, 'utf8')).replace('"/about"', `"${slug}"`),
    )
    const r = await buildSite(await openProject(dir))
    assert.ok(!r.ok, slug)
    const hit = r.problems.find(p => p.file === 'pages/about.json')
    assert.ok(hit?.line, slug)
    assert.equal(await exists(join(dir, 'dist')), false)
  }
})

test('an image address in a built page resolves to a file in the output', async () => {
  const dir = await site()
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
  const html = await readFile(join(r.out, 'about/index.html'), 'utf8')
  const src = /<img[^>]*\ssrc="([^"]+)"/.exec(html)?.[1]
  assert.equal(src, '/assets/loaf.svg')
  assert.ok(await exists(join(r.out, src.slice(1))))
})

test('a catalogue font whose file is missing from fonts/ is a problem', async () => {
  const dir = await site()
  const sj = join(dir, 'site.json')
  await writeFile(
    sj,
    (await readFile(sj, 'utf8')).replace(
      '"headingFont": "sys:serif"',
      '"headingFont": "cat:inter"',
    ),
  )
  const r = await buildSite(await openProject(dir))
  assert.ok(!r.ok)
  const hit = r.problems.find(p => p.message.includes('inter.woff2'))
  assert.equal(hit?.file, 'site.json')
  assert.ok(hit?.line)
  assert.equal(await exists(join(dir, 'dist')), false)
  await mkdir(join(dir, 'fonts'))
  await writeFile(join(dir, 'fonts/inter.woff2'), 'font')
  const ok = await buildSite(await openProject(dir))
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.problems))
  assert.ok(await exists(join(dir, 'dist/_fonts/inter.woff2')))
})

test('no built file contains "data-id=" or the dev client marker', async () => {
  const dir = await site()
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
  for (const f of await all(r.out)) {
    if (!(await stat(join(r.out, f))).isFile()) continue
    const t = await readFile(join(r.out, f), 'utf8')
    assert.ok(!t.includes('data-id='), f)
    assert.ok(!t.includes(CLIENT_MARKER), f)
  }
})

test('an out inside a source folder, a parent folder or a symlink is refused and nothing throws', async () => {
  const dir = await site()
  const p = await openProject(dir)
  await mkdir(join(dir, 'pieces/sub'), { recursive: true })
  await writeFile(join(dir, 'pieces/sub', MANIFEST_FILE), '{}')
  await mkdir(join(dir, 'real'))
  await symlink(join(dir, 'real'), join(dir, 'link'))
  for (const out of [
    join(dir, 'assets/dist'),
    join(dir, 'fonts'),
    join(dir, 'pieces'),
    join(dir, 'pieces/sub'),
    join(dir, 'site.json/sub'),
    join(dir, '..'),
    join(dir, 'link'),
  ]) {
    const r = await buildSite(p, out)
    assert.equal(r.ok, false, out)
  }
  assert.ok(await exists(join(dir, 'pieces/visit-card.json')))
  assert.deepEqual(await all(join(dir, 'assets')), ['loaf.svg'])
  assert.deepEqual(await all(join(dir, 'real')), [])
})

test('culm.json cannot name an out inside assets/ or fonts/', async () => {
  const dir = await site()
  await writeFile(join(dir, 'culm.json'), '{ "out": "assets/dist" }')
  const p = await openProject(dir)
  assert.ok(p.loaded.problems.some(x => x.file === 'culm.json'))
})

test('a text that merely contains "cat:inter" is not a missing font', async () => {
  const dir = await site()
  const about = join(dir, 'pages/about.json')
  await writeFile(
    about,
    (await readFile(about, 'utf8')).replace(
      'A small bakery on a corner.',
      'cat:inter is a font ref',
    ),
  )
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
})

test('an out is checked by its real path: other case, a symlinked parent', async () => {
  const dir = await site()
  await mkdir(join(dir, 'fonts'))
  await symlink(join(dir, 'assets'), join(dir, 'al'))
  const p = await openProject(dir)
  for (const out of [
    join(dir, 'Assets/dist'),
    join(dir, 'FONTS'),
    join(dir, 'al/dist'),
  ]) {
    const r = await buildSite(p, out)
    assert.equal(r.ok, false, out)
  }
  assert.deepEqual(await all(join(dir, 'assets')), ['loaf.svg'])
  assert.deepEqual(await all(join(dir, 'fonts')), [])
})

test('culm.json out in another case is refused', async () => {
  const dir = await site()
  await writeFile(join(dir, 'culm.json'), '{ "out": "Assets/dist" }')
  const p = await openProject(dir)
  assert.ok(p.loaded.problems.some(x => x.file === 'culm.json'))
})

test('a font url outside an @font-face rule is not a missing font', async () => {
  const dir = await site()
  const about = join(dir, 'pages/about.json')
  await writeFile(
    about,
    (await readFile(about, 'utf8')).replace(
      'A small bakery on a corner.',
      'see /_fonts/zzz.woff2) here',
    ),
  )
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
})

test('assets linked outside the project: build refuses with a located problem and writes nothing', async () => {
  const dir = await copyFixture('site-basic')
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  try {
    await writeFile(join(outside, 'a.svg'), SVG)
    await symlink(outside, join(dir, 'assets'))
    const r = await buildSite(await openProject(dir))
    assert.ok(!r.ok)
    assert.ok(
      r.problems.some(
        p => p.file === 'assets' && /leaves the project/.test(p.message),
      ),
      JSON.stringify(r.problems),
    )
    assert.ok(!(await exists(join(dir, 'dist'))))
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('a font or asset linked outside, inside assets/ or fonts/, is refused; a link to a file inside the project is a copied file in the identity', async () => {
  const dir = await site()
  await mkdir(join(dir, 'fonts'))
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  try {
    await writeFile(join(outside, 'f.woff2'), 'font')
    await symlink(join(outside, 'f.woff2'), join(dir, 'fonts/out.woff2'))
    let r = await buildSite(await openProject(dir))
    assert.ok(!r.ok)
    assert.ok(
      r.problems.some(p => p.file === 'fonts/out.woff2'),
      JSON.stringify(r.problems),
    )
    assert.ok(!(await exists(join(dir, 'dist'))))
    await rm(join(dir, 'fonts/out.woff2'))
    await symlink(join(dir, 'assets/loaf.svg'), join(dir, 'assets/same.svg'))
    assert.deepEqual(
      (await fileHashes(dir)).map(h => h.path),
      ['assets/loaf.svg', 'assets/same.svg'],
    )
    r = await buildSite(await openProject(dir))
    assert.ok(r.ok, JSON.stringify(r))
    const copy = join(r.out, 'assets/same.svg')
    assert.ok(!(await lstat(copy)).isSymbolicLink())
    assert.equal(await readFile(copy, 'utf8'), SVG)
    assert.ok(r.files.includes('assets/same.svg'))
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('an asset or font linked to a project source file is refused by build, which writes nothing', async () => {
  const dir = await site()
  await mkdir(join(dir, 'fonts'))
  await symlink(join(dir, 'site.json'), join(dir, 'assets/x.json'))
  await symlink(join(dir, 'culm.json'), join(dir, 'fonts/c.woff2'))
  const r = await buildSite(await openProject(dir))
  assert.ok(!r.ok)
  for (const f of ['assets/x.json', 'fonts/c.woff2'])
    assert.ok(
      r.problems.some(p => p.file === f),
      f,
    )
  assert.ok(!(await exists(join(dir, 'dist'))))
})
