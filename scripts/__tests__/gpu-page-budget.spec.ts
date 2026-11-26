import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { BUDGETS } from '../../packages/core/src/compile/budgets.ts'
import {
  TIMELINE_SCRIPT,
  PLAYBACK_TIMELINE_SCRIPT,
} from '../../packages/core/src/scripts/scriptsMin.ts'

for (const interactive of [false, true])
  test(`production mixed page fits with ${interactive ? 'interactive, unreviewed' : 'playback, reviewed'} GPU content`, () => {
    const output = execFileSync(
      process.execPath,
      [
        '--conditions=@culmjs/source',
        '--import',
        'tsx',
        'scripts/gpu-flash-price.ts',
        '--require-fit',
        ...(interactive ? ['--interactive', '--unreviewed'] : []),
      ],
      { encoding: 'utf8' },
    )
    const row = output
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
      .find(r => r.profile === 'release')
    assert.ok(row)
    assert.equal(
      row.sha256,
      '2844a4b873444f705f173749aa722da0d6a0cb1c9e653a7f38ae58e6d8d8e597',
    )
    assert.equal(
      row.stats.scriptBytes.timeline,
      Buffer.byteLength(
        interactive ? TIMELINE_SCRIPT : PLAYBACK_TIMELINE_SCRIPT,
      ),
    )
    assert.ok(row.stats.scriptBytes.states > 0)
    assert.equal(row.worker, 2972)
    assert.equal(row.embeddedWorker, 2979)
    assert.equal(row.host, 9012)
    assert.equal(row.shared, interactive ? 19997 : 17484)
    assert.ok(
      row.host <= BUDGETS.gpuHostScript && row.shared <= BUDGETS.sharedScripts,
    )
    assert.deepEqual(row.refusals, [])
  })
