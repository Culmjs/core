import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultSiteStyles, type SiteDocument } from '@culmjs/core'
import type { Op } from '@culmjs/core/ops'
import { LOOK, siteWith, text } from '../../../core/__tests__/kit.ts'
import { protect } from '../../src/mcp/protect.ts'

const T = { page: 'home' }
const doc = (): SiteDocument => {
  const d = siteWith([
    text('must', 'Keep', { required: true }),
    text('free', 'Go'),
  ])
  d.styles = { ...defaultSiteStyles(LOOK), textRange: { min: 11, max: 96 } }
  return d
}
const req = (id: string, required: boolean | null): Op => ({
  op: 'setRequired',
  tree: T,
  id,
  required,
})
const range = (textRange: unknown): Op =>
  ({ op: 'setSiteStyles', styles: { textRange } }) as Op

test('setRequired false, and null, on a required node: POLICY_VIOLATION, rule protected', () => {
  for (const v of [false, null]) {
    const p = protect(req('must', v), doc())
    assert.equal(p?.code, 'POLICY_VIOLATION')
    assert.equal(p?.rule, 'protected')
    assert.equal(p?.nodeId, 'must')
  }
})

test('setRequired true, and false on a node that is not required: allowed', () => {
  assert.equal(protect(req('must', true), doc()), undefined)
  assert.equal(protect(req('free', true), doc()), undefined)
  assert.equal(protect(req('free', false), doc()), undefined)
  assert.equal(protect(req('free', null), doc()), undefined)
  assert.equal(protect(req('nowhere', false), doc()), undefined)
})

test('setSiteStyles with textRange null, a lower min, or a higher max: refused; a narrower range, or no textRange key: allowed', () => {
  for (const r of [
    null,
    { min: 10, max: 96 },
    { min: 11, max: 97 },
    { min: 11, max: 96, displayMax: 240 },
  ]) {
    const p = protect(range(r), doc())
    assert.equal(p?.code, 'POLICY_VIOLATION', JSON.stringify(r))
    assert.equal(p?.rule, 'textRange')
  }
  assert.equal(protect(range({ min: 12, max: 90 }), doc()), undefined)
  assert.equal(protect(range({ min: 11, max: 96 }), doc()), undefined)
  assert.equal(
    protect(
      { op: 'setSiteStyles', styles: { space: [] } } as unknown as Op,
      doc(),
    ),
    undefined,
  )
})

test('restore and every other operation: allowed', () => {
  assert.equal(protect({ op: 'restore', to: 0 }, doc()), undefined)
  assert.equal(protect({ op: 'remove', tree: T, id: 'must' }, doc()), undefined)
  assert.equal(
    protect({ op: 'setText', tree: T, id: 'free', text: 'x' }, doc()),
    undefined,
  )
})

test('protect never throws, whatever the shape of the operation', () => {
  for (const styles of [null, 'x', [], 7, undefined])
    assert.doesNotThrow(() =>
      protect({ op: 'setSiteStyles', styles } as unknown as Op, doc()),
    )
  for (const op of [
    {},
    { op: 'setRequired' },
    { op: 'setSiteStyles' },
    { op: 'setRequired', tree: 7, id: 3 },
  ])
    assert.doesNotThrow(() => protect(op as unknown as Op, doc()))
  assert.equal(protect(range('wide'), doc())?.rule, 'textRange')
})

test("a field of a form is required by core's rule, and a form marked off is not", () => {
  const d = doc()
  const form = {
    id: 'f',
    kind: 'form',
    name: 'f',
    slot: {},
    props: { formId: 'f' },
    children: [
      {
        id: 'a',
        kind: 'field',
        name: 'a',
        slot: {},
        props: { name: 'e', label: 'E' },
      },
    ],
  }
  d.pages[0]!.root.children!.push(form as never)
  assert.equal(protect(req('a', false), d)?.rule, 'protected')
  ;(form as { required?: boolean }).required = false
  assert.equal(protect(req('a', false), d), undefined)
})
