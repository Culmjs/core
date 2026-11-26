import { type Region } from './worker.ts'
import { type EffectName } from './shaders.ts'

declare const WORKER_SOURCE: string

function start() {
  const main = document.querySelector('main')!
  const canvas = document.createElement('canvas')
  const url = URL.createObjectURL(
    new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
  )
  const worker = new Worker(url)
  URL.revokeObjectURL(url)
  let stopped = false,
    slow = 0,
    last = 0
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    worker.terminate()
    main.classList.remove('gpu-active')
    canvas.remove()
    window.removeEventListener('pagehide', stop)
    window.removeEventListener('resize', stop)
    window.removeEventListener('scroll', stop)
  }
  // Outside the worker: also fires when the driver call never returns.
  const timer = setTimeout(stop, 1500)
  try {
    canvas.width = Math.ceil(innerWidth / 4)
    canvas.height = Math.ceil(innerHeight / 4)
    canvas.setAttribute('aria-hidden', 'true')
    main.prepend(canvas)
    const regions: Region[] = []
    for (const el of main.querySelectorAll<HTMLElement>('[data-field]')) {
      const r = el.getBoundingClientRect()
      const x = Math.floor(r.left / 4),
        y = Math.floor((innerHeight - r.bottom) / 4)
      if (r.bottom > 0 && r.top < innerHeight)
        regions.push([
          el.dataset.field as EffectName,
          x,
          y,
          Math.ceil(r.width / 4),
          Math.ceil(r.height / 4),
        ])
    }
    const display = canvas.transferControlToOffscreen()
    const payload = JSON.parse(document.getElementById('fields')!.textContent!)
    worker.onerror = stop
    worker.onmessage = e => {
      clearTimeout(timer)
      if (!e.data || stopped) return stop()
      main.classList.add('gpu-active')
      requestAnimationFrame(t => {
        if (stopped) return
        const ms = last ? t - last : 1000 / 60
        last = t
        slow = ms > 100 ? slow + 1 : 0
        if (slow >= 6) return stop()
        worker.postMessage({ regions, ms: Math.min(33, ms) })
      })
    }
    for (const event of ['pagehide', 'resize', 'scroll'])
      window.addEventListener(event, stop)
    worker.postMessage({ canvas: display, payload, regions, ms: 1000 / 60 }, [
      display,
    ])
  } catch {
    stop()
  }
}
start()
