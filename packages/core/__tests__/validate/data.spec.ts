import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateSite } from '../../src/validate/index.ts'
import {} from '../kit.ts'
import {
  codes,
  col,
  fs,
  item,
  listOver,
  n,
  pc,
  put,
  reg,
  reg2,
  row,
  site,
  ttl,
} from './helpers.ts'

test('UNKNOWN_SOURCE for a list over an unregistered source, and for a binding to a field the source lacks', () => {
  assert.deepEqual(pc(validateSite(put(listOver('nope')), reg)), [
    ['UNKNOWN_SOURCE', 'l', 'repeat.source'],
  ])
  assert.deepEqual(
    validateSite(
      put(listOver('projects', [item([ttl({ label: row('title') })])])),
      reg,
    ),
    [],
  )
  const missing = validateSite(
    put(listOver('projects', [item([ttl({ label: row('nope') })])])),
    reg,
  )
  assert.deepEqual(pc(missing), [['UNKNOWN_SOURCE', 't', 'bind.label']])
  for (const field of ['__proto__', 'constructor', 'toString'])
    assert.deepEqual(
      codes(put(listOver('projects', [item([ttl({ label: row(field) })])]))),
      ['UNKNOWN_SOURCE'],
      field,
    )
  assert.deepEqual(
    codes(put(ttl({ label: row('title') }, { slot: fs() }))),
    ['UNKNOWN_SOURCE'],
    'no list around it',
  )
})

test('a reference that is not well formed, or a binding the kind does not take, is INVALID_NODE', () => {
  const inList = (bind: object) =>
    put(listOver('projects', [item([ttl(bind)])]))
  for (const ref of [
    { from: 'profile', field: 'bio' },
    { from: 'item' },
    { from: 'item', field: 'title', extra: 1 },
    { from: 'item', field: 'title', outer: -1 },
    { from: 'item', field: 'title', outer: 64 },
    { from: 'site', field: 'x', outer: 1 },
    'title',
    null,
  ])
    assert.deepEqual(
      codes(inList({ label: ref })),
      ['INVALID_NODE'],
      JSON.stringify(ref),
    )
  assert.deepEqual(
    codes(inList({ src: row('title') })),
    ['INVALID_NODE'],
    'a button has no src',
  )
  assert.deepEqual(codes(put(ttl([] as never, { slot: fs() }))), [
    'INVALID_NODE',
  ])
  assert.deepEqual(
    codes(inList({ label: { from: 'site', field: 'owner.name' } })),
    [],
  )
})

test('showIf and showIfAny point at fields that exist', () => {
  const inList = (extra: object) =>
    put(listOver('projects', [item([ttl({}, extra)])]))
  assert.deepEqual(codes(inList({ showIf: row('title') })), [])
  assert.deepEqual(pc(validateSite(inList({ showIf: row('nope') }), reg)), [
    ['UNKNOWN_SOURCE', 't', 'showIf'],
  ])
  assert.deepEqual(
    codes(inList({ showIfAny: [row('title'), row('kind')] })),
    [],
  )
  assert.deepEqual(codes(inList({ showIfAny: [row('title'), row('nope')] })), [
    'UNKNOWN_SOURCE',
  ])
  assert.deepEqual(codes(inList({ showIfAny: [] })), ['INVALID_NODE'])
  assert.deepEqual(codes(inList({ showIfAny: Array(9).fill(row('title')) })), [
    'INVALID_NODE',
  ])
  assert.deepEqual(
    codes(inList({ showIf: { from: 'item', field: 'title', outer: 'x' } })),
    ['INVALID_NODE'],
  )
})

test('a text run bound to a field is checked like any other binding', () => {
  const run = (r: object) =>
    put(
      listOver('projects', [
        item([
          {
            id: 't',
            kind: 'text',
            name: 'T',
            slot: {},
            props: { level: 'p', runs: [r] },
          },
        ]),
      ]),
    )
  assert.deepEqual(codes(run({ text: '', bind: row('title') })), [])
  assert.deepEqual(codes(run({ text: '', bind: row('nope') })), [
    'UNKNOWN_SOURCE',
  ])
  assert.deepEqual(
    codes(
      run({ text: 'x', link: { url: 'https://x.org' }, bindHref: row('nope') }),
    ),
    ['UNKNOWN_SOURCE'],
  )
  assert.deepEqual(codes(run({ text: '', bind: { from: 'item' } })), [
    'INVALID_NODE',
  ])
})

test('a repeat is a list or table over a registered source, with sane ranges', () => {
  const over = (extra: object, source: unknown = 'projects') =>
    put(listOver(source, [item()], extra))
  assert.deepEqual(
    codes(
      over({
        max: 200,
        skip: 1,
        marker: 'disc',
        sort: { field: 'title', dir: 'asc' },
      }),
    ),
    [],
  )
  for (const extra of [
    { max: 0 },
    { max: 201 },
    { max: 1.5 },
    { skip: -1 },
    { skip: 201 },
    { marker: 'bullet' },
    { extra: 1 },
    { sort: { field: 'nope', dir: 'asc' } },
    { sort: { field: 'title', dir: 'up' } },
  ])
    assert.deepEqual(
      codes(over(extra)),
      ['INVALID_NODE'],
      JSON.stringify(extra),
    )
  assert.deepEqual(
    codes(
      put({
        id: 'bx',
        kind: 'box',
        name: 'B',
        slot: fs(),
        repeat: { source: 'projects' },
        children: [],
      }),
    ),
    ['INVALID_NODE'],
    'a box cannot repeat',
  )
  assert.deepEqual(codes(over({}, { toString: 1 })), ['INVALID_NODE'])
  assert.deepEqual(codes(over({}, 5)), ['INVALID_NODE'])
})

