/** Generation binds the path and integrity to the shipped host, never to document data. */
export function loadGpu(
  d: Document,
  w: Window & typeof globalThis,
  p: string,
  sri: string,
) {
  const C = 'culm-gpu'
  const g = d.getElementById(C) as (HTMLElement & { observed?: number }) | null
  const IO = w.IntersectionObserver
  const RO = w.ResizeObserver
  const q = (s: string) => d.querySelectorAll('[data-' + s + ']')
  if (!g || g.observed || !IO || !(g.observed = 1)) return
  const m = w.matchMedia('(prefers-reduced-motion: reduce)'),
    c = () =>
      (
        w.navigator as Navigator & {
          connection?: EventTarget & { saveData?: boolean }
        }
      ).connection
  let live = 1
  const ok = (x = c()) => live && !m.matches && !(x && x.saveData)
  const io = new IO(
    es => {
      if (
        ok() &&
        es.some(
          e =>
            e.isIntersecting &&
            e.boundingClientRect.width * e.boundingClientRect.height,
        )
      ) {
        live = 0
        stop()
        d.head.append(
          Object.assign(d.createElement('script'), { src: p, integrity: sri }),
        )
      }
    },
    { rootMargin: '200px' },
  )
  const ro =
    RO &&
    new RO(
      es => ok() && es.map(e => (io.unobserve(e.target), io.observe(e.target))),
    )
  const stop = () => (io.disconnect(), ro && ro.disconnect())
  const obs = () => {
    stop()
    if (ok()) {
      const r = q('gpu-run')
      ;(r.length ? r : q(C)).forEach(e => (io.observe(e), ro && ro.observe(e)))
    }
  }
  ;[m, c()].map(
    t => t && t.addEventListener && t.addEventListener('change', obs),
  )
  obs()
}
