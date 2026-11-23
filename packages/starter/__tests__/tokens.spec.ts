import test from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
import { checkLook, checkSiteStyles } from '@culmjs/core'
import { LOOK, STYLES } from '../src/tokens.ts'
import { button, heading, imageSlot, paragraph } from '../src/parts.ts'

test('STYLES passes checkSiteStyles and LOOK passes checkLook', () => {
  assert.deepEqual(checkSiteStyles(STYLES).problems, [])
  assert.deepEqual(checkLook(LOOK), [])
})

test('the named values are the plan values', () => {
  assert.equal(LOOK.id, 'starter')
  assert.equal(LOOK.family, 'Minimal')
  assert.equal(LOOK.brand, '#b45309')
  assert.equal(LOOK.ink, '#1c1917')
  assert.equal(LOOK.bg, '#fafaf9')
  assert.equal(LOOK.headingFont, 'sys:sans')
  assert.equal(LOOK.bodyFont, 'sys:sans')
  assert.equal(LOOK.dark, 'auto')
  assert.deepEqual(
    Object.fromEntries(STYLES.colors.map(c => [c.id, c.value])),
    {
      ink: '#1c1917',
      canvas: '#fafaf9',
      brand: '#b45309',
      muted: '#57534e',
      line: '#e7e5e4',
    },
  )
  assert.deepEqual(
    Object.fromEntries(STYLES.text.map(t => [t.id, t.decl.size])),
    { eyebrow: 11, body: 17, lead: 20, h3: 24, h2: 32, h1: 48 },
  )
  assert.deepEqual(STYLES.space, {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 40,
    '2xl': 64,
  })
  assert.deepEqual(
    STYLES.shadows.map(s => s.id),
    ['card'],
  )
  assert.deepEqual(STYLES.textRange, { min: 11, max: 96, displayMax: 240 })
})

test('every heading builder result is required and every text size is inside the range', () => {
  for (const level of ['h1', 'h2', 'h3'] as const) {
    const n = heading('t', level, 'Words')
    assert.equal(n.required, true)
    assert.equal(n.props?.level, level)
    assert.equal(n.props?.textStyle, level)
  }
  assert.equal(paragraph('p', 'x').props?.textStyle, 'body')
  assert.equal(paragraph('p', 'x', 'lead').props?.textStyle, 'lead')
  assert.equal(button('b', 'Go').props?.label, 'Go')
  assert.equal(imageSlot('i', 'A cat').props?.alt, 'A cat')
  const { min, max } = STYLES.textRange!
  for (const t of STYLES.text)
    assert.ok(t.decl.size! >= min && t.decl.size! <= max, t.id)
})

test('a starter source file that imports node:fs, @culmjs/tools, or @culmjs/core/document fails lint', async () => {
  const eslint = new ESLint()
  const rule = async (code: string, file = 'packages/starter/src/x.ts') => {
    const [r] = await eslint.lintText(code, {
      filePath: new URL(`../../../${file}`, import.meta.url).pathname,
    })
    return r!.messages.filter(m =>
      ['no-restricted-imports', 'no-restricted-syntax'].includes(m.ruleId!),
    ).length
  }
  for (const spec of ['node:fs', '@culmjs/tools', '@culmjs/core/document'])
    assert.equal(await rule(`import x from '${spec}'\nexport { x }\n`), 1, spec)
  assert.equal(await rule(`export { LOOK } from '@culmjs/core'\n`), 0)
  assert.equal(await rule(`export { a } from './tokens.ts'\n`), 0)
  assert.equal(
    await rule(`export { a } from '../../core/src/x.ts'\n`),
    1,
    'relative path out of the package',
  )
  for (const spec of ['node:fs', '@culmjs/tools', '@culmjs/core/document'])
    assert.equal(
      await rule(`export const f = () => import('${spec}')\n`),
      1,
      spec,
    )
  assert.equal(
    await rule(`export const f = () => import('../../core/src/index.ts')\n`),
    1,
  )
  assert.equal(await rule(`export const f = () => import('@culmjs/core')\n`), 0)
  assert.equal(await rule(`export const f = () => import('./tokens.ts')\n`), 0)
})
