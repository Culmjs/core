import test from 'node:test'
import assert from 'node:assert/strict'
import type { Look } from '../../src/document/index.ts'
import { contrast, siteColors } from '../../src/style/colors.ts'

const lookFixture: Look = {
  id: 'x',
  name: 'X',
  family: 'Minimal',
  brand: '#000000',
  ink: '#000000',
  bg: '#ffffff',
  headingFont: 'sys:sans',
  bodyFont: 'sys:sans',
  corners: 4,
  dark: 'auto',
}

test('contrast is the WCAG ratio', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 100) / 100, 21)
  assert.equal(contrast('#777777', '#777777'), 1)
})
test('a light look gets a generated dark scheme; a dark look keeps its colours', () => {
  const light = { brand: '#7c5ce6', ink: '#1f2a44', bg: '#ffffff' }
  assert.deepEqual(siteColors({ ...lookFixture, ...light }).dark, {
    brand: '#b7a5f1',
    ink: '#ecebf0',
    bg: '#16151b',
  })
  const dark = { brand: '#e0c060', ink: '#f0f0f0', bg: '#101014' }
  assert.deepEqual(siteColors({ ...lookFixture, ...dark }).dark, dark)
})
