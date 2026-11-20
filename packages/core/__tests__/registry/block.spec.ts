import assert from 'node:assert/strict'
import { test } from 'node:test'
import { find } from '../../src/document/index.ts'
import type { Node, Run } from '../../src/document/index.ts'
import {
  applySetting,
  createRegistry,
  insertBlock,
  readSettings,
} from '../../src/registry/index.ts'
import type { BlockDef, Setting, SettingFn } from '../../src/registry/index.ts'
import { DEMO, DEMO_PLUGIN, demoTree, sampleRegistry } from '../kit.ts'

const reg = sampleRegistry()
const inserted = (): Node => {
  const r = insertBlock(reg, 'demo', 'default', 'abc')
  assert.ok(r.ok)
  return r.root
}
const applied = (
  root: Node,
  key: string,
  v: Parameters<typeof applySetting>[3],
) => {
  const r = applySetting(reg, root, key, v)
  assert.ok(r.ok)
  return r.root
}

test('insertBlock renames ids under the root id, tags the origin, and leaves the look alone', () => {
  const r = insertBlock(reg, 'demo', 'default', 'abc')
  assert.ok(r.ok)
  assert.equal(r.root.id, 'abc')
  assert.ok(find(r.root, 'abc.title'))
  assert.deepEqual(r.root.origin, {
    block: 'demo',
    version: 1,
    look: 'default',
  })
  assert.equal(DEMO.looks[0].tree.origin, undefined)
  assert.equal(DEMO.looks[0].tree.id, 'root')
})

test('an unknown block or look is refused with UNKNOWN_BLOCK and the allowed values', () => {
  const a = insertBlock(reg, 'nope', 'default', 'abc')
  const b = insertBlock(reg, 'demo', 'nope', 'abc')
  assert.ok(!a.ok && !b.ok)
  assert.equal(a.problems[0].code, 'UNKNOWN_BLOCK')
  assert.deepEqual(a.problems[0].allowed, ['demo'])
  assert.equal(b.problems[0].code, 'UNKNOWN_BLOCK')
  assert.deepEqual(b.problems[0].allowed, ['default'])
})

test('onInsert supplies the tree when the block has one', () => {
  const extra: BlockDef = {
    ...DEMO,
    id: 'extra',
    onInsert: () => {
      const t = demoTree()
      t.children!.push({ id: 'more', kind: 'text', name: 'More', slot: {} })
      return t
    },
  }
  const r = createRegistry()
  r.use({
    ...DEMO_PLUGIN,
    name: 'extra',
    blocks: [extra],
    sources: [],
    settingFns: {},
  })
  const out = insertBlock(r, 'extra', 'default', 'abc')
  assert.ok(out.ok)
  assert.ok(find(out.root, 'abc.more'))
  assert.equal(out.root.origin!.block, 'extra')
})

test('every setting reads back the value just applied', () => {
  let root = inserted()
  for (const [k, v] of [
    ['heading', 'New'],
    ['limit', 3],
    ['hidenote', false],
  ] as const) {
    root = applied(root, k, v)
    assert.equal(readSettings(reg, root)[k], v)
  }
})

test('a switch that was never written reads its default', () => {
  assert.equal(readSettings(reg, inserted()).hidenote, true)
})

test('applying a setting leaves its input alone', () => {
  const root = inserted()
  const before = structuredClone(root)
  applied(root, 'heading', 'X')
  assert.deepEqual(root, before)
})

test('a number is clamped to its limits', () => {
  const root = inserted()
  assert.equal(readSettings(reg, applied(root, 'limit', 999)).limit, 200)
  assert.equal(readSettings(reg, applied(root, 'limit', -5)).limit, 1)
})

test('a switch with invert writes the opposite', () => {
  assert.equal(
    find(applied(inserted(), 'hidenote', false), 'abc.note')!.style!.base!
      .hidden,
    true,
  )
})

test('editing a text turns its sample mark to false and drops chrome', () => {
  const root = inserted()
  find(root, 'abc.title')!.props!.chrome = true
  const props = find(applied(root, 'heading', 'Mine'), 'abc.title')!.props!
  assert.equal(props.sample, false)
  assert.equal('chrome' in props, false)
})

