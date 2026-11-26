import { measureText, type TextPlan } from './motionText.ts'

/** Fixed tracks share their keyframes across equal targets (the common stagger
 * case). Token 0 is the owner; other numeric tokens select inside it only. */
export type PackedTrack = [
  instances: [token: number, startMs: number][],
  frames: Keyframe[],
  options: KeyframeAnimationOptions & { duration: number },
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
  /** Inner→outer flow exits: ancestor token and its parent's local basis (0: document). */
  flow?: [number, number][]
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
    clip?: PackedTrack[]
  }[]
  text?: TextPlan
}

const token = (n: number) => '.cm-e' + +n

export function hostMotion(
  doc: Document & { _cm?: boolean },
  win: Window,
  signal?: AbortSignal,
): void {
  const w = win as Window & typeof globalThis
  const { ResizeObserver, IntersectionObserver, MutationObserver } = w
  const fonts = doc.fonts
  if (
    doc._cm ||
    (signal && signal.aborted) ||
    !w.matchMedia ||
    !IntersectionObserver
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
  const disconnect = (o?: { disconnect(): void }): undefined => {
    if (o) o.disconnect()
  }
  const clock = (name: string) => w.CSS.supports(`animation-timeline:${name}()`)
  const rect = (el: Element) => el.getBoundingClientRect()
  const area = (r: DOMRect) => r.width * r.height
  const hidden = (el: Element) =>
    el.getClientRects ? !el.getClientRects().length : !area(rect(el))
  const { max, min } = Math
  const clamp = (p: number) => min(1, max(0, p))
  const attr = 'data-culm-motion',
    vc = 'visibilitychange'
  const pending = new Set<() => void>()
  let frame = 0
  const cancel = () => {
    if (frame) w.cancelAnimationFrame(frame)
    frame = 0
    pending.clear()
  }
  const unschedule = (update: () => void) => {
    if (pending.delete(update) && !pending.size) cancel()
  }
  const schedule = (update: () => void) => {
    if (doc.hidden) return
    pending.add(update)
    if (!frame)
      frame = w.requestAnimationFrame(() => {
        frame = 0
        pending.forEach(read => read())
        pending.clear()
      })
  }
  const each = (selector: string, f: (el: Element) => void) =>
    doc.querySelectorAll(selector).forEach(f)
  const layouts = new Set<() => void>()
  let managed = false
  let unwatchFlow: () => void
  const watchFlow = () => {
    // Shared across mounted neutral clocks. Paint changes neither these
    // border-box sizes nor the compiler's allowlist of state attributes.
    const reflow = () => layouts.forEach(schedule)
    const sizes = ResizeObserver && new ResizeObserver(reflow)
    const states = MutationObserver && new MutationObserver(reflow)
    if (sizes)
      each('.cm-flow>*', el => sizes.observe(el, { box: 'border-box' }))
    const attr = 'data-cm-watch'
    if (states)
      each(`[${attr}]`, el =>
        states.observe(el, {
          attributeFilter: el.getAttribute(attr)!.split(' '),
        }),
      )
    return () => {
      disconnect(sizes)
      disconnect(states)
    }
  }
  each(`[${attr}]`, owner => {
    const s: Scene = JSON.parse(owner.getAttribute(attr)!)
    if (s.native && clock('view')) return
    const { trigger: tr, pin, layout, parts } = s
    const state = Array.isArray(tr)
    const pointer = tr === 'pointer-x',
      scrub = pointer || tr === 'scroll'
    const target = (id?: number, root: Element = owner) =>
      id ? root.querySelector(token(id)) : owner
    const child = target(s.child)
    if (!owner.animate || !owner.getBoundingClientRect || !child) return
    managed = true
    const readInput = scrub || layout
    let entered = false
    const mount = (scope: AbortSignal) => {
      const on = listen(scope)
      // IO owns visibility; a load/activation before its first delivery starts paused.
      let visible = false
      let x: number | undefined
      const animations: Animation[] = []
      const keep = (a: Animation) => {
        // Later fills (including another pin's additive margin at the same
        // ancestor) must not auto-remove earlier contributions.
        if (a.persist) a.persist()
        animations.push(a)
      }
      const shifts: KeyframeEffect[] = []
      const project = (el: Element | null) =>
        shifts.forEach(fx => {
          fx.target = el
        })
      const marked = (value: boolean) =>
        owner.toggleAttribute('data-cm-on', value)
      let duration = s.duration
      let text: ReturnType<typeof measureText> | undefined
      let sizes: ResizeObserver | undefined
      // Parsed instance tuples have stable identities. A reflow may retime a
      // real target, but must not reorder its effect above another owner's.
      const fixed = new Map<number[], Animation>()
      // An already-entered owner must settle even if its first split is
      // refused and the first usable tracks are acquired on a later resize.
      let resume = entered ? Infinity : null,
        dirty = false
      const reset = () => {
        for (const a of animations)
          if (!fixed.size || (a.effect as KeyframeEffect).target) a.cancel()
        shifts.length = animations.length = 0
        sizes = disconnect(sizes)
        if (text) text.restore()
        text = undefined
        dirty = false
        unschedule(rebuild)
        marked(false)
      }
      const stop = () => {
        fixed.forEach(a => a.cancel())
        fixed.clear()
        resume = null
        reset()
      }
      const start = () => {
        marked(true)
        const origin = doc.timeline.currentTime
        const apply = (
          tracks: PackedTrack[],
          offset: number,
          member?: Element,
        ) => {
          for (const [refs, frames, timing, reveal] of tracks)
            for (const ref of refs) {
              const [id, delay] = ref
              const el = member || target(id)
              if (!el) continue
              timing.delay = delay + offset
              const keys = reveal && clock('scroll') ? reveal : frames
              if ('strokeDashoffset' in keys[0]) {
                const path = el as SVGPathElement
                const length =
                  path.getTotalLength &&
                  (path.pathLength.baseVal || path.getTotalLength())
                if (!length) continue
                for (const f of keys) f['--cm-length'] = length + 'px'
              }
              let a = fixed.get(ref)
              if (a) {
                const fx = a.effect as KeyframeEffect
                fx.target = el
                fx.setKeyframes(keys)
                fx.updateTiming(timing)
              } else {
                a = el.animate(keys, timing)
                if (parts && !member) fixed.set(ref, a)
              }
              if (!id && timing.id) shifts.push(a.effect as KeyframeEffect)
              // No per-target callbacks/timers: every delay is on the same clock.
              if (origin !== null) a.startTime = origin
              if (scrub || !visible) a.pause()
              keep(a)
            }
        }
        if (parts) {
          text = measureText(owner as HTMLElement, s.text!)
          const words = text.groups.words
          const ready = marked(!!words.length)
          // A refused split still watches the unmodified box. Register the
          // batch together and ignore its initial delivery unless width moved
          // since the read; later genuine metric changes share the frame queue.
          let initialWidth: number | undefined = owner.clientWidth
          sizes = new ResizeObserver(() => {
            if (initialWidth !== owner.clientWidth) invalidate()
            initialWidth = undefined
          })
          for (const el of [owner, owner.parentElement!, ...words.flat()])
            sizes.observe(el)
          if (!ready) return false
          duration = 0
          for (const p of parts) {
            duration += p.delay
            if (p.clip) apply(p.clip, duration)
            let tail = 0
            if (p.unit) {
              const groups = text.groups[p.unit]
              groups.forEach((members, i) => {
                tail = i * p.stagger!
                for (const el of members) apply(p.tracks, duration + tail, el)
              })
            } else apply(p.tracks, duration)
            duration += p.duration + tail
          }
          // Pin geometry covers the whole measured timeline.
          for (const track of s.tracks) track[2].duration = duration
        }
        apply(s.tracks, 0)
        if (resume !== null)
          for (const a of animations) {
            if (resume === Infinity) a.finish()
            else a.currentTime = resume
          }
        return true
      }
      const play = () => {
        if (animations.length || text) return
        if (pin || parts ? !area(rect(child)) : hidden(child)) {
          // IO need not cross a threshold when an in-view zero-sized box
          // grows. Borrow the metric watch only until this activation acquires
          // its tracks; stop() also releases it if the predicate turns false.
          if (state && ResizeObserver && !sizes) {
            sizes = new ResizeObserver(() => {
              if (active) play()
            })
            sizes.observe(owner)
          }
          return
        }
        sizes = disconnect(sizes)
        if (!pin) return start()
        // Capture every applicable extent before installing the padding.
        const balance: [HTMLElement, number][] = []
        const matrix = (el: Element, id: number) =>
          (target(id, el) as SVGSVGElement).getScreenCTM()!.inverse()
        const hold = (f: Keyframe, el: Element = owner) =>
          keep(el.animate([f, f], { fill: 'both' }))
        let needed
        try {
          const m = matrix(owner, s.basis!),
            y = pin * m.d
          if (!isFinite(y)) return
          needed = (owner as HTMLElement).offsetHeight + y
          let previous = y
          for (const [id, probe] of s.flow!) {
            const boundary = owner.closest<HTMLElement>(token(id))!
            const next = probe
              ? pin * matrix(boundary.parentElement!, probe).d
              : pin
            if (!isFinite(next)) return
            if (Math.abs(previous - next) > 1e-6)
              balance.push([boundary, boundary.offsetHeight + next])
            previous = next
          }
          const name = '--p' + s.child
          hold({ [name]: `${pin * m.c}px ${y}px`, [name + 'y']: y + 'px' })
        } catch {
          return
        } // absent/singular geometry: leave the static box in flow
        if (!start()) return
        if ((owner as HTMLElement).offsetHeight < needed)
          hold({ minHeight: needed + 'px' })
        // Settle corrections inside out. An inner margin has already affected
        // the next boundary's actual height by the time it is read here.
        for (const [el, extent] of balance)
          hold(
            { marginBottom: extent - el.offsetHeight + 'px', composite: 'add' },
            el,
          )
      }
      abort(scope, stop)
      const rebuild = () => {
        if (!text) return
        if (animations.length)
          resume = animations.every(a => a.playState === 'finished')
            ? Infinity
            : animations.reduce((t, a) => max(t, +a.currentTime!), 0)
        fixed.forEach(a => {
          ;(a.effect as KeyframeEffect).target = null
        })
        reset()
        start()
        if (scrub) syncView()
      }
      const invalidate = () => {
        if (text) {
          dirty = true
          schedule(rebuild)
        }
      }
      if (parts) {
        if (!ResizeObserver) return
        if (fonts) on(fonts, 'loadingdone', invalidate)
        on(doc, vc, () => {
          if (dirty) schedule(rebuild)
        })
      }
      const entrance = tr === 'enter-view',
        load = tr === 'load'
      if (entered) {
        play()
        return
      }
      let intersecting = false,
        active = entrance || load
      let wake: ((e: Event) => boolean) | undefined
      const syncView = () => {
        visible = intersecting && !doc.hidden
        if (readInput) {
          if (!doc.hidden) {
            // The layout reference is the original box without this scene's
            // geometry effects. Never replace, wrap or reparent a control.
            project(null)
            const r = rect(owner),
              h = w.innerHeight
            project(owner)
            const passage = (dy: number) =>
              clamp((h - r.top + dy) / (h + r.height))
            const progress = passage(0)
            if (layout) {
              // Cache the scroll interval swept by the stable box. Native IO
              // watches paint. This second gate handles canonical-only entry
              // without a layout read/frame for distant document scrolls.
              const sy = w.scrollY,
                sx = w.scrollX
              wake = e =>
                (e.target instanceof w.Element && e.target.contains(owner)) ||
                sx !== w.scrollX ||
                passage(w.scrollY - sy) !== progress
            }
            if (shifts.length) {
              // Intersect the unanimated subject with the *real* clipping
              // ancestors. A scrollport can hide a link still inside the window.
              const axis = (
                lo: 'top' | 'left',
                hi: 'bottom' | 'right',
                overflow: 'overflowX' | 'overflowY',
                end: number,
              ) => {
                let a = max(0, r[lo]),
                  b = min(end, r[hi])
                for (
                  let n = owner.parentElement;
                  n && a <= b;
                  n = n.parentElement
                ) {
                  if (w.getComputedStyle(n)[overflow] === 'visible') continue
                  const clip = rect(n)
                  a = max(a, clip[lo])
                  b = min(b, clip[hi])
                }
                return a <= b
              }
              visible =
                axis('top', 'bottom', 'overflowY', h) &&
                axis('left', 'right', 'overflowX', w.innerWidth)
            }
            if (scrub) {
              if (!area(r) || (pin && hidden(child))) stop()
              else if (!pointer || x != null) {
                play()
                const time =
                  duration *
                  clamp(
                    pointer
                      ? (x! - r.left) / r.width
                      : pin
                        ? -r.top / pin
                        : progress,
                  )
                for (const a of animations) a.currentTime = time
              }
            }
          }
          if (scrub) return
        }
        if (visible && active) {
          play()
          if (entrance && animations.length) entered = true
        }
        for (const a of animations)
          if (a.playState === (visible ? 'paused' : 'running'))
            a[visible ? 'play' : 'pause']()
      }
      const observer = new IntersectionObserver(entries => {
        if (scope.aborted) return
        intersecting = entries.pop()!.isIntersecting
        syncView()
      })
      observer.observe(owner)
      if (layout) {
        if (!layouts.size) unwatchFlow = watchFlow()
        layouts.add(syncView)
      }
      abort(scope, () => {
        disconnect(observer)
        if (layouts.delete(syncView) && !layouts.size) unwatchFlow()
        unschedule(syncView)
      })
      on(doc, vc, syncView)
      if (readInput)
        on(
          w,
          'scroll resize',
          e => {
            const resize = e.type[0] === 'r'
            if (pin && resize) stop()
            if (
              visible ||
              intersecting ||
              (resize && (layout || pin)) ||
              (wake && wake(e))
            )
              schedule(syncView)
          },
          true,
        )
      if (scrub) {
        if (pointer)
          on(owner, 'pointermove', e => {
            if ((e as PointerEvent).pointerType === 'touch') return
            x = (e as PointerEvent).clientX
            if (visible) schedule(syncView)
          })
        syncView()
      } else if (load) play()
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
            e.key
              ? !e.repeat && (e.key === 'Enter' || e.key === ' ')
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
      } else if (state && MutationObserver) {
        const [id, attr, value] = tr
        const holder = owner.closest(token(id))
        if (!holder) return
        const sync = () =>
          (active = holder.getAttribute(attr) === value) ? play() : stop()
        const observer = new MutationObserver(sync)
        observer.observe(holder, { attributeFilter: [attr] })
        abort(scope, () => disconnect(observer))
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
        const scope = run.signal
        // Force layout before consulting ready: a used face can start loading
        // only on first layout. Never mount a late font callback after abort.
        if (parts && fonts) {
          rect(owner)
          fonts.ready.then(() => {
            if (!scope.aborted) mount(scope)
          })
        } else mount(scope)
      }
    }
    on(media, 'change', configure)
    abort(signal, clear)
    configure()
  })
  if (managed)
    on(doc, vc, () => {
      if (doc.hidden) cancel()
    })
  abort(signal, () => {
    cancel()
    delete doc._cm
  })
}
