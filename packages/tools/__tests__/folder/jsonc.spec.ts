import test from 'node:test'
import assert from 'node:assert/strict'
import { editFile, parseFile, removeAt } from '../../src/folder/jsonc.ts'

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
