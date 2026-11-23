import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FONTS } from '../../src/style/index.ts'
import {
  checkSiteFont,
  fontFaceCss,
  fontFamily,
  fontKind,
  fontSlug,
  type SiteFonts,
} from '../../src/style/fonts.ts'
import { lookCss } from '../../src/style/look.ts'
import type { Look } from '../../src/document/index.ts'

test('30 families, each with a woff2 file', () => {
  assert.equal(Object.keys(FONTS).length, 30)
  for (const [id, f] of Object.entries(FONTS))
    for (const file of f.files)
      assert.match(file.file, /^[a-z0-9-]+\.woff2$/, id)
})

test('faces only for catalogue fonts, families with fallbacks', () => {
  const css = fontFaceCss(['cat:inter', 'sys:serif'], '/_fonts')
  assert.equal(css.match(/@font-face/g)!.length, FONTS.inter.files.length)
  assert.match(css, /src:url\(\/_fonts\/inter\.woff2\) format\("woff2"\)/)
  assert.match(css, /font-display:swap/)
  assert.equal(
    fontFamily('sys:mono'),
    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  )
  assert.match(fontFamily('cat:source-serif-4')!, /^"Source Serif 4", Georgia/)
  assert.equal(fontKind('cat:lora'), 'serif')
  assert.equal(fontKind('cat:jetbrains-mono'), 'sans')
})

test('inherited keys are not fonts', () => {
  const css = fontFaceCss(
    ['cat:constructor', 'cat:__proto__', 'cat:inter'],
    '/_fonts',
  )
  assert.equal(css.match(/@font-face/g)!.length, FONTS.inter.files.length)
  assert.equal(fontFamily('cat:toString'), undefined)
  assert.equal(fontKind('cat:constructor'), 'sans')
})

const slab = {
  family: 'Roboto Slab',
  kind: 'serif',
  licence: 'OFL-1.1',
  source: 'https://fonts.googleapis.com/css2?family=Roboto+Slab',
  files: [{ weight: [400, 700], style: 'normal', file: '400-700.woff2' }],
}
const held = { 'roboto-slab': slab } as unknown as SiteFonts

test('fontSlug("Roboto Slab") is roboto-slab and fontSlug("M PLUS 1p") is m-plus-1p', () => {
  assert.equal(fontSlug('Roboto Slab'), 'roboto-slab')
  assert.equal(fontSlug('M PLUS 1p'), 'm-plus-1p')
})

test('checkSiteFont refuses a family with ", ; or }, a file outside the grammar, 19 files and an unknown kind', () => {
  assert.ok(checkSiteFont(slab))
  for (const family of ['A"b', 'A;b', 'A}b', '', 'x'.repeat(65)])
    assert.equal(checkSiteFont({ ...slab, family }), undefined, family)
  for (const file of ['../x.woff2', 'a/400.woff2', '400.woff', '4000.woff2'])
    assert.equal(
      checkSiteFont({ ...slab, files: [{ ...slab.files[0], file }] }),
      undefined,
      file,
    )
  const f = (i: number) => ({
    weight: 100 + i,
    style: 'normal',
    file: `${100 + i}.woff2`,
  })
  assert.ok(
    checkSiteFont({
      ...slab,
      files: Array.from({ length: 18 }, (_, i) => f(i)),
    }),
  )
  assert.equal(
    checkSiteFont({
      ...slab,
      files: Array.from({ length: 19 }, (_, i) => f(i)),
    }),
    undefined,
  )
  assert.equal(checkSiteFont({ ...slab, kind: 'comic' }), undefined)
  assert.equal(checkSiteFont(null), undefined)
})

test('up:roboto-slab with fonts gives "Roboto Slab", Georgia… and @font-face src url(/_fonts/roboto-slab/400-700.woff2)', () => {
  assert.match(fontFamily('up:roboto-slab', held)!, /^"Roboto Slab", Georgia/)
  const css = fontFaceCss(['up:roboto-slab'], '/_fonts', held)
  assert.match(
    css,
    /src:url\(\/_fonts\/roboto-slab\/400-700\.woff2\) format\("woff2"\);font-weight:400 700;font-style:normal/,
  )
})

test('up:roboto-slab with no fonts gives no family and no @font-face, as today', () => {
  assert.equal(fontFamily('up:roboto-slab'), undefined)
  assert.equal(fontFaceCss(['up:roboto-slab'], '/_fonts'), '')
  assert.equal(fontFamily('up:constructor', held), undefined)
})

test('a look with headingFont up:roboto-slab writes --s-head with the family', () => {
  const look = {
    id: 'l',
    name: 'l',
    family: 'f',
    brand: '#1f4e8c',
    ink: '#111111',
    bg: '#ffffff',
    dark: 'auto',
    corners: 4,
    headingFont: 'up:roboto-slab',
    bodyFont: 'sys:sans',
  } as Look
  const family = (r: string) => fontFamily(r as never, held)
  assert.match(
    lookCss(look, undefined, '', family),
    /--s-head:"Roboto Slab", Georgia/,
  )
  assert.doesNotMatch(lookCss(look), /Roboto Slab/)
})
