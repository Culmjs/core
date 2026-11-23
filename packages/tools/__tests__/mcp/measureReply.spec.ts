import test from 'node:test'
import assert from 'node:assert/strict'
import type { Finding, Report } from '@culmjs/core/measure'
import { compactFindings, measureReply } from '../../src/mcp/measureReply.ts'

const finding = (
  width: number,
  theme: 'light' | 'dark' = 'light',
  more: Partial<Finding> = {},
): Finding => ({
  page: 'home',
  width,
  theme,
  dir: 'ltr',
  check: 'contrast',
  class: 1,
  revision: 3,
  nodes: ['b', 'a'],
  state: 'default',
  fonts: true,
  assets: true,
  observed: 2,
  expected: '4.5',
  message: `low contrast at ${width}`,
  key: `contrast|home|${width}|${theme}`,
  fix: 'darker ink',
  ...more,
})
const report = (findings: Finding[]): Report => ({
  revision: 3,
  build: 'b1',
  profile: 1,
  browser: 'chrome',
  findings,
  measured: findings.map(f => ({
    page: f.page,
    width: f.width,
    theme: f.theme,
    dir: f.dir,
  })),
  incomplete: [],
  blocked: [],
  skipped: [],
})
const all = [1280, 834, 390].flatMap(w => [finding(w), finding(w, 'dark')])
const ordered = [
  ...all.filter(f => f.theme === 'light'),
  ...all.filter(f => f.theme === 'dark'),
]

test('one finding at 1280, 834 and 390, light and dark, is one row with at ["1280","834","390","1280 dark","834 dark","390 dark"]', () => {
  const rows = compactFindings(ordered)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0]!.at, [
    '1280',
    '834',
    '390',
    '1280 dark',
    '834 dark',
    '390 dark',
  ])
  assert.deepEqual(rows[0]!.nodes, ['a', 'b'])
  assert.equal(rows[0]!.message, 'low contrast at 1280')
  assert.equal(
    compactFindings([finding(1280, 'light', { dir: 'rtl' })])[0]!.at[0],
    '1280 rtl',
  )
})

test('a row has only page, check, nodes, at, message, fix, file and line; the reply has no build, browser or profile', () => {
  const located = { ...finding(1280), file: 'a.json', line: 4 } as Finding
  const rows = compactFindings([located])
  assert.deepEqual(Object.keys(rows[0]!).sort(), [
    'at',
    'check',
    'file',
    'fix',
    'line',
    'message',
    'nodes',
    'page',
  ])
  const r = measureReply(report(ordered))
  assert.deepEqual(Object.keys(r).sort(), [
    'blocked',
    'findings',
    'incomplete',
    'measured',
    'revision',
    'skipped',
  ])
  assert.equal(r.measured, ordered.length)
})

test('with since: still-failing and new rows (new: true) in findings, gone ones in fixed, unchecked as a count', () => {
  const still = finding(1280)
  const added = finding(390, 'light', { check: 'overflow', key: 'ov' })
  const gone = finding(834, 'light', { check: 'tap', key: 'tap' })
  const away = finding(1280, 'light', { check: 'far', key: 'far' })
  const r = measureReply(report([still, added]), {
    was: [
      { finding: still, status: 'present' },
      { finding: gone, status: 'fixed' },
      { finding: away, status: 'unchecked' },
    ],
    added: [added],
  }) as {
    findings: Record<string, unknown>[]
    fixed: Record<string, unknown>[]
    unchecked: number
  }
  assert.deepEqual(
    r.findings.map(f => [f.check, f.new]),
    [
      ['contrast', undefined],
      ['overflow', true],
    ],
  )
  assert.deepEqual(
    r.fixed.map(f => f.check),
    ['tap'],
  )
  assert.equal(r.unchecked, 1)
})

test('two findings in one cell with nodes [] and different messages are two rows, and identical ones collapse', () => {
  const bad = (message: string) =>
    finding(1280, 'light', { check: 'invalid', nodes: [], message })
  const rows = compactFindings([
    bad('Image a is missing'),
    bad('Font b is missing'),
    bad('Font b is missing'),
  ])
  assert.deepEqual(
    rows.map(r => r.message),
    ['Image a is missing', 'Font b is missing'],
  )
  const r = measureReply(report([bad('x'), bad('y')]), {
    was: [
      { finding: bad('z'), status: 'fixed' },
      { finding: bad('w'), status: 'fixed' },
    ],
    added: [],
  }) as { fixed: unknown[] }
  assert.equal(r.fixed.length, 2)
})
