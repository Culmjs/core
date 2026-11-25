import assert from 'node:assert/strict'
import test from 'node:test'
import { nextQuality, type Quality } from '../../src/scripts/gpuQuality.ts'

test('quality changes only on complete consecutive whole-frame windows', () => {
  let q: Quality = Object.freeze({ scale: 0.25, fast: 0, slow: 0 })
  function frames(n: number, ms: number) {
    while (n--) q = nextQuality(q, ms)
    return q.scale
  }
  assert.equal(frames(59, 16.7), 0.25)
  frames(1, 16.71)
  assert.equal(frames(59, 16.7), 0.25)
  assert.equal(frames(1, 16.7), 0.5)
  assert.equal(frames(60, 15), 1)
  frames(7, 25.1)
  frames(1, 25)
  assert.equal(frames(7, 26), 1)
  assert.equal(frames(1, 26), 0.5)
  assert.equal(frames(8, 26), 0.25)
  assert.equal(frames(8, 26), 'fallback')
  assert.equal(frames(120, 15), 'fallback')
})
