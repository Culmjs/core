// Validate one completed run and emit per-visit CSV. With BENCH_POSTER_PIXELS=1
// in the input, emit one row per compositor sample instead. Diagnostics (stderr)
// keep paint/readiness medians separate from the number of actual activations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const run = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const groups = Map.groupBy(run.runs, r => `${r.name}/${r.profile}`)
assert.ok(groups.size, 'No measured visits')
const median = a => {
  const b = a.filter(Number.isFinite).sort((x, y) => x - y)
  return b.length
    ? +((b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2).toFixed(1)
    : null
}
const csv = fields =>
  console.log(
    fields
      .map(v => {
        if (typeof v === 'number') return +v.toFixed(2)
        if (v == null) return ''
        const s = String(v)
        return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
      })
      .join(','),
  )

const pixels = Array.isArray(run.runs[0].pixels)
csv(
  pixels
    ? [
        'variant',
        'profile',
        'round',
        'capture_start_ms',
        'capture_end_ms',
        'p10_green',
        'p90_green',
        'both_contour_bands',
        'effect_ready_ms',
      ]
    : [
        'variant',
        'profile',
        'round',
        'lcp_ms',
        'effect_ready_ms',
        'active_at_end',
        'completed_draws_s',
        'p95_interval_ms',
        'brotli_body_bytes',
        'raw_js_bytes',
        'raw_host_sha256',
        'work_sizes',
        'presentation_sizes',
        'cls',
        'fcp_ms',
        'long_task_ms',
      ],
)
for (const [group, visits] of groups) {
  assert.equal(visits.length, run.count, group)
  assert.equal(new Set(visits.map(r => r.round)).size, run.count, group)
  const bands = []
  for (const r of visits) {
    const b = run.bytes[r.name]
    assert.ok(
      r.lcp > 0 && r.fcp > 0 && !r.errors.length && r.visible !== 'hidden',
    )
    // Suppression can legitimately skip loading the host. Validate just the
    // compressed resources the browser saw instead of assuming all effects ran.
    assert.equal(
      r.wire,
      b.brHtml + r.resources.reduce((n, one) => n + one[3], 0),
      group,
    )
    assert.ok(r.wire <= b.brHtml + b.brExternal, group)
    if (r.activeAtEnd) assert.ok(r.firstActive > 0 && r.ack.n > 0, group)
    if (pixels) {
      for (const p of r.pixels) {
        assert.ok(p.before <= p.after && p.p10 <= p.p90)
        assert.equal(p.contour, p.p10 <= 150 && p.p90 >= 159)
        csv([
          r.name,
          r.profile,
          r.round,
          p.before,
          p.after,
          p.p10,
          p.p90,
          p.contour,
          r.firstActive,
        ])
      }
      bands.push(r.pixels.find(p => p.contour)?.after)
    } else {
      csv([
        r.name,
        r.profile,
        r.round,
        r.lcp,
        r.firstActive,
        r.activeAtEnd,
        r.ack.fps,
        r.ack.p95ms,
        r.wire,
        b.rawJs,
        b.gpuHostSha256,
        r.sizes.join(';'),
        r.presentationSizes?.join(';'),
        r.cls,
        r.fcp,
        r.longMs,
      ])
    }
  }
  console.error(
    JSON.stringify({
      group,
      visits: visits.length,
      active: visits.filter(r => r.activeAtEnd).length,
      lcpMs: median(visits.map(r => r.lcp)),
      readyMs: median(visits.map(r => r.firstActive)),
      completedDrawsS: median(visits.map(r => r.ack.fps)),
      p95IntervalMs: median(visits.map(r => r.ack.p95ms)),
      bodyBytes: median(visits.map(r => r.wire)),
      ...(pixels && {
        visitsShowingBands: bands.filter(Number.isFinite).length,
        medianConfirmedByMs: median(bands),
      }),
    }),
  )
}
