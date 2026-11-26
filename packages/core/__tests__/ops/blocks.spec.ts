import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compilePage } from '../../src/compile/index.ts'
import { MAX_NODES, find, walk } from '../../src/document/index.ts'
import type { Node, SiteDocument } from '../../src/document/index.ts'
import {
  insertBlock,
  setBlockSetting,
  updateBlock,
} from '../../src/ops/blocks.ts'
import * as nodeOps from '../../src/ops/nodes.ts'
import { rootOf } from '../../src/ops/trees.ts'
import type { Op, OpResult } from '../../src/ops/types.ts'
import { DEMO, DEMO_PLUGIN } from '../kit.ts'
import { createRegistry, type Plugin } from '../../src/registry/index.ts'
import { validateSite } from '../../src/validate/index.ts'
import {
  bigPage,
  demoV2Registry,
  kitRegistry,
  node,
  sampleRegistry,
  siteWith,
  text,
} from '../kit.ts'

const reg = sampleRegistry()
const T = { page: 'home' }

const ins = (doc: SiteDocument, more: object = {}, r = reg): OpResult =>
  insertBlock(doc, r, {
    op: 'insertBlock',
    tree: T,
    parent: 'homeroot',
    index: 0,
    block: 'demo',
    look: 'default',
    ...more,
  } as Op & { op: 'insertBlock' })
const ok = (r: OpResult) => {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  return r
}
const subtree = (doc: SiteDocument, id: string): Node =>
  find(rootOf(doc, T)!, id)!
const ids = (n: Node) => {
  const out: string[] = []
  walk(n, w => out.push(w.id))
  return out
}
const refused = (r: OpResult, code: string, more: object = {}) => {
  assert.ok(!r.ok)
  assert.equal(r.problems[0].code, code)
  assert.partialDeepStrictEqual(r.problems[0], more)
}
const homeRoot = (doc: SiteDocument) => doc.pages[0].root.id
const setting = (
  doc: SiteDocument,
  id: string,
  key: string,
  value: unknown,
  r = reg,
) =>
  setBlockSetting(doc, r, {
    op: 'setBlockSetting',
    tree: T,
    id,
    key,
    value,
  } as never)
const update = (doc: SiteDocument, id: string, r = reg) =>
  updateBlock(doc, r, { op: 'updateBlock', tree: T, id })

// A document with a version 1 demo block "b1".
const withBlock = (): SiteDocument =>
  ok(ins(siteWith([text('t', 'x')]), { id: 'b1' })).doc!

test('insertBlock inserts the look, applies the given settings, and lists root and parts in created', () => {
  const doc = siteWith([text('t', 'x')])
  const r = ok(
    ins(doc, { id: 'b1', index: 1, settings: { limit: 3, heading: 'Hi' } }),
  )
  const b = subtree(r.doc!, 'b1')
  assert.deepEqual(b.origin, { block: 'demo', version: 1, look: 'default' })
  assert.deepEqual(
    r.doc!.pages[0].root.children!.map(c => c.id),
    ['t', 'b1'],
  )
  assert.equal(find(b, 'b1.list')!.repeat!.max, 3)
  assert.deepEqual(find(b, 'b1.title')!.props!.runs, [{ text: 'Hi' }])
  assert.deepEqual(
    r.created.map(c => c.id),
    ids(b),
  )
  assert.deepEqual(
    r.created.map(c => c.id),
    ['b1', 'b1.title', 'b1.list', 'b1.item', 'b1.note'],
  )
  assert.deepEqual(r.changed, [{ tree: T, id: homeRoot(doc) }])
  assert.equal(doc.pages[0].root.children!.length, 1, 'input untouched')
  assert.deepEqual(validateSite(r.doc!, reg), [])
})

test('insertBlock applies settings in the order the block declares them, not the order of the keys', () => {
  // `upper` writes the title; `heading` writes it too. Declared order: heading, then upper.
  const a = ok(
    ins(siteWith(), { id: 'b1', settings: { heading: 'x', upper: 'y' } }),
  )
  const b = ok(
    ins(siteWith(), { id: 'b1', settings: { upper: 'y', heading: 'x' } }),
  )
  assert.deepEqual(a.doc, b.doc)
  assert.deepEqual(find(subtree(a.doc!, 'b1'), 'b1.title')!.props!.runs, [
    { text: 'Y' },
  ])
})

