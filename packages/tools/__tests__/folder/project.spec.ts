import test from 'node:test'
import assert from 'node:assert/strict'
import {
  access,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyFixture } from '../fixtures.ts'
import { loadFolder } from '../../src/folder/load.ts'
import { openProject } from '../../src/folder/project.ts'

test('openProject returns registry, document, map, data and links, and creates no .culm/', async () => {
  const dir = await copyFixture('site-basic')
  const before = (await readdir(dir)).sort()
  const p = await openProject(dir)
  assert.equal(p.dir, dir)
  assert.deepEqual(p.loaded.problems, [])
  assert.ok(p.loaded.doc)
  assert.ok(p.loaded.map)
  assert.ok(p.loaded.data)
  assert.equal(p.config.out, 'dist')
  assert.equal(typeof p.registry.plugins, 'function')
  assert.equal(p.links.page('/about'), '/about')
  assert.deepEqual((await readdir(dir)).sort(), before)
  await assert.rejects(access(join(dir, '.culm')))
})

test('links.file("loaf.svg") is "/assets/loaf.svg"', async () => {
  const p = await openProject(await copyFixture('site-basic'))
  assert.equal(p.links.file('loaf.svg'), '/assets/loaf.svg')
})

test('a piece linked outside the project is a located refusal through openProject', async () => {
  const dir = await copyFixture('site-basic')
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  try {
    await writeFile(
      join(outside, 's.json'),
      '{ "root": { "id": "s", "kind": "box" } }',
    )
    await symlink(join(outside, 's.json'), join(dir, 'pieces/x.json'))
    const p = await openProject(dir)
    assert.equal(p.loaded.doc, undefined)
    const hit = p.loaded.problems.find(q => q.file === 'pieces/x.json')
    assert.ok(hit, JSON.stringify(p.loaded.problems))
    assert.equal(hit.line, 1)
    assert.match(hit.message, /leaves the project/)
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('a missing folder is a problem that names the folder, through openProject and loadFolder', async () => {
  const dir = join(tmpdir(), 'culm-no-such-folder-xyz')
  const p = await openProject(dir)
  assert.equal(p.loaded.doc, undefined)
  assert.ok(
    p.loaded.problems.some(q => q.message.includes(dir)),
    JSON.stringify(p.loaded.problems),
  )
  await assert.doesNotReject(loadFolder(dir, p.registry))
  const l = await loadFolder(dir, p.registry)
  assert.equal(l.doc, undefined)
  assert.ok(
    l.problems.some(q => q.message.includes(dir)),
    JSON.stringify(l.problems),
  )
})
