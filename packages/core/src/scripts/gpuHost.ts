import type { Binding, Region } from './gpuWorker.ts'

type Box = [number, number, number, number]
type Row = [HTMLElement, string, Binding, string, number?]
declare const WORKER_SOURCE: string

const { min, max } = Math
const box = (r: DOMRect): Box => [r.left, r.top, r.right, r.bottom]
const bounds = (e: Element) => box(e.getBoundingClientRect())
const cut = (
  a: Box,
  b: Box,
  c = a.map((v, i) => (i < 2 ? max : min)(v, b[i])) as Box,
) => c[0] < c[2] && c[1] < c[3] && c
const codes: Record<string, string> = {
  a: 'auto',
  n: 'normal',
  v: 'visible',
  0: '0px',
  t: 'rgba(0, 0, 0, 0)',
}
const [composite, ancestor, stacked, shadow, paintedBg, bdr] =
  'mixBlendMode:n filter backdropFilter transform|opacity:1 visibility:v contentVisibility:v willChange:a borderRadius:0 translate scale rotate perspective clipPath maskImage contain offsetPath|isolation:a zIndex:a containerType:n|boxShadow textShadow|backgroundColor:t backgroundImage|borderWidth:0'
    .split('|')
    .map(spec => {
      const pairs = spec.split(' ').map(p => p.split(':'))
      return (s: CSSStyleDeclaration) =>
        pairs.some(
          ([k, v]) =>
            s[k as keyof CSSStyleDeclaration] !== (codes[v] || v || 'none'),
        )
    })
const order = (s: CSSStyleDeclaration) => s.position + ' ' + s.zIndex
const promoted = 'relative 1'

