import test from 'node:test'
import assert from 'node:assert/strict'
import * as raw from '../../src/folder/jsonc.ts'
import { parseFile } from '../../src/folder/jsonc.ts'

// the happy-path tests expect a string
const editFile = (...a: Parameters<typeof raw.editFile>) => raw.editFile(...a)!
const removeAt = (...a: Parameters<typeof raw.removeAt>) => raw.removeAt(...a)!

const doc = `{
  "name": "site",
  // the pages
  "pages": [
    { "id": "a", "title": "A" },
    { "id": "b", "title": "B" }
  ],
  "last": 1
}
`

test('parseFile gives line and column of a nested value and of a key that has a comment above it', () => {
  const f = parseFile(doc)
  assert.deepEqual(f.errors, [])
  assert.deepEqual(f.at(['pages', 1, 'title']), {
    offset: doc.indexOf('"title": "B"'),
    line: 6,
    column: 18,
  })
  const pages = f.at(['pages'])
  assert.equal(pages?.line, 4)
  assert.equal(pages?.column, 3)
  assert.equal(f.at(['nope']), undefined)
  assert.deepEqual((f.value as { last: number }).last, 1)
})

test('a syntax error is returned with its place, not thrown', () => {
  const f = parseFile('{\n  "a": 1,\n  "b": ,\n}\n')
  assert.ok(f.errors.length > 0)
  assert.equal(f.errors[0]!.line, 3)
  assert.equal(typeof f.errors[0]!.message, 'string')
})

test('an edit leaves every other byte, every comment and the key order unchanged', () => {
  const after = editFile(doc, ['pages', 0, 'title'], 'Home')
  const a = doc.split('\n')
  const b = after.split('\n')
  assert.equal(a.length, b.length)
  const changed = a.map((l, i) => i).filter(i => a[i] !== b[i])
  assert.deepEqual(changed, [4])
  assert.equal(b[4], '    { "id": "a", "title": "Home" },')
})

test('an edit in a tab-indented file writes tabs; in a 4-space file, 4 spaces', () => {
  const tabs = '{\n\t"a": 1\n}\n'
  assert.equal(
    editFile(tabs, ['b'], { c: 1 }),
    '{\n\t"a": 1,\n\t"b": {\n\t\t"c": 1\n\t}\n}\n',
  )
  const four = '{\n    "a": 1\n}\n'
  assert.equal(
    editFile(four, ['b'], { c: 1 }),
    '{\n    "a": 1,\n    "b": {\n        "c": 1\n    }\n}\n',
  )
})

test('insert: one past the end of an array, or with the insert option', () => {
  const t = '{\n  "xs": [\n    1,\n    3\n  ]\n}\n'
  assert.deepEqual(parseFile(editFile(t, ['xs', 2], 4)).value, {
    xs: [1, 3, 4],
  })
  assert.deepEqual(
    parseFile(editFile(t, ['xs', 1], 2, { insert: true })).value,
    { xs: [1, 2, 3] },
  )
  assert.deepEqual(parseFile(editFile(t, ['xs', 1], 2)).value, { xs: [1, 2] })
})

test('removeAt removes a key and its trailing comma, and an array element', () => {
  const noKey = removeAt(doc, ['name'])
  assert.deepEqual(parseFile(noKey).errors, [])
  assert.ok(!noKey.includes('"name"'))
  assert.ok(noKey.includes('// the pages'))
  const noEl = removeAt(doc, ['pages', 0])
  assert.deepEqual((parseFile(noEl).value as { pages: unknown[] }).pages, [
    { id: 'b', title: 'B' },
  ])
  assert.deepEqual(parseFile(removeAt(doc, ['last'])).errors, [])
})

for (const variant of ['crlf', 'bom', 'no final newline', 'tabs']) {
  test(`${variant}: edit then the reverse edit gives the original bytes back`, () => {
    let text = doc
    if (variant === 'crlf') text = doc.replace(/\n/g, '\r\n')
    if (variant === 'bom') text = '﻿' + doc
    if (variant === 'no final newline') text = doc.trimEnd()
    if (variant === 'tabs')
      text = doc.replace(/^( {2})+/gm, m => '\t'.repeat(m.length / 2))
    const there = editFile(text, ['pages', 1, 'title'], 'Other')
    assert.notEqual(there, text)
    assert.equal(editFile(there, ['pages', 1, 'title'], 'B'), text)
    if (variant === 'bom') assert.ok(there.startsWith('﻿{'))
    if (variant === 'crlf')
      assert.ok(!/(?<!\r)\n/.test(editFile(text, ['z'], { y: 1 })))
    assert.equal(removeAt(editFile(text, ['z'], 1), ['z']), text)
  })
}

