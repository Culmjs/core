import { bounds, gpuRect } from './gpuGeometry.ts'
import { nextQuality, type Quality } from './gpuQuality.ts'
import type { Binding, Region } from './gpuWorker.ts'

declare const WORKER_SOURCE: string

export function hostGpu(doc: Document, win: Window): void {
  const w = win as Window & typeof globalThis
  const page = doc as Document & { culmGpu?: true }
  if (page.culmGpu) return
  page.culmGpu = true
  const main = doc.querySelector('main')
  if (!main) return
  const { definitions, regions } = JSON.parse(
    doc.getElementById('culm-gpu')!.textContent!,
  )
  const keys: string[] = [],
    bindings: Binding[] = []
  const owners = Array.from(
    main.querySelectorAll<HTMLElement>('[data-gpu-run]'),
  ).filter(el => {
    const region = regions[+el.dataset.culmGpu!],
      d = definitions[region.definition]
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
  let acknowledged: string[] = [],
    submitted: string[] = []
  // Acknowledgements identify a completed layout, not just a linked program.
  // An old scissor list cannot uncover a poster after a scroll or reflow.
  let quality: Quality = { scale: 0.25, fast: 0, slow: 0 }
  const seeds: number[][] = [],
    fade: number[] = []
  let px = 0,
    py = 0
  function reset(el: HTMLElement, i: number) {
    el.removeAttribute(mark)
    el.style.removeProperty('--culm-veil')
    fade[i] = 0
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
      const boxes = owners.map(bounds)
      const rects = owners.map((el, i) =>
        gpuRect(
          el,
          boxes[i],
          main!,
          forms,
          width,
          height,
          bw,
          bh,
          !bindings[i][2],
        ),
      )
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
      // A backing-scale change with the same layout keeps the displayed atlas;
      // sample it at the new owner's UV. Actual layout changes re-enter via fallback.
      const shape = rects.map((r, i) =>
        r ? [width, height, ...boxes[i]].join() : '',
      )
      const dt = last ? Math.min(33, now - last) : 0
      let surface: OffscreenCanvas | undefined
      if (!watchdog) {
        if (last) {
          quality = nextQuality(quality, now - last)
          if (quality.scale === 'fallback') {
            try {
              rects.forEach((r, i) => {
                if (r) w.localStorage[keys[i]] = '1'
              })
            } catch {
              /* terminal in memory */
            }
            return stop()
          }
          elapsed += dt / 1000
        }
        last = now
        submitted = shape
        if (!worker && doc.body.querySelectorAll('*').length >= 2000)
          return stop()
        surface = worker ? undefined : start(bw, bh)
      }
      let path = ''
      const draws: Region[] = []
      rects.forEach((r, i) => {
        const el = owners[i]
        if (acknowledged[i] && acknowledged[i] !== shape[i]) {
          reset(el, i)
          acknowledged[i] = ''
        }
        if (!r) return
        let ready = acknowledged[i] === shape[i]
        if (!watchdog && !el.hasAttribute(mark)) {
          // Resolve the actual exposed flat CSS colour. For an image or other
          // nonuniform paint, veil the authored background toward black first.
          let seed: number[] | undefined
          for (let n: Element | null = el; n; n = n.parentElement) {
            const s = getComputedStyle(n)
            if (s.backgroundImage !== 'none') break
            if (s.backgroundColor === 'rgba(0, 0, 0, 0)') continue
            if (/^rgb\(/.test(s.backgroundColor))
              seed = s.backgroundColor.match(/\d+/g)!.map(c => +c / 255)
            break
          }
          seeds[i] = seed || [0, 0, 0]
          if (ready && !bindings[i][2] && !seed) {
            const s = getComputedStyle(el)
            if (s.borderWidth !== '0px' || (!fade[i] && s.boxShadow !== 'none'))
              return
            if ((fade[i] || 0) < 1) {
              fade[i] = Math.min(1, (fade[i] || 0) + dt / 9200)
              el.style.setProperty('--culm-veil', String(fade[i]))
              ready = false
            }
          }
          if (ready) el.setAttribute(mark, '')
        }
        const painted = el.hasAttribute(mark)
        if (painted) {
          const [l, t, right, b] = boxes[i]
          path += `M${l} ${t}H${right}V${b}H${l}Z`
        }
        draws.push([...r, i, seeds[i], painted])
      })
      canvas!.hidden = !path
      if (path) canvas!.style.clipPath = `path('${path}')`
      if (!watchdog) {
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
          ],
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