test('insertBlock without an id takes the next n-id; with one, uses it', () => {
  const doc = siteWith([text('n1', 'x')])
  const a = ok(ins(doc))
  assert.equal(a.created[0].id, 'n2')
  assert.ok(find(rootOf(a.doc!, T)!, 'n2.title'))
  const b = ok(ins(a.doc!, { id: 'mine' }))
  assert.equal(b.created[0].id, 'mine')
  assert.deepEqual(ids(subtree(b.doc!, 'mine')).slice(0, 2), [
    'mine',
    'mine.title',
  ])
  assert.equal(ok(ins(a.doc!)).created[0].id, 'n3')
})

test('insertBlock refusals: UNKNOWN_BLOCK for the block and for the look (allowed lists), INVALID_OPERATION for parent and index, the setting refusals of applySetting passed through with nodeId', () => {
  const doc = siteWith([text('t', 'x')])
  refused(ins(doc, { block: 'nope' }), 'UNKNOWN_BLOCK', { allowed: ['demo'] })
  refused(ins(doc, { look: 'nope' }), 'UNKNOWN_BLOCK', { allowed: ['default'] })
  refused(ins(doc, { parent: 'zz' }), 'INVALID_OPERATION', { path: 'parent' })
  refused(ins(doc, { tree: { page: 'zz' } }), 'INVALID_OPERATION', {
    path: 'tree',
  })
  for (const index of [-1, 2, 0.5, '0', null])
    refused(ins(doc, { index }), 'INVALID_OPERATION', { path: 'index' })
  // wrong or missing fields: each is refused as INVALID_OPERATION, with the field it is about
  for (const [more, path] of [
    [{ block: 3 }, 'block'],
    [{ look: undefined }, 'look'],
    [{ settings: 3 }, 'settings'],
    [{ settings: [] }, 'settings'],
    [{ id: 3 }, 'id'],
    [{ id: 'A.b' }, 'id'],
    [{ id: 'x'.repeat(21) }, 'id'],
    [{ id: 't' }, 'id'],
  ] as [object, string][])
    refused(ins(doc, more), 'INVALID_OPERATION', { path })
  refused(ins(doc, { id: 't' }), 'INVALID_OPERATION', { path: 'id' })
  // setting refusals, from applySetting
  refused(ins(doc, { id: 'b1', settings: { nope: 1 } }), 'INVALID_NODE', {
    nodeId: 'b1',
    allowed: ['heading', 'limit', 'hidenote', 'upper'],
  })
  refused(ins(doc, { id: 'b1', settings: { limit: 'many' } }), 'INVALID_NODE', {
    nodeId: 'b1',
    path: 'limit',
  })
  // unsafe keys
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const settings = JSON.parse(`{"${key}": 1}`)
    refused(ins(doc, { settings }), 'INVALID_OPERATION')
  }
  assert.equal(doc.pages[0].root.children!.length, 1)
})

test('setBlockSetting writes one setting and lists the changed parts', () => {
  const doc = withBlock()
  const r = ok(setting(doc, 'b1', 'heading', 'Hello'))
  assert.deepEqual(find(subtree(r.doc!, 'b1'), 'b1.title')!.props!.runs, [
    { text: 'Hello' },
  ])
  assert.deepEqual(r.changed, [{ tree: T, id: 'b1.title' }])
  assert.deepEqual(r.created, [])
  const l = ok(setting(doc, 'b1', 'limit', 4))
  assert.deepEqual(l.changed, [{ tree: T, id: 'b1.list' }])
  assert.equal(find(subtree(l.doc!, 'b1'), 'b1.list')!.repeat!.max, 4)
  assert.deepEqual(subtree(doc, 'b1.list').repeat!.max, 6, 'input untouched')
})

