import { bounds, gpuRect } from './gpuCheckedGeometry.ts'
import type { Binding, Region } from './gpuWorker.ts'

declare const WORKER_SOURCE: string

export function hostGpu(
  doc: Document & { culmGpu?: boolean },
  w: Window & typeof globalThis,
): void {
  if (doc.culmGpu) return
  doc.culmGpu = true
  const main = doc.querySelector('main')
  if (!main || !w.OffscreenCanvas || !w.Worker || !w.WebGL2RenderingContext)
    return
  // Owner, remembered effect identity, immutable worker binding, last receipt.
  const rows: [HTMLElement, string, Binding, string][] = []
  let observers: (ResizeObserver | IntersectionObserver)[]
  function stored(key: string, write = false) {
    try {
      return write ? (w.localStorage[key] = '1') : w.localStorage[key] === '1'
    } catch {
      /* denied */
    }
  }
  try {
    const { definitions, regions } = JSON.parse(
      doc.querySelector<HTMLScriptElement>('#culm-gpu')!.text,
    )
    for (const el of main.querySelectorAll<HTMLElement>('[data-gpu-run]')) {
      const { definition, settings } = regions[+el.dataset.culmGpu!] || {},
        d = definitions[definition]
      if (!d || d.wasm || !settings) continue
      const key =
        'culm:slow:' +
        (d.builtin || JSON.stringify([d.name, d.source, d.settings]))
      if (!stored(key)) {
        rows.push([
          el,
          key,
          [d.source, settings, d.reviewed === true ? (d.builtin ? 2 : 1) : 0],
          '',
        ])
      }
    }
    if (!rows.length) return
    observers = [new IntersectionObserver(wake), new ResizeObserver(wake)]
  } catch {
    return
  }
  const motion = w.matchMedia('(prefers-reduced-motion: reduce)')
  const conn = (
    w.navigator as Navigator & {
      connection?: EventTarget & { saveData?: boolean }
    }
  ).connection
  const events = new AbortController(),
    signal = events.signal,
    mark = 'data-gpu-painted'
  // Positive: requested display opportunity. Negative: coalesced blocked retry.
  let raf = 0,
    pending = 0,
    time = 0,
    last = 0,
    scale = 0.25,
    streak = 0,
    point = [0, 0]
  let canvas: HTMLCanvasElement, worker: Worker
  // The final slow window can only charge an identity present in each of the
  // eight preceding submissions. All eight have completed when pending is zero.
  const history: Set<string>[] = []
  let slot = 0
  function hide(row: (typeof rows)[number]) {
    row[0].removeAttribute(mark)
    row[3] = ''
  }
  function pause() {
    if (canvas) canvas.hidden = true
    rows.forEach(hide)
    last = streak = 0
  }
  function stop() {
    if (signal.aborted) return
    events.abort()
    pause()
    if (worker) worker.terminate()
    if (canvas) canvas.remove()
    clearTimeout(pending)
    if (raf < 0) clearTimeout(-raf)
    else cancelAnimationFrame(raf)
    for (const ob of observers) ob.disconnect()
  }
  function wake() {
    if (doc.hidden) pause()
    else if (!raf && !signal.aborted) raf = w.requestAnimationFrame(frame)
  }
  function frame(now: number) {
    raf = 0
    if (signal.aborted) return
    if (doc.hidden || motion.matches || (conn && conn.saveData)) return pause()
    try {
      const { clientWidth: width, clientHeight: height } = doc.documentElement
      const { min, max } = Math,
        cap = min(
          2048 / max(width, height),
          Math.sqrt(1048576 / (width * height)),
        )
      const display = min(1, cap),
        dw = (width * display) | 0,
        dh = (height * display) | 0
      const work = min(cap, scale * min(2, w.devicePixelRatio))
      const forms = Array.from(
        doc.querySelectorAll('form,form *,[form],input,select,textarea'),
        bounds,
      )
      const draws: Region[] = []
      let path = '',
        blocked = false
      rows.forEach((row, i) => {
        const [el, , binding] = row
        const box = bounds(el),
          r = gpuRect(el, box, main!, forms, width, height, dw, dh, binding[2])
        if (!r) {
          hide(row)
          blocked ||= r !== false
          return
        }
        const [l, t, right, b] = box,
          clip = `M${l} ${t}H${right}V${b}H${l}Z`,
          shape = [width, height, ...r] + clip
        const live = el.hasAttribute(mark)
        // One outstanding draw: its receipt becomes authoritative at ACK (pending=0).
        // Until exposed, the actual fallback must match. Once live, only layout
        // is relevant. Invalidate during flight even if a later change reverts.
        const seed = shape + ';' + r.signature,
          valid = row[3] === (live ? shape : seed)
        const show = valid && (live || !pending)
        el.toggleAttribute(mark, show)
        if (!pending) row[3] = show ? shape : seed
        else if (!valid) row[3] = ''
        if (show) path += clip
        const rect: [number, number, number, number] = r
        draws.push([...rect, i, r.seed, show])
      })
      if (!draws.length) {
        pause()
        if (blocked)
          raf = -w.setTimeout(() => {
            raf = 0
            wake()
          }, 500)
        return
      }
      if (!pending) {
        // Signed streak keeps fast and slow windows consecutive across owner churn.
        const active = new Set(draws.map(r => rows[r[4]][1])),
          dt = last ? now - last : 0
        if (last) {
          streak =
            dt > 25 ? min(0, streak) - 1 : dt <= 16.7 ? max(0, streak) + 1 : 0
          if (streak === 60 || streak === -8) {
            scale = streak < 0 ? scale / 2 : min(1, scale * 2)
            streak = 0
            if (scale < 0.25) {
              for (const k of active)
                if (history.every(h => h.has(k))) stored(k, true)
              return stop()
            }
          }
        }
        history[slot++ % 8] = active
        last = now
        time += min(33, dt) / 1000
        let surface: OffscreenCanvas | undefined
        if (!worker) {
          if (doc.body.querySelectorAll('*').length >= 2000) return stop()
          canvas = doc.createElement('canvas')
          Object.assign(canvas, {
            className: 'culm-plane',
            ariaHidden: 'true',
            hidden: true,
            width: dw,
            height: dh,
          })
          surface = canvas.transferControlToOffscreen()
          const url = URL.createObjectURL(
            new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
          )
          // Worker construction resolves the Blob URL. Revoke the registration
          // on success or constructor failure; the worker owns the resolved script.
          try {
            worker = new Worker(url)
          } finally {
            URL.revokeObjectURL(url)
          }
          worker.onerror = e => {
            e.preventDefault()
            stop()
          }
          worker.onmessage = e => {
            if (e.data !== 1) return stop()
            clearTimeout(pending)
            pending = 0
          }
          main!.append(canvas)
        }
        pending = w.setTimeout(stop, 1500)
        worker.postMessage(
          [
            (width * work) | 0,
            (height * work) | 0,
            draws,
            time,
            surface,
            surface && rows.map(r => r[2]),
            w.scrollY,
            ...point,
            dw,
            dh,
          ],
          surface ? [surface] : [],
        )
      }
      canvas.hidden = !path
      if (path) canvas.style.clipPath = `path('${path}')`
      wake()
    } catch {
      stop()
    }
  }
  // A zero-area edge touch can already count as intersecting. Scroll or
  // viewport resize may expose pixels without either owner observer firing.
  for (const ob of observers) for (const [e] of rows) ob.observe(e)
  const on = (t: EventTarget, k: string, f: EventListener = wake) =>
    t.addEventListener(k, f, { signal, capture: k === 'scroll' })
  on(w, 'scroll')
  on(w, 'resize')
  on(doc, 'visibilitychange')
  on(w, 'pagehide', stop)
  on(w, 'pointermove', e => {
    point = [(e as PointerEvent).clientX, (e as PointerEvent).clientY]
  })
  on(motion, 'change')
  if (conn && typeof conn.addEventListener === 'function') on(conn, 'change')
  wake()
}
