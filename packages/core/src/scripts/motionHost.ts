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
  doc: Document,
  win: Window,
  signal?: AbortSignal,
): void {
  const d = doc as Document & { _cm?: boolean }
  const w = win as Window & typeof globalThis
  if (d._cm || signal?.aborted || !w.matchMedia || !w.IntersectionObserver)
    return
  d._cm = true
  const media = w.matchMedia('(prefers-reduced-motion:reduce)')
  const entered = new WeakSet<Element>()
  let run: AbortController | undefined
  const configure = () => {
    run?.abort()
    if (media.matches) return
    run = new w.AbortController()
    const scope = run.signal
    const on = (
      el: EventTarget,
      names: string,
      f: EventListener,
      capture?: boolean,
    ) => {
      for (const name of names.split(' '))
        el.addEventListener(name, f, { signal: scope, capture })
    }
    const cleanup = (f: () => void) => scope.addEventListener('abort', f)
    const token = (n: number) => '.cm-e' + +n
    const attr = 'data-culm-motion',
      playing = 'data-culm-playing'
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
      if (s.native && w.CSS.supports('animation-timeline:view()')) return
      const tr = s.trigger
      const pointer = tr === 'pointer-x',
        scrub = pointer || tr === 'scroll'
      const target = (id: number) =>
        id ? owner.querySelector(token(id)) : owner
      const child = target(s.child || 0)
      if (
        s.parts ||
        !owner.animate ||
        !owner.getBoundingClientRect ||
        !child ||
        (pointer && !w.matchMedia('(pointer:fine)').matches)
      )
        return
      // IO owns visibility; a load/activation before its first delivery starts paused.
      let visible = false
      let x = -Infinity
      const animations: Animation[] = []
      const stop = () => {
        for (const a of animations) a.cancel()
        animations.length = 0
        owner.removeAttribute(playing)
      }
      const play = () => {
        if (animations.length) return
        const box = child.getBoundingClientRect()
        if (!box.width || !box.height) return
        const pinBox = owner as HTMLElement
        const needed = s.pin && pinBox.offsetHeight + s.pin
        owner.setAttribute(playing, '')
        const origin = doc.timeline.currentTime
        for (const [refs, frames, timing, reveal] of s.tracks)
          for (const [id, delay] of refs) {
            const el = target(id)
            if (!el) continue
            timing.delay = delay
            let keys =
              reveal && w.CSS.supports('animation-timeline:scroll()')
                ? reveal
                : frames
            if ('strokeDashoffset' in keys[0]) {
              const path = el as SVGPathElement
              const length =
                path.getTotalLength &&
                (path.pathLength.baseVal || path.getTotalLength())
              if (!length) continue
              keys = keys.map(f =>
                Object.assign({}, f, {
                  strokeDasharray: length,
                  strokeDashoffset: Number(f.strokeDashoffset) * length,
                }),
              )
            }
            const a = el.animate(keys, timing)
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
          const minHeight = `${needed}px`
          animations.push(
            owner.animate([{ minHeight }, { minHeight }], { fill: 'both' }),
          )
        }
      }
      cleanup(stop)
      const sample = () => {
        if (!visible) readers.delete(sample)
        const r = owner.getBoundingClientRect(),
          h = w.innerHeight
        if (!r.width || !r.height || (s.pin && !child.getClientRects().length))
          return stop()
        play()
        const progress = pointer
          ? (x - r.left) / r.width
          : s.pin
            ? -r.top / s.pin
            : (h - r.top) / (h + r.height)
        const time = s.duration * Math.min(1, Math.max(0, progress))
        for (const a of animations) a.currentTime = time
      }
      const entrance = tr === 'enter-view'
      if (entrance && entered.has(owner)) {
        play()
        for (const a of animations) a.finish()
        return
      }
      let intersecting = false
      const syncView = () => {
        visible = intersecting && !doc.hidden
        if (scrub) {
          if (!doc.hidden) sample() // settle even on the transition out of view
          readers[visible ? 'add' : 'delete'](sample)
        } else {
          if (visible && (entrance || tr === 'load')) {
            play()
            if (entrance && animations.length) entered.add(owner)
          }
          for (const a of animations) {
            if (a.playState === (visible ? 'paused' : 'running'))
              a[visible ? 'play' : 'pause']()
          }
        }
      }
      const observer = new w.IntersectionObserver(entries => {
        if (scope.aborted) return
        intersecting = entries[entries.length - 1].isIntersecting
        syncView()
      })
      observer.observe(owner)
      cleanup(() => observer.disconnect())
      on(doc, 'visibilitychange', syncView)
      if (scrub) {
        inputs = true
        if (s.pin)
          on(w, 'resize', () => {
            // Offscreen pins also determine the flow position of later scenes.
            stop()
            readers.add(sample)
            schedule()
          })
        if (pointer)
          on(owner, 'pointermove', e => {
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
        type Input = KeyboardEvent | PointerEvent
        const id = (e: Input) => ('key' in e ? e.code || e.key : e.pointerId)
        on(owner, 'pointerdown keydown', event => {
          const e = event as Input
          if (
            'key' in e
              ? !e.repeat && ['Enter', ' '].includes(e.key)
              : e.button === 0
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
        observer.observe(holder, { attributes: true, attributeFilter: [attr] })
        cleanup(() => observer.disconnect())
        sync()
      }
    })
    if (inputs) {
      cleanup(cancel)
      on(doc, 'visibilitychange', cancel)
      on(w, 'scroll resize', schedule, true)
    }
  }
  media.addEventListener('change', configure, { signal })
  signal?.addEventListener(
    'abort',
    () => {
      run?.abort()
      delete d._cm
    },
    { once: true },
  )
  configure()
}
