import assert from 'node:assert/strict'
import test from 'node:test'
import { runImageTokenBench } from '../image-token-bench.ts'

test('compact Culm image creation compiles all 6 visual tasks cleanly and saves >=60% output tokens vs coding and >=50% total tokens vs --full plan', () => {
  const { rows, summary } = runImageTokenBench()
  assert.equal(rows.length, 6)
  assert.ok(
    summary.outSavingsVsCodingPct >= 60,
    `expected >=60% output savings vs coding, got ${summary.outSavingsVsCodingPct}%`,
  )
  assert.ok(
    summary.totalSavingsVsFullPct >= 50,
    `expected >=50% total savings vs --full plan, got ${summary.totalSavingsVsFullPct}%`,
  )
})
