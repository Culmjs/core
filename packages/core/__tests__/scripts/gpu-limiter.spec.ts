import assert from 'node:assert/strict'
import test from 'node:test'
import { limitChannel } from '../../src/scripts/gpuLimiter.ts'

test('linear-light channel oracle: capped clock, sanitization and both directions', () => {
  for (const ms of [1000 / 120, 1000 / 60, 1000 / 30, 60000]) {
    const step = (0.25 * Math.min(33, ms)) / 1000
    assert.equal(limitChannel(0, 1, ms, 0.25), step)
    assert.equal(limitChannel(1, 0, ms, 0.25), 1 - step)
    assert.equal(limitChannel(0.5, Infinity, ms, 0.25), 0.5 - step)
    assert.equal(limitChannel(0.5, NaN, ms, 0.25), 0.5 - step)
    assert.equal(limitChannel(0.5, 0.501, ms, 0.25), 0.501)
  }
  assert.equal(limitChannel(0.3, 1, -1000, 0.25), 0.3)
})