test('editFile and removeAt return undefined, not throw, for a scalar on the path and for broken text', () => {
  assert.equal(raw.editFile('{"a":1}', ['a', 'b'], 2), undefined)
  assert.equal(raw.editFile('{"a":1}', ['a', 0], 2), undefined)
  assert.equal(raw.editFile('{ "a": ', ['a'], 1), undefined)
  assert.equal(raw.removeAt('{"a":1}', ['a', 'b']), undefined)
  assert.equal(raw.removeAt('{"a":1}', ['zz']), undefined)
  assert.equal(raw.removeAt('{ "a": ', ['a']), undefined)
})

test('an indent is never taken from a comment line', () => {
  const t = '{\n/*\n * hi\n */\n    "a": 1\n}\n'
  assert.equal(
    editFile(t, ['b'], 2),
    '{\n/*\n * hi\n */\n    "a": 1,\n    "b": 2\n}\n',
  )
})

test('removing the last element of an inline array leaves no stray space', () => {
  assert.equal(removeAt('{ "a": [1, 2, 3] }', ['a', 2]), '{ "a": [1, 2] }')
  assert.equal(removeAt('{ "a": [1, 2, 3] }', ['a', 0]), '{ "a": [2, 3] }')
})

test('an insert into an inline array leaves every other byte unchanged', () => {
  const t = '{ "a": [{ "x": 1 }, { "y": 2 }], "b": 1 }'
  const out = editFile(t, ['a', 1], { z: 3 }, { insert: true })
  const at = t.indexOf(', { "y"')
  assert.ok(out.startsWith(t.slice(0, at + 2)))
  assert.ok(out.endsWith(', ' + t.slice(at + 2)))
  assert.deepEqual(parseFile(out).value, {
    a: [{ x: 1 }, { z: 3 }, { y: 2 }],
    b: 1,
  })
  const front = editFile(t, ['a', 0], 5, { insert: true })
  assert.equal(front, t.replace('[', '[5, '))
})

test('an insert into a multi-line array leaves every other byte unchanged, a trailing comment stays with its element', () => {
  const t = `{
  "a": [
    { "x": 1 }, // first
    // second
    { "y": 2 } // last
  ]
}
`
  const mid = editFile(t, ['a', 1], { z: 3 }, { insert: true })
  const cut = t.indexOf('\n    // second')
  assert.ok(mid.startsWith(t.slice(0, cut)))
  assert.ok(mid.endsWith(t.slice(cut)))
  assert.deepEqual((parseFile(mid).value as { a: unknown[] }).a, [
    { x: 1 },
    { z: 3 },
    { y: 2 },
  ])
  const end = editFile(t, ['a', 2], 7, { insert: true })
  assert.ok(end.includes('{ "y": 2 }, // last\n    7\n'))
  assert.ok(end.startsWith(t.slice(0, t.indexOf('{ "y": 2 }') + 10)))
  assert.deepEqual((parseFile(end).value as { a: unknown[] }).a.length, 3)
  const front = editFile(t, ['a', 0], 7, { insert: true })
  assert.ok(front.endsWith(t.slice(t.indexOf('{ "x"'))))
  assert.ok(front.includes('    7,\n    { "x": 1 }, // first'))
})

test('an insert finds the comma of the element before it, past a block comment or a line break', () => {
  const c = editFile('[1 /* c */, 2]', [1], 5, { insert: true })
  assert.deepEqual(parseFile(c).errors, [])
  assert.equal(c, '[1 /* c */, 5, 2]')
  const n = editFile('[1\n, 2]', [1], 5, { insert: true })
  assert.deepEqual(parseFile(n).errors, [])
  assert.deepEqual(parseFile(n).value, [1, 5, 2])
  assert.ok(n.startsWith('[1\n,'))
  assert.ok(n.endsWith(' 2]'))
  const last = editFile('[1 /* c */]', [1], 5, { insert: true })
  assert.deepEqual(parseFile(last).errors, [])
  assert.deepEqual(parseFile(last).value, [1, 5])
})

test('a result that does not parse is never returned', () => {
  assert.equal(raw.onlyIfValid('{ "a": '), undefined)
  assert.equal(raw.onlyIfValid('{ "a": 1 }'), '{ "a": 1 }')
})
