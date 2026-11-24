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
  if (d._cm || signal?.aborted || !w.matchMedia) return
  d._cm = true
  const media = w.matchMedia('(prefers-reduced-motion:reduce)')
  const entered = new WeakSet<Element>()
  let run: AbortController | undefined
  const configure = () => {
    run?.abort()
    if (media.matches) return
    run = new w.AbortController()
    const options = { signal: run.signal }
    const cleanup = (f: () => void) =>
      options.signal.addEventListener('abort', f)
    const token = (n: number) => '.cm-e' + +n
    doc.querySelectorAll('[data-culm-motion]').forEach(owner => {
      const s: Scene = JSON.parse(owner.getAttribute('data-culm-motion')!)
      if (s.native && w.CSS.supports('animation-timeline:view()')) return
      const tr = s.trigger
      // These clocks and geometry-dependent targets are prepared by the next
      // runtime stages. Do not accidentally start them as timed load entrances.
      if (
        s.parts ||
        s.draw ||
        tr === 'scroll' ||
        tr === 'pointer-x' ||
        !owner.animate
      )
        return
      const animations: Animation[] = []
      const stop = () => {
        for (const a of animations) a.cancel()
        animations.length = 0
        owner.removeAttribute('data-culm-playing')
      }
      const play = () => {
        if (animations.length) return
        owner.setAttribute('data-culm-playing', '')
        const origin = doc.timeline.currentTime
        for (const [refs, frames, timing, reveal] of s.tracks)
          for (const [id, delay] of refs) {
            const el = id ? owner.querySelector(token(id)) : owner
            if (!el) continue
            timing.delay = delay
            const a = el.animate(
              reveal && w.CSS.supports('animation-timeline:scroll()')
                ? reveal
                : frames,
              timing,
            )
            // No per-target callbacks/timers: every delay is on the same clock.
            if (origin !== null) a.startTime = origin
            // A later filled activation must not auto-remove the earlier one:
            // deactivating it reveals the original endpoint again.
            a.persist?.()
            animations.push(a)
          }
      }
      cleanup(stop)
      const on = (el: EventTarget, name: string, f: EventListener) =>
        el.addEventListener(name, f, options)
      if (tr === 'load') play()
      else if (tr === 'enter-view' && w.IntersectionObserver) {
        if (entered.has(owner)) {
          play()
          for (const a of animations) a.finish()
          return
        }
        const observer = new w.IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting) && !options.signal.aborted) {
            observer.disconnect()
            entered.add(owner)
            play()
          }
        })
        observer.observe(owner)
        cleanup(() => observer.disconnect())
      } else if (tr === 'hover') {
        const sync = () =>
          owner.matches(':hover,:focus-visible') ? play() : stop()
        for (const ev of ['mouseenter', 'mouseleave', 'focus', 'blur'])
          on(owner, ev, sync)
        sync()
      } else if (tr === 'press') {
        on(owner, 'pointerdown', e => {
          if ((e as PointerEvent).button === 0) play()
        })
        for (const ev of ['pointerup', 'pointercancel', 'blur']) on(w, ev, stop)
        on(owner, 'keydown', e => {
          if (['Enter', ' '].includes((e as KeyboardEvent).key)) play()
        })
        on(owner, 'keyup', stop)
        on(owner, 'blur', stop)
      } else if (Array.isArray(tr)) {
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