test('setBlockSetting on a node that is not a block root is refused', () => {
  const doc = withBlock()
  refused(setting(doc, 't', 'heading', 'x'), 'INVALID_OPERATION', {
    nodeId: 't',
  })
  refused(setting(doc, 'b1.title', 'heading', 'x'), 'INVALID_OPERATION')
  refused(setting(doc, 'zz', 'heading', 'x'), 'INVALID_OPERATION', {
    nodeId: 'zz',
  })
  refused(setting(doc, 'b1', 'nope', 'x'), 'INVALID_OPERATION', {
    nodeId: 'b1',
  })
  refused(setting(doc, 'b1', 3 as never, 'x'), 'INVALID_OPERATION', {
    path: 'key',
  })
  refused(setting(doc, 'b1', 'heading', 3), 'INVALID_OPERATION', {
    path: 'heading',
  })
  // a value that is missing is a fault of the operation, not of the node
  const noValue = { op: 'setBlockSetting', tree: T, id: 'b1', key: 'heading' }
  refused(setBlockSetting(doc, reg, noValue as never), 'INVALID_OPERATION', {
    nodeId: 'b1',
    path: 'value',
  })
  refused(setting(doc, 'b1', 'heading', undefined), 'INVALID_OPERATION', {
    nodeId: 'b1',
    path: 'value',
  })
  refused(
    setting(doc, 'b1', 'heading', JSON.parse('{"__proto__": 1}')),
    'INVALID_OPERATION',
  )
})

test('updateBlock moves a version 1 demo block to version 2 keeping heading and limit', () => {
  const v1 = ok(
    setting(
      ok(setting(withBlock(), 'b1', 'heading', 'Mine')).doc!,
      'b1',
      'limit',
      9,
    ),
  ).doc!
  const placed = nodeOps.setHidden(v1, reg, {
    op: 'setHidden',
    tree: T,
    id: 'b1',
    layout: 'phone',
    hidden: true,
  })
  const doc = ok(placed).doc!
  const r = ok(update(doc, 'b1', demoV2Registry()))
  const b = subtree(r.doc!, 'b1')
  assert.deepEqual(b.origin, { block: 'demo', version: 2, look: 'default' })
  assert.deepEqual(find(b, 'b1.title')!.props!.runs, [{ text: 'Mine' }])
  assert.equal(find(b, 'b1.list')!.repeat!.max, 9)
  assert.ok(find(b, 'b1.sub'))
  assert.equal(find(b, 'b1.note'), undefined)
  assert.deepEqual(b.hide, { phone: true }, 'placement kept')
  assert.deepEqual(r.created, [{ tree: T, id: 'b1.sub' }])
  assert.deepEqual(r.changed, [{ tree: T, id: 'b1' }])
  assert.deepEqual(
    r.doc!.pages[0].root.children!.map(c => c.id),
    ['b1', 't'],
    'position kept',
  )
  assert.deepEqual(validateSite(r.doc!, demoV2Registry()), [])
  assert.equal(subtree(doc, 'b1').origin!.version, 1, 'input untouched')
})

test('updateBlock lists as a reset note the parts a person changed outside a setting', () => {
  const v1 = ok(
    nodeOps.setStyle(withBlock(), reg, {
      op: 'setStyle',
      tree: T,
      id: 'b1.item',
      layer: 'base',
      decl: { gap: 40 },
    }),
  ).doc!
  const r = ok(update(v1, 'b1', demoV2Registry()))
  const resets = (r.notes ?? []).filter(n => n.kind === 'reset')
  assert.equal(resets.length, 1)
  assert.ok(resets[0].ids.includes('b1.item'))
  assert.ok(resets[0].ids.includes('b1.note'), 'a part the new look lacks')
  assert.deepEqual(resets[0].ids, ['b1.item', 'b1.note'])
  assert.deepEqual(subtree(r.doc!, 'b1.item').style, {
    base: { gap: 12, width: { n: 31, unit: '%' } },
  })
  // nothing changed outside settings and nothing lost: no reset note
  const quiet = ok(update(withBlock(), 'b1', demoV2Registry()))
  assert.deepEqual(
    quiet.notes!.flatMap(n => n.ids),
    ['b1.note'],
  )
})

test('updateBlock is refused when a required part would be lost', () => {
  const doc = ok(
    nodeOps.setRequired(withBlock(), reg, {
      op: 'setRequired',
      tree: T,
      id: 'b1.note',
      required: true,
    }),
  ).doc!
  refused(update(doc, 'b1', demoV2Registry()), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'b1.note',
  })
})

test('updateBlock at the registered version changes nothing and says so in an info note', () => {
  const doc = withBlock()
  const r = ok(update(doc, 'b1'))
  assert.deepEqual(r.doc, doc)
  assert.deepEqual(r.created, [])
  assert.deepEqual(
    r.notes!.map(n => ({ kind: n.kind, ids: n.ids })),
    [{ kind: 'info', ids: ['b1'] }],
  )
  assert.match(r.notes![0].text, /already/)
})

