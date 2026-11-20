import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KINDS } from '../../src/document/index.ts'
import { createRegistry } from '../../src/registry/index.ts'
import type {
  BlockDef,
  DataSource,
  Plugin,
  Rule,
  SettingFn,
} from '../../src/registry/index.ts'

const plug = (more: Partial<Plugin> = {}): Plugin => ({
  name: 'p',
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  ...more,
})
const src: DataSource = {
  name: 'projects',
  fields: { title: 'text' },
  sample: [],
}
const blk = (id: string): BlockDef => ({
  id,
  version: 1,
  name: id,
  category: 'utility',
  looks: [],
  settings: [],
})
const fn: SettingFn = { read: () => undefined, apply: root => root }

test('two registries share nothing', () => {
  const a = createRegistry()
  const b = createRegistry()
  a.use(plug({ sources: [src] }))
  assert.equal(a.source('projects'), src)
  assert.equal(b.source('projects'), undefined)
  assert.deepEqual(a.sources(), [src])
})

test('the same name twice is an error, across plug-ins and across kinds of extension', () => {
  const r = createRegistry()
  r.use(plug({ sources: [src] }))
  assert.throws(() => r.use(plug({ name: 'q', sources: [src] })), /projects/)
  assert.throws(() => r.use(plug({ name: 'p' })), /p/)
})

test('duplicates within one plug-in are refused, for every kind of extension', () => {
  const rule: Rule = { name: 'r', check: () => [] }
  const dup: Partial<Plugin>[] = [
    { sources: [src, src] },
    { blocks: [blk('b'), blk('b')] },
    { rules: [rule, rule] },
  ]
  for (const d of dup) assert.throws(() => createRegistry().use(plug(d)))
  const r = createRegistry()
  r.use(plug({ blocks: [blk('b')], rules: [rule], settingFns: { f: fn } }))
  assert.throws(() => r.use(plug({ name: 'q', blocks: [blk('b')] })), /b/)
  assert.throws(() => r.use(plug({ name: 'q', rules: [rule] })), /r/)
  assert.throws(() => r.use(plug({ name: 'q', settingFns: { f: fn } })), /f/)
})

test('a refused plug-in registers nothing', () => {
  const r = createRegistry()
  assert.throws(() =>
    r.use(plug({ sources: [src], blocks: [blk('b'), blk('b')] })),
  )
  assert.equal(r.source('projects'), undefined)
  assert.equal(r.blocks().length, 0)
})

test('a plug-in kind may not take a core kind name or repeat a plug-in kind', () => {
  assert.throws(
    () => createRegistry().use(plug({ kinds: { box: KINDS.box } })),
    /box/,
  )
  const r = createRegistry()
  r.use(plug({ kinds: { gadget: KINDS.box } }))
  assert.equal(r.kinds().get('gadget'), KINDS.box)
  assert.throws(
    () => r.use(plug({ name: 'q', kinds: { gadget: KINDS.box } })),
    /gadget/,
  )
})

test('a plug-in built for another API version is refused', () => {
  assert.throws(() => createRegistry().use(plug({ api: [2] })))
})

test('lookups', () => {
  const r = createRegistry()
  r.use(plug({ blocks: [blk('b')], settingFns: { f: fn } }))
  assert.equal(r.block('b')?.id, 'b')
  assert.equal(r.block('nope'), undefined)
  assert.equal(r.block('constructor'), undefined)
  assert.equal(r.settingFn('f'), fn)
  assert.equal(r.settingFn('toString'), undefined)
})

test('rules come back in registration order', () => {
  const r = createRegistry()
  const one: Rule = { name: 'one', check: () => [] }
  const two: Rule = { name: 'two', check: () => [] }
  r.use(plug({ rules: [one, two] }))
  assert.deepEqual(
    r.rules().map(x => x.name),
    ['one', 'two'],
  )
})

test('kinds() returns a copy: changing it, or a later use(), does not change what was read', () => {
  const r = createRegistry()
  const before = r.kinds()
  assert.ok(before instanceof Map)
  ;(before as Map<string, unknown>).set('ghost', {})
  assert.equal(r.kinds().has('ghost'), false)
  const read = r.kinds()
  r.use(
    plug({
      kinds: {
        odd: {
          role: 'container',
          parents: 'any',
          tag: () => 'div',
          display: () => 'block',
          props: {},
          styles: [],
          states: [],
          bindable: [],
          repeatable: true,
          label: 'Odd',
          icon: 'x',
        },
      },
    }),
  )
  assert.equal(read.has('odd'), false)
  assert.equal(r.kinds().has('odd'), true)
})

test('plugins() lists name and version in name order', () => {
  const r = createRegistry()
  r.use(plug({ name: 'zeta', version: 2 }))
  r.use(plug({ name: 'alpha', version: 3 }))
  assert.deepEqual(r.plugins(), [
    { name: 'alpha', version: 3 },
    { name: 'zeta', version: 2 },
  ])
})

test('a guide of 501 characters on a block, and on a source, makes use() throw and registers nothing', () => {
  const long = 'x'.repeat(501)
  for (const bad of [
    { blocks: [blk('ok'), { ...blk('b'), guide: long }] },
    { sources: [{ ...src, guide: long }], blocks: [blk('ok')] },
  ]) {
    const r = createRegistry()
    assert.throws(() => r.use(plug(bad)), /guide/)
    assert.deepEqual(r.plugins(), [])
    assert.equal(r.block('ok'), undefined)
    assert.equal(r.source('projects'), undefined)
    r.use(plug({ blocks: [{ ...blk('b'), guide: 'x'.repeat(500) }] }))
    assert.equal(r.plugins().length, 1)
  }
})

test('a guide that is not a string (a number, a list of 600 items, an object with a length) is refused like a long one', () => {
  for (const guide of [5, new Array(600).fill('x'), { length: 3 }]) {
    const r = createRegistry()
    assert.throws(
      () =>
        r.use(
          plug({ blocks: [{ ...blk('b'), guide } as unknown as BlockDef] }),
        ),
      /guide/,
    )
    assert.deepEqual(r.plugins(), [])
  }
  const r = createRegistry()
  r.use(plug({ blocks: [{ ...blk('b'), guide: '' }] }))
  assert.equal(r.plugins().length, 1)
})
