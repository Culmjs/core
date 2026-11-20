import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FONTS } from '../../src/style/index.ts'
import { fontFaceCss, fontFamily, fontKind } from '../../src/style/fonts.ts'

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
