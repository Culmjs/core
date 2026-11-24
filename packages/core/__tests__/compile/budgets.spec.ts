import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUDGETS,
  byteLength,
  checkBudgets,
  type PageStats,
} from '../../src/compile/budgets.ts'

const ok: PageStats = {
  bytes: 1,
  styleBytes: 16_000,
  scriptBytes: { base: 10_000, states: 6_193, timeline: 3_800 },
  elements: 2_000,
  depth: 12,
}

test('exactly at every ceiling passes', () =>
  assert.deepEqual(checkBudgets(ok), []))

test('one over each ceiling is one problem naming that ceiling', () => {
  const over: [Partial<PageStats>, string][] = [
    [{ styleBytes: 16_001 }, 'css'],
    [{ scriptBytes: { base: 10_001, states: 0 } }, 'baseScript'],
    [{ scriptBytes: { base: 0, states: 6_194 } }, 'statesScript'],
    [
      { scriptBytes: { base: 0, states: 0, timeline: 3_801 } },
      'timelineScript',
    ],
    [{ elements: 2_001 }, 'elements'],
    [{ depth: 13 }, 'depth'],
  ]
  for (const [more, key] of over) {
    const ps = checkBudgets({ ...ok, ...more })
    assert.equal(ps.length, 1)
    assert.equal(ps[0].code, 'RESOURCE_LIMIT_EXCEEDED')
    assert.equal(ps[0].path, key)
  }
})

test('the shared total is checked on its own', () => {
  const ps = checkBudgets({
    ...ok,
    scriptBytes: { base: 10_000, states: 10_001 },
  })
  assert.deepEqual(
    ps.map(p => p.path),
    ['statesScript', 'sharedScripts'],
  )
  assert.match(ps[1].message, /20001/)
  assert.match(ps[1].message, /20000/)
  assert.equal(BUDGETS.sharedScripts, 20_000)
})

test('byteLength counts UTF-8 bytes', () => assert.equal(byteLength('é€'), 5))

test('the shared finding counts all three scripts independently of individual findings', () => {
  assert.equal(BUDGETS.timelineScript, 3800)
  for (const [base, paths] of [
    [10007, ['baseScript']],
    [10008, ['baseScript', 'sharedScripts']],
  ] as const) {
    const findings = checkBudgets({
      ...ok,
      scriptBytes: { base, states: 6193, timeline: 3800 },
    })
    assert.deepEqual(
      findings.map(p => [p.code, p.path]),
      paths.map(k => ['RESOURCE_LIMIT_EXCEEDED', k]),
    )
  }
})
