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
  // The title is made by the hero short form, so the source map names the form: the `{` that opens it, one line above its `"block"` key.
  // `findIndex` is 0-based, so it is the 1-based number of that line above.
  const form = text.split('\n').findIndex(l => l.includes('"block": "hero"'))
  const r = await check(dir)
  assert.equal(r.code, 1, r.err)
  const line = r.err
    .split('\n')
    .find(l => /overflow/.test(l) && l.startsWith('pages/home.json:'))
  assert.ok(line, r.err)
  assert.ok(
    line.startsWith(`pages/home.json:${form}:`),
    `${line} (form on ${form})`,
  )
})

// The fixture is a bare test site (no accent, one column, its own chrome): the 3b design findings now stand on it, so the repair is read as the overflow row going away.
test('check on the fixture with the title repaired no longer reports the overflow', async () => {
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
  assert.doesNotMatch(r.err, /overflow/)
  // what is left is design findings only
  assert.match(r.err, /no-accent|all-stacked|bleed-gutter/)
})