test('updateBlock refusals: not a block, unknown block, look gone, unknown node', () => {
  const doc = withBlock()
  refused(update(doc, 't'), 'INVALID_OPERATION', { nodeId: 't' })
  refused(update(doc, 'zz'), 'INVALID_OPERATION', { nodeId: 'zz' })
  refused(update(doc, 'b1', createRegistry()), 'UNKNOWN_BLOCK')
  const other = withBlock()
  subtree(other, 'b1').origin!.look = 'gone'
  refused(update(other, 'b1'), 'UNKNOWN_BLOCK', { allowed: ['default'] })
})

test('the kit plug-in registers: a page with a badge and a stamp validates; four badges are refused by max-badges', () => {
  const r = kitRegistry()
  const badge = (id: string) => node(id, 'badge')
  const st = ok(ins(siteWith([badge('a')]), { block: 'stamp', id: 's1' }, r))
  assert.deepEqual(validateSite(st.doc!, r), [])
  const many = siteWith([badge('a'), badge('b'), badge('c'), badge('d')])
  const problems = validateSite(many, r)
  assert.ok(
    problems.some(
      p => p.rule === 'max-badges' && p.code === 'POLICY_VIOLATION',
    ),
  )
  // the stamp itself holds one badge: three more make four
  const four = ok(
    ins(
      siteWith([badge('a'), badge('b'), badge('c')]),
      { block: 'stamp', id: 's1' },
      r,
    ),
  )
  assert.ok(validateSite(four.doc!, r).some(p => p.rule === 'max-badges'))
  // the `shout` function runs
  const s = ok(setting(st.doc!, 's1', 'shout', 'hey', r))
  assert.deepEqual(find(subtree(s.doc!, 's1'), 's1.title')!.props!.runs, [
    { text: 'hey!' },
  ])
})

test('a page holding a badge and a stamp compiles; the badge draws its tip (a plug-in kind writes its tag and attributes only) and the stamp its title', () => {
  const r = kitRegistry()
  const badge = node('bd', 'badge')
  badge.props = { label: 'Shown nowhere', tip: 'Fresh tip' }
  const doc = ok(
    ins(
      siteWith([badge]),
      { block: 'stamp', id: 's1', settings: { title: 'Hello stamp' } },
      r,
    ),
  ).doc!
  const out = compilePage(doc, 'home', { registry: r })
  assert.ok(out.ok, JSON.stringify(!out.ok && out.problems))
  assert.match(out.html, /<span [^>]*data-tip="Fresh tip"[^>]*><\/span>/)
  assert.ok(!out.html.includes('Shown nowhere'), 'the label is not drawn')
  assert.ok(out.html.includes('Hello stamp'))
})

test('bigPage(2000) holds exactly 2000 nodes and validates', () => {
  for (const n of [1, 2, 11, 2000]) {
    const doc = bigPage(n)
    let count = 0
    walk(doc.pages[0].root, () => count++)
    assert.equal(count, n)
    assert.deepEqual(validateSite(doc, reg), [], String(n))
  }
  assert.equal(MAX_NODES, 2000)
  // every text says a different thing, so a test that counts words can tell a lost node from a repeated one
  const words: string[] = []
  walk(bigPage(2000).pages[0].root, w => {
    if (w.kind === 'text')
      words.push((w.props!.runs as { text: string }[])[0].text)
  })
  assert.ok(words.length > 1000)
  assert.equal(new Set(words).size, words.length)
})

test('updateBlock reports an edit on the block root, and not when there is none', () => {
  const styled = ok(
    nodeOps.setStyle(withBlock(), reg, {
      op: 'setStyle',
      tree: T,
      id: 'b1',
      layer: 'base',
      decl: { gap: 7 },
    }),
  ).doc!
  const r = ok(update(styled, 'b1', demoV2Registry()))
  const reset = r.notes!.find(n => n.kind === 'reset')!
  assert.deepEqual(reset.ids, ['b1', 'b1.note'])
  assert.equal(subtree(r.doc!, 'b1').style, undefined)
  const plain = ok(update(withBlock(), 'b1', demoV2Registry()))
  assert.ok(!plain.notes!.some(n => n.ids.includes('b1')))
})

