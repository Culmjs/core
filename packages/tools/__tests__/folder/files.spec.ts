import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { media, readAsset, resolveFile } from '../../src/folder/files.ts'

test('media and resolveFile agree: a link out is refused and unreadable, a link to a file inside is that file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'culm-files-'))
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  try {
    const dir = join(root, 'p')
    await mkdir(join(dir, 'assets'), { recursive: true })
    await writeFile(join(dir, 'assets/a.txt'), 'a')
    await writeFile(join(outside, 'o.txt'), 'o')
    await symlink(join(outside, 'o.txt'), join(dir, 'assets/out.txt'))
    await symlink(join(dir, 'assets/a.txt'), join(dir, 'assets/in.txt'))
    const m = await media(dir)
    assert.deepEqual(
      m.hashes.map(h => h.path),
      ['assets/a.txt', 'assets/in.txt'],
    )
    assert.deepEqual([...m.refused.keys()], ['assets/out.txt'])
    assert.ok(await resolveFile(dir, 'assets', 'in.txt'))
    assert.equal(await resolveFile(dir, 'assets', 'out.txt'), undefined)
    assert.equal(await resolveFile(dir, 'assets', '../../o.txt'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('a link in assets/ or fonts/ to a project file outside that folder is refused by the walker and unreadable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'culm-files-'))
  try {
    await mkdir(join(dir, 'assets/sub'), { recursive: true })
    await mkdir(join(dir, 'fonts'))
    await mkdir(join(dir, '.culm'))
    await writeFile(join(dir, 'site.json'), '{}')
    await writeFile(join(dir, '.culm/head'), '1')
    await writeFile(join(dir, 'culm.json'), '{}')
    await writeFile(join(dir, 'assets/sub/a.txt'), 'a')
    await symlink(join(dir, 'site.json'), join(dir, 'assets/x.json'))
    await symlink(join(dir, '.culm/head'), join(dir, 'assets/h.txt'))
    await symlink(join(dir, 'culm.json'), join(dir, 'fonts/c.woff2'))
    await symlink(join(dir, 'assets/sub'), join(dir, 'assets/dl'))
    await symlink(join(dir, 'assets/sub/a.txt'), join(dir, 'assets/ok.txt'))
    const m = await media(dir)
    assert.deepEqual([...m.refused.keys()].sort(), [
      'assets/h.txt',
      'assets/x.json',
      'fonts/c.woff2',
    ])
    assert.deepEqual(
      m.hashes.map(h => h.path),
      ['assets/ok.txt', 'assets/sub/a.txt'],
    )
    assert.equal(await readAsset(dir, 'assets/x.json'), undefined)
    assert.equal(await readAsset(dir, 'assets/h.txt'), undefined)
    assert.equal(await readAsset(dir, 'fonts/c.woff2'), undefined)
    assert.equal(
      await readAsset(dir, 'assets/dl/a.txt'),
      undefined,
      'a folder link is skipped everywhere',
    )
    assert.ok(await readAsset(dir, 'assets/ok.txt'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable folder under assets/ is a refusal, not a throw', async t => {
  if (process.getuid?.() === 0) return t.skip('root reads everything')
  const dir = await mkdtemp(join(tmpdir(), 'culm-files-'))
  try {
    await mkdir(join(dir, 'assets/locked'), { recursive: true })
    await chmod(join(dir, 'assets/locked'), 0)
    const m = await media(dir)
    assert.deepEqual([...m.refused.keys()], ['assets/locked'])
  } finally {
    await chmod(join(dir, 'assets/locked'), 0o755)
    await rm(dir, { recursive: true, force: true })
  }
})
