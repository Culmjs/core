import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applySetting,
  compilePage,
  createRegistry,
  emptySite,
  insertBlock,
  validateSite,
  type Node,
} from '@culmjs/core'
// Core's own test plug-in, by path: only the starter's src is held to `@culmjs/core`.
import { KIT_PLUGIN } from '../../core/__tests__/kit.ts'
import starter, { LOOK, STYLES } from '../src/index.ts'

const reg = createRegistry()
reg.use(starter)
reg.use(KIT_PLUGIN)

const ins = (block: string, look: string, id: string): Node => {
  const r = insertBlock(reg, block, look, id)
  assert.ok(r.ok, block)
  return r.root
}

function site(badges: number) {
  const doc = emptySite('Gate', LOOK)
  doc.styles = STYLES
  const stamp = ins('stamp', 'default', 'stamp1')
  // onInsert ran: the look's own title is `Stamp`
  assert.equal(
    (stamp.children![0].props!.runs as { text: string }[])[0].text,
    'Stamped',
  )
  const shout = applySetting(reg, stamp, 'shout', 'hello')
  assert.ok(shout.ok)
  const extra = Array.from({ length: badges }, (_, i) => ({
    id: `b${i}`,
    kind: 'badge',
    name: 'Badge',
    slot: {},
    props: { label: 'x', tip: 'x' },
  }))
  doc.pages[0].root = {
    ...doc.pages[0].root,
    children: [ins('hero', 'plain', 'hero1'), shout.root, ...extra],
  }
  return doc
}

test('the starter and the core test plug-in share one registry and one page', () => {
  const ok = site(1)
  assert.deepEqual(validateSite(ok, reg), [])
  const r = compilePage(ok, ok.pages[0].id, { registry: reg })
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  assert.deepEqual(r.problems, [])
  assert.match(r.html, /hello!/)
  assert.doesNotMatch(r.html, /Stamped/)
  assert.match(r.html, /<span/)
  const bad = validateSite(site(4), reg)
  assert.equal(bad.length, 1)
  assert.match(JSON.stringify(bad[0]), /max-badges/)
})

test('registry.plugins() lists kit and starter, and nothing else', () => {
  assert.deepEqual(
    reg
      .plugins()
      .map(p => p.name)
      .sort(),
    ['kit', 'starter'],
  )
})
