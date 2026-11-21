import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { media, resolveFile } from '../../src/folder/files.ts'

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
