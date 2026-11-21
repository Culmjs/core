import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../fixtures.ts'
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
