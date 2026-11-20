import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptySite } from '../../src/document/index.ts'
import { LOOK } from '../kit.ts'

test('emptySite has the current schema version and one empty page', () => {
  const d = emptySite('My site', LOOK)
  assert.equal(d.schemaVersion, 2)
  assert.equal(d.name, 'My site')
  assert.equal(d.pages.length, 1)
  assert.equal(d.pages[0].slug, '/')
  assert.deepEqual(d.pages[0].root.children ?? [], [])
  assert.deepEqual(d.components, [])
  assert.equal(d.look, LOOK)
})

test('emptySite lists a font once when heading and body share it', () => {
  const d = emptySite('x', { ...LOOK, bodyFont: LOOK.headingFont })
  assert.deepEqual(d.fonts, [LOOK.headingFont])
})
