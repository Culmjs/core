import { bounds, gpuRect } from './gpuGeometry.ts'
import { nextQuality, type Quality } from './gpuQuality.ts'

declare const WORKER_SOURCE: string
declare const EFFECT_ID: string

export function hostGpu(doc: Document, win: Window): void {
  const w = win as Window & typeof globalThis
  const page = doc as Document & { culmGpu?: true }
  if (page.culmGpu) return
  page.culmGpu = true
  const main = doc.querySelector('main')
  if (!main) return
  const key = 'culm:slow:' + EFFECT_ID
  try {
    if (w.localStorage[key] === '1') return
  } catch {
    /* An unavailable store does not prevent this page's attempt. */
  }
  const owners = Array.from(
    main.querySelectorAll<HTMLElement>('[data-gpu-run]'),
  )
  if (
    !w.OffscreenCanvas ||
    !w.WebGL2RenderingContext ||
    !w.Worker ||
    !w.ResizeObserver ||
    !owners.length
  )
    return
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
    retry = 0,
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
      for (const el of owners) el.removeAttribute(mark)
    }
    acknowledged = ''
  }
  function revoke() {
    if (url) w.URL.revokeObjectURL(url)
    url = ''
  }
  function stop() {
    events.abort()
    hide()
    w.clearTimeout(watchdog)
    w.clearTimeout(retry)
    if (worker) worker.terminate()
    revoke()
    if (canvas) canvas.remove()
    w.cancelAnimationFrame(raf)
    io.disconnect()
    resize.disconnect()
  }
  function schedule() {
    if (!events.signal.aborted && !raf && !retry && !doc.hidden)
      raf = w.requestAnimationFrame(frame)
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
    worker = new w.Worker(url)
    worker.onerror = e => {
      e.preventDefault()
      stop()
    }
    worker.onmessage = ({ data }) => {
      if (events.signal.aborted) return
      if (data === -1) return stop()
      w.clearTimeout(watchdog)
      watchdog = 0
      revoke()
      acknowledged = submitted
      schedule()
    }
    main!.prepend(canvas)
    return surface
  }
  function frame(now: number) {
    raf = 0
    if (doc.hidden || motion.matches || (connection && connection.saveData))
      return pause()
    try {
      const { clientWidth: width, clientHeight: height } = doc.documentElement
      const scale = Math.min(
        Math.min(w.devicePixelRatio, 2) * +quality.scale,
        2048 / Math.max(width, height),
        Math.sqrt(1048576 / (width * height)),
      )
      const bw = Math.floor(width * scale),
        bh = Math.floor(height * scale)
      const forms = Array.from(
        doc.querySelectorAll('form,form *,[form],input,select,textarea'),
        bounds,
      )
      const rects = owners.map(el =>
        gpuRect(el, main!, forms, width, height, bw, bh, +el.dataset.gpuRun!),
      )
      const visible = rects.filter(Boolean)
      if (!visible.length) {
        pause()
        // Offscreen owners sleep until observed. A visible but unsafe box can
        // change even through CSS alone: coalesce all wakeups to at most 2 Hz.
        if (rects.includes(undefined))
          retry = w.setTimeout(() => {
            retry = 0
            schedule()
          }, 500)
        return
      }
      const shape = JSON.stringify([bw, bh, rects])
      if (acknowledged !== shape) hide()
      if (acknowledged === shape && canvas!.hidden) {
        owners.forEach((el, i) => el.toggleAttribute(mark, !!rects[i]))
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
        if (!worker && doc.body.querySelectorAll('*').length >= 2000)
          return stop()
        const surface = worker ? undefined : start(bw, bh)
        watchdog = w.setTimeout(stop, 1500)
        worker!.postMessage(
          [bw, bh, visible, elapsed, surface],
          surface ? [surface] : [],
        )
      }
      schedule()
    } catch {
      stop()
    }
  }
  function pause() {
    hide()
    last = 0
    quality.fast = quality.slow = 0
  }
  const io = new w.IntersectionObserver(schedule)
  const resize = new w.ResizeObserver(schedule)
  for (const el of owners) {
    io.observe(el)
    resize.observe(el)
  }
  const on = (target: EventTarget, event: string, fn: () => void) =>
    target.addEventListener(event, fn, {
      capture: target === w,
      signal: events.signal,
    })
  on(w, 'resize', schedule)
  on(w, 'scroll', schedule)
  on(doc, 'visibilitychange', () => (doc.hidden ? pause() : schedule()))
  on(motion, 'change', schedule)
  if (connection && typeof connection.addEventListener === 'function')
    on(connection, 'change', schedule)
  on(w, 'pagehide', stop)
  schedule()
}
