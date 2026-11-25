import { bounds, gpuRect } from './gpuGeometry.ts'
import { backdrop } from './gpuBackdrop.ts'
import { nextQuality, type Quality } from './gpuQuality.ts'
import type { Binding, Region } from './gpuWorker.ts'

declare const WORKER_SOURCE: string

type Stamp = { layout: string; fallback: string } | undefined
function matches(prior: Stamp, current: Stamp, live: boolean) {
  return (
    prior &&
    current &&
    prior.layout === current.layout &&
    (live || prior.fallback === current.fallback)
  )
}

export function hostGpu(doc: Document, win: Window): void {
  const w = win as Window & typeof globalThis
  const page = doc as Document & { culmGpu?: true }
  if (page.culmGpu) return
  page.culmGpu = true
  const main = doc.querySelector('main')
  const data = doc.getElementById('culm-gpu')
  if (!main || !data) return
  let payload
  try {
    payload = JSON.parse(data.textContent!)
  } catch {
    return
  }
  if (!Array.isArray(payload?.definitions) || !Array.isArray(payload.regions))
    return
  const { definitions, regions } = payload
  const keys: string[] = [],
    bindings: Binding[] = []
  const owners = Array.from(
    main.querySelectorAll<HTMLElement>('[data-gpu-run]'),
  ).filter(el => {
    const region = regions[+el.dataset.culmGpu!],
      d = region && definitions[region.definition]
    if (!d || d.wasm || !region.settings) return false
    const key =
      'culm:slow:' +
      (d.builtin || JSON.stringify([d.name, d.source, d.settings]))
    try {
      if (w.localStorage[key] === '1') return false
    } catch {
      /* denied */
    }
    keys.push(key)
    bindings.push([d.source, region.settings, d.reviewed === true])
    return true
  })
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
  let acknowledged: Stamp[] = [],
    submitted: Stamp[] = []
  // Acknowledgements identify a completed layout, not just a linked program.
  // An old scissor list cannot uncover a poster after a scroll or reflow.
  let quality: Quality = { scale: 0.25, fast: 0, slow: 0 }
  let previousDraw = new Set<string>(),
    slowWitnesses = new Set<string>()
  let px = 0,
    py = 0
  function reset(el: HTMLElement) {
    el.removeAttribute(mark)
  }
  function hide() {
    if (canvas) canvas.hidden = true
    owners.forEach(reset)
    acknowledged = []
    submitted = []
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
    main!.append(canvas)
    return surface
  }
  function frame(now: number) {
    raf = 0
    if (doc.hidden || motion.matches || (connection && connection.saveData))
      return pause()
    try {
      const { clientWidth: width, clientHeight: height } = doc.documentElement
      const cap = Math.min(
        2048 / Math.max(width, height),
        Math.sqrt(1048576 / (width * height)),
      )
      const scale = Math.min(
        cap,
        Math.min(w.devicePixelRatio, 2) * +quality.scale,
      )
      const bw = Math.floor(width * scale),
        bh = Math.floor(height * scale)
      const dw = Math.floor(width * Math.min(1, cap)),
        dh = Math.floor(height * Math.min(1, cap))
      const forms = Array.from(
        doc.querySelectorAll('form,form *,[form],input,select,textarea'),
        bounds,
      )
      const boxes = owners.map(bounds)
      const rects = owners.map((el, i) =>
        gpuRect(
          el,
          boxes[i],
          main!,
          forms,
          width,
          height,
          dw,
          dh,
          !bindings[i][2],
        ),
      )
      const paints = rects.map((r, i) => r && backdrop(owners[i], main!))
      paints.forEach((p, i) => {
        if (!p && rects[i]) rects[i] = undefined
      })
      if (!rects.some(Boolean)) {
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
      const shape: Stamp[] = paints.map((p, i) =>
        p
          ? {
              layout: [width, height, ...boxes[i]].join(),
              fallback: p.signature,
            }
          : undefined,
      )
      const dt = last ? Math.min(33, now - last) : 0
      let surface: OffscreenCanvas | undefined
      if (!watchdog) {
        if (last) {
          const interval = now - last
          // Cadence is page-wide, attribution is not. Charge each interval
          // to the preceding real draw (which has completed at this point).
          if (interval > 25) {
            if (!quality.slow) slowWitnesses = new Set(previousDraw)
            else
              for (const key of slowWitnesses)
                if (!previousDraw.has(key)) slowWitnesses.delete(key)
          }
          quality = nextQuality(quality, interval)
          if (quality.scale === 'fallback') {
            try {
              rects.forEach((r, i) => {
                if (r && slowWitnesses.has(keys[i]))
                  w.localStorage[keys[i]] = '1'
              })
            } catch {
              /* terminal in memory */
            }
            return stop()
          }
          elapsed += dt / 1000
        }
        last = now
        if (!worker && doc.body.querySelectorAll('*').length >= 2000)
          return stop()
        surface = worker ? undefined : start(dw, dh)
      }
      let path = ''
      const draws: Region[] = []
      rects.forEach((r, i) => {
        const el = owners[i]
        if (
          acknowledged[i] &&
          !matches(acknowledged[i], shape[i], el.hasAttribute(mark))
        ) {
          reset(el)
          acknowledged[i] = undefined
        }
        const live = el.hasAttribute(mark)
        if (watchdog && !matches(submitted[i], shape[i], live))
          submitted[i] = undefined
        if (!r) return
        if (!live && !watchdog && matches(acknowledged[i], shape[i], false))
          el.setAttribute(mark, '')
        const painted = el.hasAttribute(mark)
        if (painted) {
          const [l, t, right, b] = boxes[i]
          path += `M${l} ${t}H${right}V${b}H${l}Z`
        }
        const paint = paints[i]
        if (paint) draws.push([...r, i, paint.seed, painted])
      })
      canvas!.hidden = !path
      if (path) canvas!.style.clipPath = `path('${path}')`
      if (!watchdog) {
        submitted = shape
        watchdog = w.setTimeout(stop, 1500)
        worker!.postMessage(
          [
            bw,
            bh,
            draws,
            elapsed,
            surface,
            surface ? bindings : undefined,
            w.scrollY,
            px,
            py,
            dw,
            dh,
          ],
          surface ? [surface] : [],
        )
        previousDraw = new Set(draws.map(r => keys[r[4]]))
      }
      schedule()
    } catch {
      stop()
    }
  }
  function pause() {
    hide()
    last = 0
    previousDraw.clear()
    slowWitnesses.clear()
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
  w.addEventListener(
    'pointermove',
    e => {
      px = e.clientX
      py = e.clientY
    },
    { signal: events.signal },
  )
  on(doc, 'visibilitychange', () => (doc.hidden ? pause() : schedule()))
  on(motion, 'change', schedule)
  if (connection && typeof connection.addEventListener === 'function')
    on(connection, 'change', schedule)
  on(w, 'pagehide', stop)
  schedule()
}
