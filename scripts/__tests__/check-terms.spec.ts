import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
test('a generated CSP digest is opaque; neighbouring identifiers are still scanned', () => {
  const path = 'packages/core/src/scripts/scriptsMin.ts'
  const hash = 'sha256-Oh2O0QuCVPk8qdAFLngcqGEQ7tI71S2lGXwaXsw658A='
  assert.deepEqual(termHits([{ path, source: `const paperId = "${hash}"` }]), [
    `${path}:1 paper`,
  ])
  assert.deepEqual(termHits([{ path: 'a.ts', source: hash }]), ['a.ts:1 CV'])
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

test('lowercase compound Culm ids are hits', () => {
  for (const id of ['paperlist', 'scholarprofile', 'bookingform']) {
    assert.equal(
      termHits([{ path: 'a.ts', source: JSON.stringify({ id }) }]).length > 0,
      true,
      id,
    )
  }
})

for (const word of [
  'scholars',
  'labs',
  'bookings',
  'paper2',
  'PDFPaper',
  'CVList',
  'scholarosWidget',
  'CVs',
  'CVsList',
  'getCVsFor',
  'myCVs',
  'LABs',
  'evoscholar',
  'publications',
  'talks',
])
  test(`${word} is a hit`, () =>
    assert.equal(termHits([{ path: 'a.ts', source: word }]).length > 0, true))

test('GitLab is a known false hit', () =>
  assert.deepEqual(termHits([{ path: 'a.ts', source: 'GitLab' }]), [
    'a.ts:1 lab',
  ]))

test('the check needs packages/core/src: run from a directory without it, it exits 1 with a message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'terms-'))
  try {
    const r = spawnSync(
      process.execPath,
      [
        '--conditions=@culmjs/source',
        '--import',
        import.meta.resolve('tsx'),
        join(process.cwd(), 'scripts', 'check-terms.ts'),
      ],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout + r.stderr, /packages\/core\/src/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