export function hostGpu(
  doc: Document & { culmGpu?: number },
  w: Window & typeof globalThis,
): void {
  const main = doc.querySelector('main')
  if (
    doc.culmGpu ||
    !(doc.culmGpu = 1) ||
    !main ||
    !w.OffscreenCanvas ||
    !Worker ||
    !w.WebGL2RenderingContext
  )
    return
  let obs: (IntersectionObserver | ResizeObserver)[], dead: number | undefined
  const rows: Row[] = [],
    stored = (k: string, v?: 1) => {
      try {
        const s = localStorage
        return v ? (s[k] = '1') : +s[k]
      } catch {
        /* denied */
      }
    }
  const events = new AbortController(),
    signal = events.signal
  const on = (
    t: EventTarget | undefined,
    k = 'change',
    f: EventListener = wake,
    capture?: boolean | number,
  ) =>
    t &&
    t.addEventListener &&
    k
      .split(' ')
      .map(n => t.addEventListener(n, f, { signal, capture: !!capture }))
  try {
    const J = JSON.parse(
      doc.querySelector<HTMLScriptElement>('#culm-gpu')!.text,
    )
    for (const el of main.querySelectorAll<HTMLElement>('[data-gpu-run]')) {
      const reg = J.regions[+el.dataset.culmGpu!],
        d = reg && J.definitions[reg.definition],
        s = reg && reg.settings
      if (!d || !s) continue
      const key = 'culm:slow:' + (d.builtin || JSON.stringify(d))
      if (!stored(key))
        rows.push([
          el,
          key,
          [
            d.source,
            s,
            d.reviewed === true ? (d.builtin ? 2 : 1) : 0,
            (d.wasm || 0).bytesBase64,
          ],
          '',
        ])
    }
    if (!rows.length) return
    obs = [w.IntersectionObserver, w.ResizeObserver].map(O => {
      const ob = new O(wake)
      rows.map(r => ob.observe(r[0]))
      return ob
    })
  } catch {
    return
  }
  const motion = w.matchMedia('(prefers-reduced-motion: reduce)'),
    conn = (
      w.navigator as Navigator & {
        connection?: EventTarget & { saveData?: boolean }
      }
    ).connection,
    range = doc.createRange()
  const sample = ([l, t, r, b]: Box, x = 0.5, y = 0.5) =>
    doc.elementFromPoint(l + (r - l) * x, t + (b - t) * y)
  let raf = 0,
    pending = 0,
    time = 0,
    last = 0,
    scale = 0.25,
    streak = 0,
    point = [0, 0],
    slot = 0
  let canvas: HTMLCanvasElement, worker: Worker
  const history: string[][] = []
  const hide = (r: Row) => (
    r[0].toggleAttribute('data-gpu-painted', false),
    (r[3] = '')
  )
  function pause() {
    if (canvas) canvas.hidden = true
    rows.map(hide)
    last = streak = 0
  }
  function stop() {
    if (dead || !(dead = 1)) return
    events.abort()
    pause()
    if (worker) worker.terminate()
    if (canvas) canvas.remove()
    clearTimeout(pending)
    obs.map(o => o.disconnect())
    if (raf < 0) clearTimeout(-raf)
    else cancelAnimationFrame(raf)
  }
  function wake() {
    if (doc.hidden) pause()
    else if (!raf && !dead) raf = requestAnimationFrame(frame)
  }
  function backdrop(
    el: HTMLElement,
    vis: Box,
    clip: Box,
    builtin: boolean,
    live: boolean,
  ): [string, number[]] | undefined {
    const own = getComputedStyle(el)
    if (bdr(own)) {
      if (!builtin) return
      'Left Top Right Bottom'
        .split(' ')
        .map(
          (k, j) =>
            (clip[j] +=
              (j < 2 ? 1 : -1) *
              parseFloat(
                own[
                  ('border' + k + 'Width') as keyof CSSStyleDeclaration
                ] as string,
              )),
        )
      if (!(vis = cut(vis, clip) as Box)) return
    }
    const F = [0.01, 0.5, 0.99]
    if (!F.some(px => F.some(py => sample(vis, px, py) === el))) return
    const color = own.backgroundColor
    let opaque: number | undefined
    const rgb =
      /^(border|padding)-box$/.test(own.backgroundClip) &&
      /^rgb\(/.test(color) &&
      (opaque = 1) &&
      own.backgroundImage === 'none' &&
      color.match(/\d+/g)
    const seed = rgb ? [...rgb.map(v => +v / 255), 1] : [0, 0, 0, 0]
    let sig = rgb ? color : own.background,
      inside = 1
    for (let n: Element | null = el, p: Element | null; n; n = p) {
      const s = getComputedStyle(n)
      p = n.parentElement
      if (n !== el) {
        if (inside && !opaque) sig += ';' + s.background
        if (
          s.overflow !== codes.v &&
          (bdr(s) || cut(vis, bounds(n)) + '' != vis + '')
        )
          return
      }
      if (n === main) inside = 0
      if (
        composite(s) ||
        ancestor(s) ||
        (inside &&
          (stacked(s) ||
            /^(sticky|fixed)$/.test(s.position) ||
            (n !== el && paintedBg(s))))
      )
        return
      for (const peer of p ? p.children : [])
        if (peer !== n && peer !== canvas && cut(vis, bounds(peer))) return
    }
    if (inside) return
    if (builtin)
      for (const n of el.querySelectorAll('*')) {
        const s = getComputedStyle(n)
        n.toggleAttribute(
          'data-gpu-r',
          +s.zIndex > 1 && s.position !== 'static',
        )
      }
    const inScope = (n: Element) =>
      n === el || (builtin && n.querySelector('[data-gpu-r]'))
    const groups = new Map<Element, [Box, boolean, boolean]>(),
      kids: CSSStyleDeclaration[] = []
    let witness: boolean | undefined, node: Node | null
    const walk = doc.createNodeIterator(el, 5)
    while ((node = walk.nextNode())) {
      const text = node.nodeType === 3,
        n = text ? node.parentElement! : (node as HTMLElement)
      if (text) {
        if (!node.textContent!.trim()) continue
        if (inScope(n)) return
      } else {
        const s = getComputedStyle(n),
          carrier = n !== el && inScope(n)
        if (
          composite(s) ||
          ((!builtin || n === el || carrier) && shadow(s)) ||
          s.display === 'contents' ||
          n.matches('canvas,video,iframe,object,embed') ||
          [':before', ':after'].some(
            p => !/^(none|normal)$/.test(getComputedStyle(n, p).content),
          )
        )
          return
        if (n === el) continue
        const parent = n.parentElement!,
          lifted = builtin && n.hasAttribute('data-gpu-r')
        if (
          carrier &&
          (lifted ||
            ancestor(s) ||
            stacked(s) ||
            paintedBg(s) ||
            bdr(s) ||
            s.outlineStyle !== 'none')
        )
          return
        const direct = inScope(parent) && !carrier && !lifted
        if (direct) {
          if (s.inset !== codes.a && s.inset !== codes[0]) return
          if (!live) kids.push(s)
          const nb = bounds(n)
          if (cut(nb, nb)) {
            const prev = groups.get(parent),
              hz = !prev || (prev[1] && nb[0] >= prev[0][2]),
              vt = !prev || (prev[2] && nb[1] >= prev[0][3])
            if (!hz && !vt) return
            groups.set(parent, [nb, hz, vt])
          }
        }
        if (
          !lifted &&
          (live && direct
            ? order(s) !== promoted
            : !/^(relative|static) auto$/.test(order(s)))
        )
          return
      }
      const kind = n.getAttribute('data-gpu-content')
      if (
        !witness &&
        (text ? kind : kind === '' && (n as HTMLImageElement).naturalWidth) &&
        n.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      ) {
        if (text) range.selectNodeContents(node)
        witness = (
          text ? Array.from(range.getClientRects(), box) : [bounds(n)]
        ).some(r => {
          const cb = cut(vis, r)
          return cb && n.contains(sample(cb))
        })
      }
    }
    if (!witness) return
    if (!live) {
      el.toggleAttribute('data-gpu-p', true)
      const ok = kids.every(s => order(s) === promoted)
      el.toggleAttribute('data-gpu-p', false)
      if (!ok) return
    }
    return [sig, seed]
  }
  function frame(now: number) {
    raf = 0
    if (dead) return
    if (doc.hidden || motion.matches || (conn && conn.saveData)) return pause()
    try {
      const de = doc.documentElement,
        W = de.clientWidth,
        H = de.clientHeight
      const cap = 2048 / max(W, H, (4 * W * H) ** 0.5),
        disp = min(1, cap)
      const dw = (W * disp) | 0,
        dh = (H * disp) | 0,
        work = min(cap, scale * min(2, w.devicePixelRatio))
      const forms = Array.from(
          doc.querySelectorAll('form,form *,[form],input,select,textarea'),
          bounds,
        ),
        draws: Region[] = [],
        active: string[] = []
      let path = '',
        blocked = 0
      rows.map((row, i) => {
        if (row[4]) return
        const [el, id, binding] = row,
          mode = binding[2],
          b = bounds(el),
          vis = cut(b, [0, 0, W, H]),
          live = el.hasAttribute('data-gpu-painted')
        if (!vis) return hide(row)
        const sc = (v: number, k: number) => v * (k % 2 ? dh / H : dw / W)
        const [x, y, R2, T] = [b[0], H - b[3], b[2], H - b[1]].map((v, k) =>
          (k < 2 ? Math.ceil : Math.floor)(sc(v, k)),
        )
        const ok =
          !forms.some(f => cut(f, vis)) &&
          (mode || !vis.some((v, k) => sc(v, k) % 1)) &&
          cut([x, y, R2, T], [0, 0, dw, dh]) &&
          backdrop(el, vis, b, mode === 2, live)
        if (!ok) return (hide(row), (blocked = 1))
        const clip = `M${b[0]} ${b[1]}H${b[2]}V${b[3]}H${b[0]}Z`
        const shape = [W, H, x, y, R2, T] + clip,
          full = shape + ';' + ok[0],
          valid = row[3] === (live ? shape : full)
        const show = valid && (live || !pending)
        el.toggleAttribute('data-gpu-painted', show)
        row[3] = pending ? (valid ? row[3] : '') : show ? shape : full
        if (show) path += clip
        active.push(id)
        draws.push([x, y, R2 - x, T - y, i, ok[1], show])
      })
      if (!draws.length)
        return (
          pause(),
          void (
            blocked &&
            (raf = -(setTimeout as typeof w.setTimeout)(
              () => ((raf = 0), wake()),
              500,
            ))
          )
        )
      if (!pending) {
        const dt = last ? now - last : 0
        if (last) {
          streak =
            dt > 25 ? min(0, streak) - 1 : dt <= 16.7 ? max(0, streak) + 1 : 0
          if (streak === 60 || streak === -8) {
            scale = min(1, scale * (streak < 0 ? 0.5 : 2))
            streak = 0
            if (scale < 0.25) {
              if (history[7])
                active.map(
                  k => history.every(h => h.includes(k)) && stored(k, 1),
                )
              return stop()
            }
          }
        }
        history[slot++ & 7] = active
        last = now
        time += min(33, dt) / 1000
        let surface: OffscreenCanvas | undefined
        if (!worker) {
          if (doc.body.querySelectorAll('*').length >= 2000) return stop()
          canvas = Object.assign(doc.createElement('canvas'), {
            className: 'culm-plane',
            ariaHidden: 'true',
            hidden: true,
          })
          surface = canvas.transferControlToOffscreen()
          const url = URL.createObjectURL(
            new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
          )
          try {
            worker = new Worker(url)
          } finally {
            URL.revokeObjectURL(url)
          }
          worker.onerror = e => (e.preventDefault(), stop())
          worker.onmessage = e => {
            const d = e.data
            if (d !== 1) {
              if (!d.map) return stop()
              d.map(
                (idx: number) =>
                  rows[idx] && (hide(rows[idx]), (rows[idx][4] = 1)),
              )
              if (rows.every(r => r[4])) stop()
              else wake()
            }
            clearTimeout(pending)
            pending = 0
          }
          main!.append(canvas)
        }
        pending = (setTimeout as typeof w.setTimeout)(stop, 1500)
        worker.postMessage(
          [
            (W * work) | 0,
            (H * work) | 0,
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
  on(w, 'scroll resize', wake, 1)
  on(w, 'pagehide', stop)
  on(
    w,
    'pointermove',
    e => (point = [(e as PointerEvent).clientX, (e as PointerEvent).clientY]),
  )
  on(doc, 'visibilitychange')
  ;[motion, conn].map(t => on(t))
  wake()
}
