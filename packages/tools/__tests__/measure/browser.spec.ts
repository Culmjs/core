import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openBrowser } from '../../src/measure/browser.ts'

const made: string[] = []
after(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})
const empty = async () => {
  const d = await mkdtemp(join(tmpdir(), 'culm-find-'))
  made.push(d)
  return d
}
const problem = async (o: Parameters<typeof openBrowser>[0]) => {
  const r = await openBrowser(o)
  assert.equal(r.ok, false)
  const ps = r.ok ? [] : r.problems
  assert.equal(ps.length, 1)
  assert.equal(ps[0]!.code, 'MEASUREMENT_INCOMPLETE')
  return ps[0]!.message
}
const WAYS = [
  /--chrome <path>/,
  /CULM_CHROME/,
  /npx playwright install chromium/,
  /install Google Chrome/,
]

test('an explicit executable that is missing is reported, and no other Chrome is tried', async () => {
  const m = await problem({ executable: '/nonexistent/chrome', env: {} })
  assert.match(m, /"\/nonexistent\/chrome" is not an executable file/)
  for (const w of WAYS) assert.match(m, w)
})

test('a CULM_CHROME that is missing is reported by name', async () => {
  const m = await problem({
    env: { CULM_CHROME: '/nonexistent/chrome2' },
    system: [],
  })
  assert.match(m, /CULM_CHROME "\/nonexistent\/chrome2"/)
})

test('with every source pointed at empty folders nothing is found, and the three ways are named', async () => {
  const dir = await empty()
  const m = await problem({
    env: { PLAYWRIGHT_BROWSERS_PATH: dir, PATH: dir },
    home: dir,
    system: [],
  })
  assert.match(m, /No Chrome or Chromium was found/)
  for (const w of WAYS) assert.match(m, w)
})

test('the newest Chromium that Playwright installed is the one found, without Playwright', async () => {
  const dir = await empty()
  for (const rev of ['9', '10'])
    for (const [name, exe] of [
      ['chromium_headless_shell', 'chrome-headless-shell'],
    ] as const) {
      const sub = join(dir, `${name}-${rev}`, 'chrome-headless-shell-x')
      await mkdir(sub, { recursive: true })
      await writeFile(join(sub, exe), '#!/bin/sh\nexit 0\n')
      await chmod(join(sub, exe), 0o755)
    }
  const m = await problem({
    env: { PLAYWRIGHT_BROWSERS_PATH: dir, PATH: dir },
    home: dir,
    system: [],
  })
  assert.match(
    m,
    /chromium_headless_shell-10\/chrome-headless-shell-x\/chrome-headless-shell" did not start/,
  )
})

test('an executable that is not Chrome is reported, and leaves no profile folder behind', async () => {
  const before = (await readdir(tmpdir())).filter(d =>
    d.startsWith('culm-chrome-'),
  )
  const m = await problem({ executable: process.execPath })
  assert.match(m, /did not start/)
  const now = (await readdir(tmpdir())).filter(d =>
    d.startsWith('culm-chrome-'),
  )
  assert.deepEqual(now, before)
})