test('updateBlock keeps a required mark on a node that stays, and still refuses to lose one', () => {
  const mark = (doc: SiteDocument, id: string) =>
    ok(
      nodeOps.setRequired(doc, reg, {
        op: 'setRequired',
        tree: T,
        id,
        required: true,
      }),
    ).doc!
  const t = ok(update(mark(withBlock(), 'b1.title'), 'b1', demoV2Registry()))
  assert.equal(subtree(t.doc!, 'b1.title').required, true)
  const r = ok(update(mark(withBlock(), 'b1'), 'b1', demoV2Registry()))
  assert.equal(subtree(r.doc!, 'b1').required, true)
  assert.ok(
    !r.notes!.some(n => n.ids.includes('b1')),
    'the mark is not a difference',
  )
  refused(
    update(mark(withBlock(), 'b1.note'), 'b1', demoV2Registry()),
    'POLICY_VIOLATION',
    {
      rule: 'required',
    },
  )
})

test('updateBlock reports a setting value the new version rejects in a reset note', () => {
  const withSize = (version: number, options: string[]) => {
    const r = createRegistry()
    r.use({
      ...DEMO_PLUGIN,
      version,
      settingFns: undefined,
      blocks: [
        {
          ...DEMO,
          version,
          settings: [
            {
              key: 'size',
              label: 'Size',
              type: 'select',
              options: options.map(v => ({ label: v, value: v })),
              actions: [{ do: 'set', path: 'title.props.level' }],
            },
          ],
        },
      ],
    })
    return r
  }
  const v1 = withSize(1, ['h1', 'h2'])
  const doc = ok(
    ins(siteWith(), { id: 'b1', settings: { size: 'h1' } }, v1),
  ).doc!
  const r = ok(update(doc, 'b1', withSize(2, ['h2'])))
  const note = r.notes!.find(
    n => n.kind === 'reset' && n.text.includes('size'),
  )!
  assert.deepEqual(note.ids, ['b1'])
  assert.match(note.text, /h1/)
})

test('insertBlock of a block with an insert function uses the tree that function returns', () => {
  const r = kitRegistry()
  const doc = ok(ins(siteWith(), { block: 'stamp', id: 's1' }, r)).doc!
  assert.deepEqual(find(subtree(doc, 's1'), 's1.title')!.props!.runs, [
    { text: 'Stamped' },
  ])
  assert.deepEqual(r.block('stamp')!.looks[0].tree.children![0].props!.runs, [
    { text: 'Stamp' },
  ])
})

test('setBlockSetting is refused when a setting function drops a required part', () => {
  const dropper = createRegistry()
  dropper.use({
    ...DEMO_PLUGIN,
    settingFns: {
      upper: {
        read: () => undefined,
        apply(root) {
          const out: Node = JSON.parse(JSON.stringify(root))
          out.children = out.children!.filter(c => c.id !== `${root.id}.title`)
          return out
        },
      },
    },
  })
  const doc = withBlock()
  // without the mark the function may drop the part, so the test shows the function does
  const free = ok(setting(doc, 'b1', 'upper', 'x', dropper))
  assert.equal(find(subtree(free.doc!, 'b1'), 'b1.title'), undefined)
  const marked = ok(
    nodeOps.setRequired(doc, reg, {
      op: 'setRequired',
      tree: T,
      id: 'b1.title',
      required: true,
    }),
  ).doc!
  refused(setting(marked, 'b1', 'upper', 'x', dropper), 'POLICY_VIOLATION', {
    rule: 'required',
    nodeId: 'b1.title',
  })
  // a setting that keeps every part is still accepted
  ok(setting(marked, 'b1', 'heading', 'Hello'))
})

test("updateBlock keeps the block root's show conditions, lock and name, none of them a difference for the reset note", () => {
  const keys: [string, unknown][] = [
    ['showIf', { from: 'site', field: 'title' }],
    [
      'showIfAny',
      [
        { from: 'site', field: 'title' },
        { from: 'site', field: 'name' },
      ],
    ],
    ['locked', true],
    ['name', 'My own name'],
  ]
  for (const [key, value] of keys) {
    const doc = withBlock()
    ;(subtree(doc, 'b1') as unknown as Record<string, unknown>)[key] = value
    assert.deepEqual(validateSite(doc, reg), [], key)
    const r = ok(update(doc, 'b1', demoV2Registry()))
    const b = subtree(r.doc!, 'b1') as unknown as Record<string, unknown>
    assert.deepEqual(b[key], value, `${key} kept`)
    const reset = r.notes!.filter(n => n.kind === 'reset').flatMap(n => n.ids)
    assert.ok(!reset.includes('b1'), `${key} is not a difference: ${reset}`)
    assert.deepEqual(validateSite(r.doc!, demoV2Registry()), [], key)
  }
})

