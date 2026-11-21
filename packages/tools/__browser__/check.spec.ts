import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../__tests__/fixtures.ts'
import { main } from '../src/cli/main.ts'

async function check(dir: string) {
  let out = ''
  let err = ''
  const code = await main(['check'], {
    cwd: dir,
    out: s => void (out += s),
    err: s => void (err += s),
  })
  return { code, out, err }
}

test('check on the fixture exits 1 and prints the overflow finding with the file and line of the title', async () => {
  const dir = await copyFixture('site-basic')
  const text = await readFile(join(dir, 'pages', 'home.json'), 'utf8')
  // the title is made by the hero short form: the source map names the line of that form (no finer place exists for a node made by a short form)
  const title = text.split('\n').findIndex(l => l.includes('"block": "hero"'))
  const r = await check(dir)
  assert.equal(r.code, 1, r.err)
  const line = r.err
    .split('\n')
    .find(l => /overflow/.test(l) && l.startsWith('pages/home.json:'))
  assert.ok(line, r.err)
  assert.ok(
    line.startsWith(`pages/home.json:${title}:`),
    `${line} (title on ${title})`,
  )
})

test('check on the fixture with the title repaired exits 0', async () => {
  const dir = await copyFixture('site-basic')
  const file = join(dir, 'pages', 'home.json')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      '"nowrap": true,',
      '"nowrap": false,',
    ),
  )
  const r = await check(dir)
  assert.equal(r.code, 0, r.err)
})
