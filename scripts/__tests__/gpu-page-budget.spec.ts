import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { BUDGETS } from '../../packages/core/src/compile/budgets.ts'
import { TIMELINE_SCRIPT } from '../../packages/core/src/scripts/scriptsMin.ts'

test('the full timeline, states and an unreviewed checked GPU effect fit the mixed page together', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--conditions=source',
      '--import',
      'tsx',
      'scripts/gpu-flash-price.ts',
      '--interactive',
      '--unreviewed',
    ],
    { encoding: 'utf8' },
  )
  const row = output
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .find(r => r.profile === 'candidate')
  assert.ok(row)
  assert.equal(
    row.stats.scriptBytes.timeline,
    Buffer.byteLength(TIMELINE_SCRIPT),
  )
  assert.ok(
    row.stats.scriptBytes.states > 0 &&
      row.embeddedWorker >= row.worker &&
      row.worker > 0,
  )
  assert.ok(
    row.shared <= BUDGETS.sharedScripts,
    `${row.shared} > ${BUDGETS.sharedScripts}`,
  )
  // The separately enforced host limit must still be reported if exceeded.
  assert.deepEqual(
    row.refusals,
    row.host > BUDGETS.gpuHostScript ? ['gpuHostScript'] : [],
  )
})
