/** Fixed tracks share their keyframes across equal targets (the common stagger
 * case). Token 0 is the owner; other numeric tokens select inside it only. */
export type PackedTrack = [
  instances: [token: number, startMs: number][],
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  revealFrames?: Keyframe[],
]
export type Scene = {
  trigger:
    | 'load'
    | 'enter-view'
    | 'hover'
    | 'press'
    | 'scroll'
    | 'pointer-x'
    | [holder: number, attribute: string, value: string]
  duration: number
  tracks: PackedTrack[]
  native?: true
  pin?: number
  /** The actual visual child; its additive travel and flow spacing are packed tracks. */
  child?: number
  layout?: true
  basis?: number
  /** Direct SVG geometry tokens needing normalized dashes during enhancement. */
  draw?: number[]
  /** A measured text group count determines the clock origins of later blocks. */
  parts?: {
    unit?: 'words' | 'lines' | 'letters'
    tracks: PackedTrack[]
    delay: number
    duration: number
    stagger?: number
    mask?: true
  }[]
}

export function hostMotion(
  doc: Document & { _cm?: boolean },
  win: Window,
  signal?: AbortSignal,
): void {
  const w = win as Window & typeof globalThis
  if (
    doc._cm ||
    (signal && signal.aborted) ||
    !w.matchMedia ||
    !w.IntersectionObserver
  )
    return
  doc._cm = true
  const abort = (scope: AbortSignal | undefined, f: () => void) =>
    scope && scope.addEventListener('abort', f)
  const listen =
    (scope?: AbortSignal) =>
    (el: EventTarget, names: string, f: EventListener, capture?: boolean) => {
      for (const name of names.split(' '))
        el.addEventListener(name, f, { signal: scope, capture })
    }
  const on = listen(signal)
  const token = (n: number) => '.cm-e' + +n
  const clock = (name: string) => w.CSS.supports(`animation-timeline:${name}()`)
  const rect = (el: Element) => el.getBoundingClientRect()
  const attr = 'data-culm-motion'
  const readers = new Set<() => void>()
  let inputs = false
  let frame = 0
  const cancel = () => {
    if (frame) w.cancelAnimationFrame(frame)
    frame = 0
  }
  const schedule = () => {
    if (!frame && readers.size && !doc.hidden)
      frame = w.requestAnimationFrame(() => {
        frame = 0
        readers.forEach(read => read())
      })
  }
  doc.querySelectorAll(`[${attr}]`).forEach(owner => {
    const s: Scene = JSON.parse(owner.getAttribute(attr)!)
    if (s.native && clock('view')) return
    const { trigger: tr, pin, layout } = s
    const pointer = tr === 'pointer-x',
      scrub = pointer || tr === 'scroll'
    const target = (id: number) => (id ? owner.querySelector(token(id)) : owner)
    const child = target(s.child || 0)
    if (s.parts || !owner.animate || !owner.getBoundingClientRect || !child)
      return
    const readInput = scrub || layout
    inputs ||= !!readInput
    let entered = false
    const mount = (scope: AbortSignal) => {
      const on = listen(scope)
      // IO owns visibility; a load/activation before its first delivery starts paused.
      let visible = false
      let x = -Infinity
      const animations: Animation[] = []
      const shifts: KeyframeEffect[] = []
      const project = (el: Element | null) =>
        shifts.forEach(fx => {
          fx.target = el
        })
      const marked = (value: boolean) =>
        owner.toggleAttribute('data-cm-on', value)
      const stop = () => {
        animations.forEach(a => a.cancel())
        animations.length = 0
        shifts.length = 0
        marked(false)
      }
      const play = () => {
        if (animations.length) return
        const box = rect(child)
        if (!(box.width * box.height)) return
        const pinBox = owner as HTMLElement
        let needed = 0
        const hold = (f: Keyframe) =>
          animations.push(owner.animate([f, f], { fill: 'both' }))
        if (pin) {
          let m
          try {
            m = (target(s.basis!) as SVGSVGElement).getScreenCTM()!.inverse()
          } catch {
            return
          } // absent or singular geometry cannot be pinned
          const y = pin * m.d
          if (!isFinite(y)) return
          needed = pinBox.offsetHeight + y
          const name = '--p' + s.child
          hold({ [name]: `${pin * m.c}px ${y}px`, [name + 'y']: y + 'px' })
        }
        marked(true)
        const origin = doc.timeline.currentTime
        for (const [refs, frames, timing, reveal] of s.tracks)
          for (const [id, delay] of refs) {
            const el = target(id)
            if (!el) continue
            timing.delay = delay
            const keys = reveal && clock('scroll') ? reveal : frames
            if ('strokeDashoffset' in keys[0]) {
              const path = el as SVGPathElement
              const length =
                path.getTotalLength &&
                (path.pathLength.baseVal || path.getTotalLength())
              if (!length) continue
              for (const f of keys) f['--cm-length'] = length + 'px'
            }
            const a = el.animate(keys, timing)
            if (!id && timing.id) shifts.push(a.effect as KeyframeEffect)
            // No per-target callbacks/timers: every delay is on the same clock.
            if (origin !== null) a.startTime = origin
            // A later filled activation must not auto-remove the earlier one:
            // deactivating it reveals the original endpoint again.
            if (a.persist) a.persist()
            if (scrub || !visible) a.pause()
            animations.push(a)
          }
        // Additive padding extends an auto-sized owner (including its clip).
        // An explicit border-box height may absorb the padding instead.
        if (needed && pinBox.offsetHeight < needed) {
          hold({ minHeight: needed + 'px' })
        }
      }
      abort(scope, stop)
      const entrance = tr === 'enter-view'
      if (entered) {
        play()
        animations.forEach(a => a.finish())
        return
      }
      let intersecting = false
      const syncView = () => {
        visible = intersecting && !doc.hidden
        if (readInput) {
          let watching = false
          if (!doc.hidden) {
            // The layout reference is the original box without this scene's
            // geometry effects. Never replace, wrap or reparent a control.
            project(null)
            const r = rect(owner),
              h = w.innerHeight
            if (shifts.length) {
              // Intersect the unanimated subject with the *real* clipping
              // ancestors. A scrollport can hide a link still inside the window.
              const axis = (
                lo: 'top' | 'left',
                hi: 'bottom' | 'right',
                overflow: 'overflowX' | 'overflowY',
                end: number,
              ) => {
                let a = Math.max(0, r[lo]),
                  b = Math.min(end, r[hi])
                for (
                  let n = owner.parentElement;
                  n && a <= b;
                  n = n.parentElement
                ) {
                  if (w.getComputedStyle(n)[overflow] === 'visible') continue
                  const clip = rect(n)
                  a = Math.max(a, clip[lo])
                  b = Math.min(b, clip[hi])
                }
                return a <= b
              }
              visible =
                axis('top', 'bottom', 'overflowY', h) &&
                axis('left', 'right', 'overflowX', w.innerWidth)
            }
            if (scrub) {
              if (
                !(r.width * r.height) ||
                (pin && !child.getClientRects().length)
              )
                stop()
              else {
                play()
                const p = pointer
                  ? (x - r.left) / r.width
                  : pin
                    ? -r.top / pin
                    : (h - r.top) / (h + r.height)
                const time = s.duration * Math.min(1, Math.max(0, p))
                for (const a of animations) a.currentTime = time
              }
            }
            // Once *both* boxes have left, IO observes the stable layout box.
            // It wakes us on real re-entry, without offscreen frame requests.
            watching = visible || intersecting
            project(watching ? owner : null)
          }
          readers[watching ? 'add' : 'delete'](syncView)
          if (scrub) return
        }
        if (visible && (entrance || tr === 'load')) {
          play()
          if (entrance && animations.length) entered = true
        }
        for (const a of animations)
          if (a.playState === (visible ? 'paused' : 'running'))
            a[visible ? 'play' : 'pause']()
      }
      const observer = new w.IntersectionObserver(entries => {
        if (scope.aborted) return
        intersecting = entries[entries.length - 1].isIntersecting
        syncView()
      })
      observer.observe(owner)
      abort(scope, () => {
        observer.disconnect()
        readers.delete(syncView)
        if (!readers.size) cancel()
      })
      on(doc, 'visibilitychange', syncView)
      if (scrub) {
        if (pin)
          on(w, 'resize', () => {
            // Offscreen pins also determine the flow position of later scenes.
            stop()
            readers.add(syncView)
            schedule()
          })
        if (pointer)
          on(owner, 'pointermove', e => {
            if ((e as PointerEvent).pointerType === 'touch') return
            x = (e as PointerEvent).clientX
            if (visible) schedule()
          })
        syncView()
      } else if (tr === 'load') play()
      else if (tr === 'hover') {
        const sync = () =>
          owner.matches(':hover,:focus-visible') ? play() : stop()
        on(owner, 'mouseenter mouseleave focus blur', sync)
        sync()
      } else if (tr === 'press') {
        // A key and several contacts can hold the same owner. Pointer releases
        // arrive on window, so match the actual contact before stopping it.
        const held = new Set<string | number>()
        type Input = KeyboardEvent & PointerEvent
        const id = (e: Input) => e.code || e.key || e.pointerId
        on(owner, 'pointerdown keydown', event => {
          const e = event as Input
          if (
            e.key ? !e.repeat && ['Enter', ' '].includes(e.key) : e.button === 0
          ) {
            held.add(id(e))
            play()
          }
        })
        const up = (e: Event) => {
          if (held.delete(id(e as Input)) && !held.size) stop()
        }
        const blur = (e: Event) => {
          if (
            e.currentTarget === owner &&
            owner.contains((e as FocusEvent).relatedTarget as Node | null)
          )
            return
          held.clear()
          stop()
        }
        on(owner, 'keyup', up)
        on(w, 'pointerup pointercancel', up)
        on(owner, 'blur', blur, true)
        on(w, 'blur', blur)
      } else if (Array.isArray(tr) && w.MutationObserver) {
        const [id, attr, value] = tr
        const holder = owner.closest(token(id))
        if (!holder) return
        const sync = () =>
          holder.getAttribute(attr) === value ? play() : stop()
        const observer = new w.MutationObserver(sync)
        observer.observe(holder, { attributeFilter: [attr] })
        abort(scope, () => observer.disconnect())
        sync()
      }
    }
    const media = w.matchMedia(
      '(prefers-reduced-motion:no-preference)' +
        (pointer ? ' and (pointer:fine)' : ''),
    )
    let run: AbortController | undefined
    const clear = () => {
      if (run) run.abort()
    }
    const configure = () => {
      clear()
      if (media.matches) {
        run = new w.AbortController()
        mount(run.signal)
      }
    }
    on(media, 'change', configure)
    abort(signal, clear)
    configure()
  })
  if (inputs) {
    abort(signal, cancel)
    on(doc, 'visibilitychange', cancel)
    on(w, 'scroll resize', schedule, true)
  }
  abort(signal, () => delete doc._cm)
}
