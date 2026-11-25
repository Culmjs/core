import { bounds, gpuRect, overlap } from './gpuGeometry.ts'
import { nextQuality, type Quality } from './gpuQuality.ts'

declare const WORKER_SOURCE: string
declare const EFFECT_ID: string

export function hostGpu(doc: Document, win: Window): void {
  const w = win as Window & typeof globalThis
  const data = doc.getElementById('culm-gpu') as
    (HTMLElement & { hosted?: boolean }) | null
  if (!data || data.hosted) return
  data.hosted = true
  const key = 'culm:slow:' + EFFECT_ID
  try {
    if (w.localStorage[key] === '1') return
  } catch {
    /* An unavailable store does not prevent this page's attempt. */
  }
  const main = doc.querySelector('main')!
  if (
    !w.OffscreenCanvas ||
    !w.WebGL2RenderingContext ||
    !w.Worker ||
    !w.ResizeObserver
  )
    return
  const payload = JSON.parse(data.textContent!)
  const owners = Array.from(
    main.querySelectorAll<HTMLElement>('[data-culm-gpu]'),
  ).flatMap(el => {
    const r = payload.regions[+el.dataset.culmGpu!]
    return payload.definitions[r.definition].builtin === EFFECT_ID
      ? [{ el, speed: r.settings.speed as number }]
      : []
  })
  if (!owners.length) return
  const motion = w.matchMedia('(prefers-reduced-motion: reduce)')
  const connection = (
    w.navigator as Navigator & {
      connection?: EventTarget & { saveData?: boolean }
    }
  ).connection
  const events = new AbortController()
  const mark = 'data-gpu-painted'
  let canvas: HTMLCanvasElement | undefined,
    worker: Worker | undefined,
    url = ''
  let raf = 0,
    watchdog = 0,
    last = 0,
    elapsed = 0
  let acknowledged = '',
    submitted = ''
  // Acknowledgements identify a completed layout, not just a linked program.
  // An old scissor list cannot uncover a poster after a scroll or reflow.
  let quality: Quality = { scale: 0.25, fast: 0, slow: 0 }
  function hide() {
    if (canvas && !canvas.hidden) {
      canvas.hidden = true
      for (const { el } of owners) el.removeAttribute(mark)
    }
    acknowledged = ''
  }
  function revoke() {
    if (url) w.URL.revokeObjectURL(url)
    url = ''
  }
  function release() {
    invalidateArea()
    w.clearTimeout(watchdog)
    worker?.terminate()
    worker = undefined
    revoke()
    canvas?.remove()
    canvas = undefined
    watchdog = 0
  }
  function stop() {
    release()
    w.cancelAnimationFrame(raf)
    io.disconnect()
    resize.disconnect()
    events.abort()
  }
  function schedule() {
    if (!events.signal.aborted && !raf && !doc.hidden)
      raf = w.requestAnimationFrame(frame)
  }
  function invalidate() {
    invalidateArea()
    schedule()
  }
  function arm() {
    watchdog = w.setTimeout(stop, 1500)
  }
  function start(width: number, height: number) {
    canvas = doc.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.className = 'culm-plane'
    canvas.ariaHidden = 'true' // canvas is natively outside the tab order
    canvas.hidden = true
    const surface = canvas.transferControlToOffscreen()
    url = w.URL.createObjectURL(
      new w.Blob([WORKER_SOURCE], { type: 'text/javascript' }),
    )
    const current = (worker = new w.Worker(url))
    worker.onerror = e => {
      e.preventDefault()
      stop()
    }
    worker.onmessage = ({ data }) => {
      if (worker !== current) return
      if (data === -1) return stop()
      w.clearTimeout(watchdog)
      watchdog = 0
      if (data === 0) revoke()
      else acknowledged = submitted
      schedule()
    }
    main.prepend(canvas)
    arm()
    worker.postMessage(surface, [surface])
  }
  function frame(now: number) {
    raf = 0
    if (doc.hidden) return
    if (motion.matches || connection?.saveData) return release()
    try {
      const { clientWidth: width, clientHeight: height } = doc.documentElement
      if (!width || !height) return invalidateArea()
      const scale = Math.min(
        Math.min(w.devicePixelRatio, 2) * +quality.scale,
        Math.sqrt(1048576 / (width * height)),
      )
      const bw = Math.floor(width * scale),
        bh = Math.floor(height * scale)
      const forms = Array.from(
        doc.querySelectorAll('form,input,select,textarea'),
        bounds,
      )
      const rects = owners.map(({ el, speed }) =>
        gpuRect(el, main, forms, width, height, bw, bh, speed),
      )
      const visible = rects.filter(Boolean)
      if (!visible.length) {
        invalidateArea()
        // CSS animation, clipping or a hidden witness can change while an
        // owner stays in view. Offscreen/zero-area pages sleep until notified.
        if (
          owners.some(({ el }) =>
            overlap(new DOMRect(0, 0, width, height), bounds(el)),
          )
        )
          schedule()
        return
      }
      const shape = JSON.stringify([bw, bh, rects])
      if (acknowledged !== shape) hide()
      if (!worker) start(bw, bh)
      if (acknowledged === shape && canvas!.hidden) {
        owners.forEach(({ el }, i) => el.toggleAttribute(mark, !!rects[i]))
        canvas!.hidden = false
      }
      if (!watchdog) {
        if (last) {
          quality = nextQuality(quality, now - last)
          if (quality.scale === 'fallback') {
            try {
              w.localStorage[key] = '1'
            } catch {
              /* terminal in memory */
            }
            return stop()
          }
          elapsed += Math.min(33, now - last) / 1000
        }
        last = now
        submitted = shape
        arm()
        worker!.postMessage([bw, bh, visible, elapsed])
      }
      schedule()
    } catch {
      stop()
    }
  }
  function invalidateArea() {
    hide()
    last = 0
    quality.fast = quality.slow = 0
  }
  const io = new w.IntersectionObserver(schedule)
  const resize = new w.ResizeObserver(invalidate)
  for (const { el } of owners) {
    io.observe(el)
    resize.observe(el)
  }
  const on = (target: EventTarget | undefined, event: string, fn: () => void) =>
    target?.addEventListener?.(event, fn, {
      capture: event === 'scroll',
      signal: events.signal,
    })
  on(w, 'resize', invalidate)
  on(w, 'scroll', invalidate)
  on(doc, 'visibilitychange', invalidate)
  on(motion, 'change', schedule)
  on(connection, 'change', schedule)
  on(w, 'pagehide', stop)
  schedule()
}
