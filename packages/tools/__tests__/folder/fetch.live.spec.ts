import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkSiteFont, ICON_LICENCES } from '@culmjs/core'
import { copyFixture } from '../fixtures.ts'
import { buildSite } from '../../src/build/bundle.ts'
import { fetchFor } from '../../src/folder/fetch.ts'
import { readHeld } from '../../src/folder/held.ts'
import { openProject } from '../../src/folder/project.ts'
import { openBrowser } from '../../src/measure/browser.ts'

// Reaches the real Google Fonts: run by hand with CULM_LIVE=1.
const live = process.env.CULM_LIVE === '1'

test(
  'live: Roboto Slab 400 and 700 fetch, pass checkSiteFont, and a built page loads the font in Chrome',
  { skip: !live },
  async () => {
    const dir = await copyFixture('site-basic')
    const doc = (await openProject(dir)).loaded.doc!
    const r = await fetchFor(dir, doc, [
      { op: 'setFonts', fonts: [{ google: 'Roboto Slab' }] },
    ])
    assert.ok(r.ok, JSON.stringify(r))
    const f = checkSiteFont(
      JSON.parse(
        await readFile(join(dir, 'fonts/roboto-slab/font.json'), 'utf8'),
      ),
    )
    assert.ok(f)
    // Roboto Slab sits under apache/ in the Google Fonts repository
    assert.equal(f.licence, 'Apache-2.0')
    assert.equal(f.kind, 'serif')
    const p = join(dir, 'site.json')
    await writeFile(
      p,
      (await readFile(p, 'utf8')).replace(
        /"headingFont": "[^"]*"/,
        '"headingFont": "up:roboto-slab"',
      ),
    )
    const built = await buildSite(await openProject(dir))
    assert.ok(built.ok, JSON.stringify(built))
    const o = await openBrowser()
    assert.ok(o.ok)
    try {
      const page = await o.browser.newPage()
      await page.answer(async url => {
        const path = new URL(url).pathname
        const rel = path === '/' ? 'index.html' : path.slice(1)
        const body = await readFile(join(built.out, rel)).catch(() => undefined)
        if (!body) return undefined
        return {
          type: rel.endsWith('.html') ? 'text/html' : 'font/woff2',
          body,
        }
      })
      assert.ok((await page.goto('https://site.culm.invalid/', 15000)).ok)
      const loaded = await page.evaluate<boolean>(
        `document.fonts.load('700 16px "Roboto Slab"').then(f => f.length > 0 && document.fonts.check('700 16px "Roboto Slab"'))`,
      )
      assert.equal(loaded, true)
    } finally {
      await o.browser.close()
    }
  },
)

test(
  'live: lucide:camera and fa6-brands:github fetch, and each set is in ICON_LICENCES',
  { skip: !live },
  async () => {
    const dir = await copyFixture('site-basic')
    const doc = (await openProject(dir)).loaded.doc!
    const add = (id: string, kind: string, props: object) => ({
      op: 'add',
      tree: { page: 'home' },
      parent: 'homeroot',
      index: 0,
      node: { id, kind, props },
    })
    const r = await fetchFor(dir, doc, [
      add('i1', 'icon', { name: 'lucide:camera' }),
      add('i2', 'icon', { name: 'fa6-brands:github' }),
    ])
    assert.ok(r.ok, JSON.stringify(r))
    const held = (await readHeld(dir)).icons
    assert.deepEqual(Object.keys(held).sort(), [
      'fa6-brands:github',
      'lucide:camera',
    ])
    for (const set of ['lucide', 'fa6-brands']) {
      const lic = await readFile(
        join(dir, `assets/icons/${set}/LICENSE`),
        'utf8',
      )
      assert.ok(
        ICON_LICENCES.some(l => lic.includes(`Licence: ${l}`)),
        lic,
      )
    }
  },
)
