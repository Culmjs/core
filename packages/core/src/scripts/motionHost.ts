import {
  measureLayers,
  min,
  max,
  abs,
  rect,
  rejectMeasurement,
  type TextPlan,
} from './motionText.ts'

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

const area = (r: DOMRect) => r.width * r.height

export function hostMotion(
  doc: Document & { _cm?: boolean },
  w: Window,
  signal?: AbortSignal,
): void {
  // gen-scripts specializes this literal for stationary load/entrance pages.
  // Direct imports, including the editor's abortable host, always get full support.
  const interactive = true
  type Realm = Window & typeof globalThis
  const { ResizeObserver, IntersectionObserver, MutationObserver } = w as Realm
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

  const disconnect = (o?: { disconnect(): void }): undefined => {
    if (o) o.disconnect()
  }
  const hidden = (el: Element) =>
    el.getClientRects ? !el.getClientRects().length : !area(rect(el))
  const clock = (name: string) =>
    (w as Realm).CSS.supports(`animation-timeline:${name}()`)
  const attr = 'data-culm-motion'
  const pending = new Set<() => void>()
  let frame = 0
  // Keep invalidated text measurements queued across a hidden interval.
  // Each mount withdraws its own jobs on abort, including a pending reflow.
  const drive = () => {
    if (doc.hidden || !pending.size) {
      if (frame) w.cancelAnimationFrame(frame)
      frame = 0
    } else if (!frame)
      frame = w.requestAnimationFrame(() => {
        pending.forEach(read => read())
        pending.clear()
        frame = 0
      })
  }
  const schedule = (read: () => void) => {
    pending.add(read)
    drive()
  }
  const cancel = (read: () => void) => {
    pending.delete(read)
    drive()
  }

  const layouts = new Set<() => void>()
  let unwatchFlow: () => void

  doc.querySelectorAll(`[${attr}]`).forEach(owner => {
    const s: Scene = JSON.parse(owner.getAttribute(attr)!)
    if (interactive && s.native && clock('view')) return
    const { trigger: tr, parts, pin, layout } = s
    const fonts = parts && doc.fonts
    const state = interactive && Array.isArray(tr)
    const pointer = interactive && tr === 'pointer-x',
      scrub = interactive && (pointer || tr === 'scroll')
    const locate = (id?: number, ancestor = false, root: Element = owner) =>
      id || ancestor
        ? root[ancestor ? 'closest' : 'querySelector']('.cm-e' + +id!)
        : root
    const child = interactive ? locate(s.child) : owner
    if (!owner.animate || !owner.getBoundingClientRect || !child) return
    const readInput = scrub || layout
    let entered: true | undefined
    const mount = (scope: AbortSignal) => {
      const on = (
        el: EventTarget,
        names: string,
        f: EventListener,
        capture?: boolean,
      ) =>
        names
          .split(' ')
          .forEach(name =>
            el.addEventListener(name, f, { signal: scope, capture }),
          )
      // IO owns visibility; a load/activation before its first delivery starts paused.
      let visible: boolean | undefined
      let x: number | undefined
      const animations: Animation[] = []
      // Fixed instance keys survive text reflow. Fragments and static holds
      // are keyed by their own Animation and are discarded on every rebuild.
      const owned = new Map<number[] | Animation, Animation>()
      const seek = (time: number) =>
        animations.forEach(a => {
          if (time === Infinity) a.finish()
          else a.currentTime = time
        })
      const keep = (a: Animation, key?: false | number[]) => {
        // Later fills (including another pin's additive margin at the same
        // ancestor) must not auto-remove earlier contributions.
        if (a.persist) a.persist()
        owned.set(key || a, a)
        animations.push(a)
      }
      const shifts: KeyframeEffect[] = []
      const project = (el: Element | null) =>
        shifts.forEach(fx => (fx.target = el))
      const marked = (value: boolean) =>
        owner.toggleAttribute('data-cm-on', value)
      let duration = s.duration
      let restore: (() => void) | void
      let sizes: ResizeObserver | undefined
      const watchSize = (read: () => void, ...elements: Element[]) => {
        sizes = new ResizeObserver(read)
        elements.forEach(el => sizes!.observe(el))
      }
      // An already-entered owner must settle even if its first split is
      // refused and the first usable tracks are acquired on a later resize.
      let resume = entered ? Infinity : -1
      const stop = (retime?: true) => {
        owned.forEach((a, key) => {
          if (retime && key !== a) {
            ;(a.effect as KeyframeEffect).target = null
          } else {
            a.cancel()
            owned.delete(key)
          }
        })
        if (!retime) resume = -1
        animations.length = shifts.length = 0
        sizes = disconnect(sizes)
        restore = restore && restore() // release the split and consume its cleanup
        cancel(rebuild)
        marked(false)
      }

      const start = () => {
        marked(true)
        const origin = doc.timeline.currentTime
        const apply = (
          tracks: PackedTrack[],
          offset: number,
          member?: Element,
        ) => {
          tracks.forEach(([refs, frames, timing, reveal]) => {
            const keys = reveal && clock('scroll') ? reveal : frames
            refs.forEach(ref => {
              const id = ref[0]
              const el = (member || locate(id)) as
                (Element & Partial<SVGGeometryElement>) | null
              if (!el) return
              timing.delay = ref[1] + offset
              if (interactive && 'strokeDashoffset' in keys[0]) {
                const length =
                  el.getTotalLength &&
                  (el.pathLength!.baseVal || el.getTotalLength())
                if (!length) return
                keys.forEach(f => (f['--cm-length'] = length + 'px'))
              }
              const saved = owned.get(ref)
              const a = saved || el.animate(keys, timing)
              const fx = a.effect as KeyframeEffect
              if (saved) {
                fx.target = el
                fx.setKeyframes(keys)
                fx.updateTiming(timing)
              }
              if (interactive && !id && timing.id) shifts.push(fx)
              // No per-target callbacks/timers: every delay is on the same clock.
              if (origin !== null) a.startTime = origin
              if (scrub || !visible) a.pause()
              keep(a, parts && !member && ref)
            })
          })
        }
        if (parts) {
          const [groups, undo] = measureLayers(owner as HTMLElement, s.text!)
          restore = undo
          const words = groups('words')
          const ready = marked(!!words.size)
          // A refused split still watches the unmodified box. Register the
          // batch together and ignore its initial delivery unless width moved
          // since the read; later genuine metric changes share the frame queue.
          let initialWidth = owner.clientWidth
          watchSize(
            () => {
              if (initialWidth !== owner.clientWidth) invalidate()
              initialWidth = -1
            },
            owner,
            owner.parentElement!,
            ...words.keys(),
          )
          if (!ready) return
          duration = 0
          parts.forEach(p => {
            const origin = (duration += p.delay)
            if (p.clip) apply(p.clip, origin)
            if (p.unit)
              groups(p.unit).forEach((i, el) => {
                duration = origin + i * p.stagger!
                apply(p.tracks, duration, el)
              })
            else apply(p.tracks, origin)
            duration += p.duration
          })
          // Pin geometry covers the whole measured timeline.
          s.tracks.forEach(track => (track[2].duration = duration))
        }
        apply(s.tracks, 0)
        if (resume >= 0) seek(resume)
        return true
      }
      const play = () => {
        if (animations.length || restore) return
        if (pin || parts ? !area(rect(child)) : hidden(child)) {
          // IO need not cross a threshold when an in-view zero-sized box
          // grows. Borrow the metric watch only until this activation acquires
          // its tracks; stop() also releases it if the predicate turns false.
          if (interactive && state && ResizeObserver && !sizes) {
            watchSize(() => {
              if (active) play()
            }, owner)
          }
          return
        }
        sizes = disconnect(sizes)
        if (interactive && pin) {
          const balance: [HTMLElement, number][] = []
          const hold = (el: Element, f: Keyframe) =>
            keep(el.animate([f, f], { fill: 'both' }))
          const name = '--p' + s.child
          let previous = Infinity,
            vector: Keyframe
          try {
            // The first reservation belongs to the pin's own box, in its basis.
            // Flow exits use the same measurement in the enclosing parent's basis.
            ;[[0, s.basis!], ...s.flow!].forEach(([id, probe]) => {
              const el = id
                ? (locate(id, true) as HTMLElement)
                : (owner as HTMLElement)
              // The unprobed outer exit is already in viewport coordinates.
              // A missing owner basis, unlike that exit, cannot reserve travel.
              const m = probe
                ? (
                    locate(
                      probe,
                      false,
                      id ? el.parentElement! : el,
                    ) as SVGSVGElement
                  )
                    .getScreenCTM()!
                    .inverse()
                : { c: 0, d: id ? 1 : NaN }
              const y = pin * m.d
              rejectMeasurement(!isFinite(y))
              if (!id) {
                vector = {
                  [name]: `${pin * m.c}px ${y}px`,
                  [name + 'y']: y + 'px',
                }
              }
              if (abs(previous - y) > 1e-6)
                balance.push([el, el.offsetHeight + y])
              previous = y
            })
            hold(owner, vector!)
          } catch {
            return
          }
          if (start())
            balance.forEach(([el, extent], exit) => {
              const diff = extent - el.offsetHeight
              if (exit || diff > 0)
                hold(
                  el,
                  exit
                    ? { marginBottom: diff + 'px', composite: 'add' }
                    : { minHeight: extent + 'px' },
                )
            })
        } else start()
      }

      abort(scope, () => stop())
      const rebuild = () => {
        if (!restore) return
        if (animations.length)
          resume = animations.every(a => a.playState === 'finished')
            ? Infinity
            : animations.reduce((t, a) => max(t, +(a.currentTime as number)), 0)
        stop(true)
        start()
        if (scrub) syncView()
      }
      const invalidate = () => {
        if (restore) schedule(rebuild)
      }
      if (parts && !ResizeObserver) return
      if (fonts) on(fonts, 'loadingdone', invalidate)
      const entrance = tr === 'enter-view',
        load = tr === 'load'
      if (entered) {
        if (parts) on(doc, 'visibilitychange', drive)
        play()
        return
      }
      let intersecting: boolean | undefined,
        active = entrance || load
      let wake: ((e: Event) => boolean) | undefined
      function syncView(event?: IntersectionObserverEntry[] | Event) {
        if (scope.aborted) return
        // Visibility resamples immediately, superseding a queued input read.
        // An intersection delivery instead updates the most recent paint hit.
        if (event) {
          if ('type' in event) cancel(syncView)
          else intersecting = event.pop()!.isIntersecting
        }
        visible = intersecting && !doc.hidden
        if (interactive && readInput && !doc.hidden) {
          // The layout reference is the original box without this scene's
          // geometry effects. Never replace, wrap or reparent a control.
          project(null)
          const r = rect(owner),
            h = w.innerHeight
          project(owner)
          const passage = (dy: number) =>
            min(1, max(0, (h - r.top + dy) / (h + r.height)))
          const progress = passage(0)
          if (interactive && layout) {
            // Cache the scroll interval swept by the stable box. Native IO
            // watches paint. This second gate handles canonical-only entry
            // without a layout read/frame for distant document scrolls.
            const y = w.scrollY,
              x = w.scrollX
            wake = e =>
              (e.target instanceof (w as Realm).Element &&
                e.target.contains(owner)) ||
              x !== w.scrollX ||
              passage(w.scrollY - y) !== progress
          }
          if (shifts.length) {
            // Intersect the unanimated subject with the *real* clipping
            // ancestors. A scrollport can hide a link still inside the window.
            visible = (
              [
                ['top', 'bottom', 'Y', h],
                ['left', 'right', 'X', w.innerWidth],
              ] as const
            ).every(([lo, hi, overflow, end]) => {
              let a = max(0, r[lo]),
                b = min(end, r[hi])
              for (
                let n = owner.parentElement;
                n && a <= b;
                n = n.parentElement
              ) {
                if (w.getComputedStyle(n)[`overflow${overflow}`] === 'visible')
                  continue
                const clip = rect(n)
                a = max(a, clip[lo])
                b = min(b, clip[hi])
              }
              return a <= b
            })
          }
          if (scrub) {
            if (!area(r) || (pin && hidden(child!))) stop()
            else if (!pointer || x != null) {
              play()
              seek(
                duration *
                  min(
                    1,
                    max(
                      0,
                      pointer
                        ? (x! - r.left) / r.width
                        : pin
                          ? -r.top / pin
                          : progress,
                    ),
                  ),
              )
            }
          }
        }
        if (scrub) return
        if (visible && active) {
          play()
          if (entrance && animations.length) entered = true
        }
        animations.forEach(a => {
          if (a.playState === (visible ? 'paused' : 'running'))
            a[visible ? 'play' : 'pause']()
        })
      }
      on(doc, 'visibilitychange', syncView)
      const observer = new IntersectionObserver(syncView)
      observer.observe(owner)
      if (interactive && layout) {
        if (!layouts.size) {
          // Shared across mounted neutral clocks. Paint changes neither these
          // border-box sizes nor the compiler's allowlist of state attributes.
          const reflow = () => layouts.forEach(schedule)
          const sizes = ResizeObserver && new ResizeObserver(reflow)
          const states = MutationObserver && new MutationObserver(reflow)
          if (sizes)
            doc
              .querySelectorAll('.cm-flow>*')
              .forEach(el => sizes.observe(el, { box: 'border-box' }))

          const watched = 'data-cm-watch'
          if (states)
            doc.querySelectorAll(`[${watched}]`).forEach(el =>
              states.observe(el, {
                attributeFilter: el.getAttribute(watched)!.split(' '),
              }),
            )
          unwatchFlow = () => {
            disconnect(sizes)
            disconnect(states)
          }
        }
        layouts.add(syncView)
      }
      abort(scope, () => {
        disconnect(observer)
        if (interactive && layouts.delete(syncView) && !layouts.size)
          unwatchFlow()
        cancel(syncView)
      })
      if (interactive && readInput)
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
      if (interactive && scrub) {
        if (pointer)
          on(owner, 'pointermove', e => {
            if ((e as PointerEvent).pointerType === 'touch') return
            x = (e as PointerEvent).clientX
            if (visible) schedule(syncView)
          })
        syncView()
      } else if (load) play()
      else if (interactive && tr === 'hover') {
        const sync = () =>
          owner.matches(':hover,:focus-visible') ? play() : stop()
        on(owner, 'mouseenter mouseleave focus blur', sync)
        sync()
      } else if (interactive && tr === 'press') {
        // A key and several contacts can hold the same owner. Pointer releases
        // arrive on window, so match the actual contact before stopping it.
        const held = new Set<string | number>()
        type Input = KeyboardEvent & PointerEvent
        const id = (e: Input) => e.code || e.key || e.pointerId
        const down = (e: Input) => {
          if (e.key ? !e.repeat && /^(Enter| )$/.test(e.key) : e.button === 0) {
            held.add(id(e))
            play()
          }
        }
        on(owner, 'pointerdown keydown', down as EventListener)
        const up = (e: Event) => {
          if (
            e.type === 'blur'
              ? e.currentTarget === w ||
                !owner.contains((e as FocusEvent).relatedTarget as Node | null)
              : held.delete(id(e as Input)) && !held.size
          ) {
            held.clear()
            stop()
          }
        }
        on(owner, 'keyup', up)
        on(w, 'pointerup pointercancel blur', up)
        on(owner, 'blur', up, true)
      } else if (interactive && state && MutationObserver) {
        const [id, attr, value] = tr
        const holder = locate(id, true)
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
    const clear = () => run && run.abort()
    const configure = () => {
      clear()
      if (media.matches) {
        const scope = (run = new (w as Realm).AbortController()).signal
        // Force layout before consulting ready: a used face can start loading
        // only on first layout. Never mount a late font callback after abort.
        if (fonts) {
          rect(owner)
          fonts.ready.then(() => {
            if (!scope.aborted) mount(scope)
          })
        } else mount(scope)
      }
    }
    media.addEventListener('change', configure, { signal })
    abort(signal, clear)
    configure()
  })
  abort(signal, () => delete doc._cm)
}