test('filter, exclude, sort and group are held to the source field types', () => {
  const over = (extra: object) => put(listOver('people', [item()], extra))
  const r = (p: object) => validateSite(over(p), reg2)
  assert.deepEqual(
    r({
      filter: { field: 'name', is: 'Ada' },
      exclude: { field: 'open', is: true },
      sort: { field: 'years', dir: 'desc' },
      group: { field: 'years', dir: 'asc' },
    }),
    [],
  )
  assert.deepEqual(
    r({ filter: { field: 'tags', is: 'x' } }),
    [],
    'a list of plain values passes when it holds the value',
  )
  for (const p of [
    { filter: { field: 'years', is: 'many' } },
    { filter: { field: 'name', is: 3 } },
    { exclude: { field: 'open', is: 'yes' } },
    { filter: { field: 'links', is: 'x' } },
    { filter: { field: 'nope', is: 'x' } },
    { sort: { field: 'links', dir: 'asc' } },
    { group: { field: 'links' } },
    { group: { field: 'name', dir: 'up' } },
    { group: { field: 'nope' } },
  ])
    assert.deepEqual(
      r(p).map(x => x.code),
      ['INVALID_NODE'],
      JSON.stringify(p),
    )
})

test("a nested list repeats over the item's own collection, and outer: 1 reads the enclosing row", () => {
  const inner = (source: unknown, bind: object, extra: object = {}) =>
    put(
      listOver('people', [
        item([
          {
            id: 'in',
            kind: 'list',
            name: 'In',
            slot: {},
            repeat: { source, ...extra },
            children: [
              {
                id: 'ii',
                kind: 'box',
                name: 'II',
                slot: {},
                children: [ttl(bind)],
              },
            ],
          },
        ]),
      ]),
    )
  const v = (d: unknown) => validateSite(d, reg2)
  assert.deepEqual(v(inner(row('links'), { label: row('label') })), [])
  assert.deepEqual(
    v(inner(row('links'), { label: row('name', 1) })),
    [],
    'the enclosing person',
  )
  assert.deepEqual(
    v(inner(row('links'), { label: row('name') })).map(p => p.code),
    ['UNKNOWN_SOURCE'],
    'not a field of the link',
  )
  assert.deepEqual(
    v(inner(row('links'), { label: row('name', 2) })).map(p => p.code),
    ['UNKNOWN_SOURCE'],
    'no such outer row',
  )
  assert.deepEqual(
    v(inner(row('name'), { label: row('label') })).map(p => p.code)[0],
    'UNKNOWN_SOURCE',
    'name is not a collection',
  )
  assert.deepEqual(
    v(
      inner(
        row('links'),
        { label: row('label') },
        { filter: { field: 'label', is: 'x', of: row('name', 0) } },
      ),
    ),
    [],
    'a filter value from the enclosing row',
  )
  assert.deepEqual(
    v(
      inner(
        row('links'),
        { label: row('label') },
        { filter: { field: 'label', is: 'x', of: row('nope', 0) } },
      ),
    ).map(p => p.code),
    ['UNKNOWN_SOURCE'],
  )
  assert.deepEqual(
    v(inner({ from: 'profile', field: 'links' }, {})).map(p => p.code),
    ['INVALID_NODE'],
  )
})

test('a grouped list gives its template the group row: label, key, count and items', () => {
  const grouped = (field: string) =>
    put(
      listOver('people', [item([ttl({ label: row(field) })])], {
        group: { field: 'years' },
      }),
    )
  for (const field of ['label', 'key', 'count', 'items'])
    assert.deepEqual(validateSite(grouped(field), reg2), [], field)
  assert.deepEqual(
    validateSite(grouped('name'), reg2).map(p => p.code),
    ['UNKNOWN_SOURCE'],
    'the person fields are one level down',
  )
})

test('UNKNOWN_BLOCK for a node that came from a block no plug-in provides', () => {
  const from = (block: string) =>
    site(
      col(
        n({
          id: 'bl',
          kind: 'column',
          name: 'B',
          slot: {},
          origin: { block, version: 1, look: 'default' },
        }),
      ),
    )
  assert.deepEqual(validateSite(from('demo'), reg), [])
  assert.deepEqual(pc(validateSite(from('ghost'), reg)), [
    ['UNKNOWN_BLOCK', 'bl', 'origin.block'],
  ])
})

test('a text node cannot bind text or link: they bind through its runs, so the value would be dropped', () => {
  const textNode = (bind: object) =>
    put(
      listOver('projects', [
        item([
          { ...ttl({}), kind: 'text', props: { level: 'p', runs: [] }, bind },
        ]),
      ]),
    )
  for (const key of ['text', 'link'])
    assert.deepEqual(
      pc(validateSite(textNode({ [key]: row('title') }), reg)),
      [['INVALID_NODE', 't', `bind.${key}`]],
      key,
    )
})