const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}

test('the block operations leave a frozen input document alone, whether they succeed or refuse', () => {
  const doc = deepFreeze(withBlock())
  const before = JSON.stringify(doc)
  ok(ins(doc, { id: 'b2', settings: { heading: 'Two' } }))
  refused(ins(doc, { id: 'b1' }), 'INVALID_OPERATION')
  ok(setting(doc, 'b1', 'heading', 'Hello'))
  refused(setting(doc, 'b1', 'heading', 3), 'INVALID_OPERATION')
  ok(update(doc, 'b1', demoV2Registry()))
  refused(update(doc, 't'), 'INVALID_OPERATION')
  assert.equal(JSON.stringify(doc), before)
})

test('updateBlock keeps the slot, the placement and the hiding of the block root', () => {
  const doc = withBlock()
  const b = subtree(doc, 'b1')
  b.slot = { grow: 3 }
  b.placement = { mode: 'front' }
  b.hide = { tablet: true }
  assert.deepEqual(validateSite(doc, reg), [])
  const r = ok(update(doc, 'b1', demoV2Registry()))
  const kept = subtree(r.doc!, 'b1')
  assert.deepEqual(kept.slot, { grow: 3 })
  assert.deepEqual(kept.placement, { mode: 'front' })
  assert.deepEqual(kept.hide, { tablet: true })
  const reset = r.notes!.filter(n => n.kind === 'reset').flatMap(n => n.ids)
  assert.ok(!reset.includes('b1'), `the root is not a difference: ${reset}`)
})

test('updateBlock: a required: false mark is not carried onto a node that is no longer a form or a field; the batch stays valid and the node is named in a reset note', () => {
  const plugin = (version: number, kind: Node['kind']): Plugin => ({
    name: 'kc',
    version,
    api: [1],
    runs: ['build' as const],
    trust: 'declarative' as const,
    blocks: [
      {
        id: 'kc',
        version,
        name: 'KC',
        category: 'utility',
        settings: [],
        looks: [
          {
            id: 'default',
            name: 'Default',
            tree: {
              id: 'root',
              kind: 'form' as const,
              name: 'KC',
              slot: {},
              props: { formId: 'kc' },
              children: [
                {
                  id: 'f',
                  kind,
                  name: 'F',
                  slot: {},
                  props:
                    kind === 'field'
                      ? { name: 'email', label: 'E' }
                      : { level: 'p', runs: [{ text: 'x' }] },
                },
              ],
            },
          },
        ],
      },
    ],
  })
  const regOf = (version: number, kind: Node['kind']) => {
    const r = createRegistry()
    r.use(plugin(version, kind))
    return r
  }
  const v1 = regOf(1, 'field')
  const v2 = regOf(2, 'text')
  const doc = ok(
    ins(
      siteWith([]),
      { block: 'kc', id: 'k1', parent: homeRoot(siteWith([])) },
      v1,
    ),
  ).doc!
  nodeOpsSetRequired(doc, 'k1.f', false)
  assert.deepEqual(validateSite(doc, v1), [])
  const r = ok(update(doc, 'k1', v2))
  assert.equal(subtree(r.doc!, 'k1.f').kind, 'text')
  assert.equal(subtree(r.doc!, 'k1.f').required, undefined)
  assert.deepEqual(validateSite(r.doc!, v2), [])
  const reset = r.notes!.filter(n => n.kind === 'reset').flatMap(n => n.ids)
  assert.ok(reset.includes('k1.f'), String(reset))
  // a mark that still fits (a field that stays a field) is carried, as before
  const same = ok(update(doc, 'k1', regOf(3, 'field')))
  assert.equal(subtree(same.doc!, 'k1.f').required, false)
})

/** Writes `required` on a node of the home page, in place (test set-up only). */
function nodeOpsSetRequired(doc: SiteDocument, id: string, required: boolean) {
  subtree(doc, id).required = required
}

test('setBlockSetting with an unknown key or a bad value is INVALID_OPERATION', () => {
  const doc = withBlock()
  const r = setting(doc, 'b1', 'nope', 'x')
  refused(r, 'INVALID_OPERATION', { nodeId: 'b1' })
  assert.ok(!r.ok && r.problems[0].allowed?.includes('heading'))
  refused(setting(doc, 'b1', 'heading', 3), 'INVALID_OPERATION', {
    path: 'heading',
  })
})
