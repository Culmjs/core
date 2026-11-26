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
      'c3f76b6df86ca58552cee72159cac104fd83e25c9e7747c516d36695b9c7f06a',
    )
    assert.equal(
      row.stats.scriptBytes.timeline,
      Buffer.byteLength(
        interactive ? TIMELINE_SCRIPT : PLAYBACK_TIMELINE_SCRIPT,
      ),
    )
    assert.ok(row.stats.scriptBytes.states > 0)
    assert.equal(row.worker, 3385)
    assert.equal(row.embeddedWorker, 3388)
    assert.equal(row.host, 9513)
    assert.equal(row.shared, interactive ? 19962 : 17429)
    assert.ok(
      row.host <= BUDGETS.gpuHostScript && row.shared <= BUDGETS.sharedScripts,
    )
    assert.deepEqual(row.refusals, [])
  })
