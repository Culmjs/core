import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { renderGpuHost, renderGpuWorker } from '../gen-scripts.ts'

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

test('the exact checked renderer has independent reports for both controls and limited clips', () => {
  const host = sha(renderGpuHost(true))
  const worker = sha(renderGpuWorker(true))
  const key = `host-${host.slice(0, 16)}`
  const root = new URL('../../docs/gpu/evidence/', import.meta.url)
  const files = new URL(`iris/${key}/`, root)
  const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
  const report = json(new URL('summary.json', files))
  assert.equal(report.passed, true)
  assert.equal(report.hostSha256, host)
  assert.equal(report.workerSha256, worker)
  assert.equal(report.runs.length, 4)
  for (const fixture of ['achromatic', 'saturated-red']) {
    for (const role of ['control', 'limited']) {
      const name = `${fixture}-${role}`
      const row = report.runs.find(
        (r: { fixture: string; role: string }) =>
          r.fixture === fixture && r.role === role,
      )
      assert.ok(row?.meetsFixtureExpectation, name)
      const rel = fixture === 'achromatic' ? '' : `${fixture}/`
      const capture = json(
        new URL(`task-7/${key}/${rel}${role}-summary.json`, root),
      )
      assert.equal(capture.host, host)
      assert.equal(capture.workerBodySha256, worker)
      assert.equal(
        capture.fixtureWorkerBodySha256 === worker,
        role === 'limited',
      )
      assert.equal(row.clipSha256, capture.clipSha256)
      const raw = gunzipSync(readFileSync(new URL(`${name}.csv.gz`, files)))
      assert.equal(sha(raw), row.reportSha256)
      assert.equal(row.frames, 180)
      if (role === 'limited') {
        assert.deepEqual(row.frameResults, {
          Luminance: { 0: 180 },
          Red: { 0: 180 },
        })
      } else {
        assert.ok(row.frameResults.Luminance[3] > 0)
        if (fixture === 'saturated-red') assert.ok(row.frameResults.Red[3] > 0)
      }
    }
  }
})
