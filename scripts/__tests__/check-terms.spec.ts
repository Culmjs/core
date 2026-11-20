import test from 'node:test'
import assert from 'node:assert/strict'
import { termHits } from '../check-terms.ts'

test('product terms are found as whole words, any case', () => {
  assert.equal(
    termHits([{ path: 'a.ts', source: '// lists the Papers of a scholar' }])
      .length,
    2,
  )
})
test('CV is matched in capitals only, and parts of words are not hits', () => {
  assert.deepEqual(
    termHits([
      {
        path: 'a.ts',
        source: 'const cv = newspaper + stalk + label + planet;',
      },
    ]),
    [],
  )
  assert.equal(termHits([{ path: 'a.ts', source: '// the CV page' }]).length, 1)
})
test('a hit names the file, line and term', () => {
  assert.deepEqual(termHits([{ path: 'a.ts', source: 'ok\nmarketplace' }]), [
    'a.ts:2 marketplace',
  ])
})
test('terms inside identifiers are hits; cv in lower case is not', () => {
  for (const id of [
    'paperId',
    'PaperList',
    'isPremium',
    'talk_count',
    'labName',
    'myCV',
  ]) {
    assert.equal(
      termHits([{ path: 'a.ts', source: `const ${id} = 1` }]).length,
      1,
      id,
    )
  }
  assert.deepEqual(termHits([{ path: 'a.ts', source: 'const cv = 1' }]), [])
})