test('writing the same text again leaves the sample mark and chrome alone', () => {
  const root = inserted()
  find(root, 'abc.title')!.props!.chrome = true
  const props = find(applied(root, 'heading', 'Old'), 'abc.title')!.props!
  assert.equal(props.sample, true)
  assert.equal(props.chrome, true)
})

// A registry whose `demo` block has these settings (and `mut`, a function that mutates its argument).
const mut: SettingFn = {
  read: () => undefined,
  apply(root) {
    root.name = 'Mutated'
    return root
  },
}
function regWith(settings: Setting[]) {
  const r = createRegistry()
  r.use({
    ...DEMO_PLUGIN,
    blocks: [{ ...DEMO, settings }],
    settingFns: { mut },
  })
  const t = insertBlock(r, 'demo', 'default', 'abc')
  assert.ok(t.ok)
  return { r, root: t.root }
}

test('a wrong type, an unknown key, and a tree with no origin are refused with INVALID_NODE', () => {
  const { r: lr, root: lroot } = regWith([
    {
      key: 'site',
      label: 'Site',
      type: 'link',
      actions: [{ do: 'set', path: 'title.props.href' }],
    },
  ])
  const nul = applySetting(lr, lroot, 'site', null as never)
  assert.ok(!nul.ok)
  assert.equal(nul.problems[0].code, 'INVALID_NODE')
  const root = inserted()
  for (const r of [
    applySetting(reg, root, 'limit', 'many'),
    applySetting(reg, root, 'nope', 1),
    applySetting(reg, { ...root, origin: undefined }, 'limit', 1),
  ]) {
    assert.ok(!r.ok)
    assert.equal(r.problems[0].code, 'INVALID_NODE')
  }
})

test('a setting function is called, and a missing one is refused', () => {
  const root = applied(inserted(), 'upper', 'shout')
  assert.equal((find(root, 'abc.title')!.props!.runs as Run[])[0].text, 'SHOUT')
  assert.equal(readSettings(reg, root).upper, 'SHOUT')
  const bare = createRegistry()
  bare.use({ ...DEMO_PLUGIN, settingFns: undefined })
  const r = applySetting(bare, root, 'upper', 'x')
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, 'INVALID_NODE')
  assert.match(r.problems[0].message, /upper/)
})

test('a cleared textarea hides what show names, and text shows it again', () => {
  const { r, root } = regWith([
    {
      key: 'body',
      label: 'Body',
      type: 'textarea',
      actions: [
        { do: 'set', path: 'note.props.runs' },
        { do: 'show', nodes: ['note'] },
      ],
    },
  ])
  const cleared = applySetting(r, root, 'body', '')
  assert.ok(cleared.ok)
  assert.equal(find(cleared.root, 'abc.note')!.style!.base!.hidden, true)
  const filled = applySetting(r, cleared.root, 'body', 'hi')
  assert.ok(filled.ok)
  assert.equal(find(filled.root, 'abc.note')!.style?.base?.hidden, undefined)
})

test("a change to runs made by any action marks the text as the owner's", () => {
  const { r, root } = regWith([
    {
      key: 'tone',
      label: 'Tone',
      type: 'select',
      options: [{ label: 'A', value: 'a' }],
      actions: [
        {
          do: 'choose',
          default: '',
          options: { a: { write: { 'title.props.runs': [{ text: 'A' }] } } },
        },
      ],
    },
  ])
  const out = applySetting(r, root, 'tone', 'a')
  assert.ok(out.ok)
  assert.equal(find(out.root, 'abc.title')!.props!.sample, false)
})

test('a setting function gets a copy, so it cannot change the input', () => {
  const { r, root } = regWith([
    { key: 'm', label: 'M', type: 'text', fn: 'mut' },
  ])
  const out = applySetting(r, root, 'm', 'x')
  assert.ok(out.ok)
  assert.equal(out.root.name, 'Mutated')
  assert.equal(root.name, 'Demo')
})
