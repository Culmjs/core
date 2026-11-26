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
const unit = (v: number) => min(1, max(0, v))

export function hostMotion(
  doc: Document & { _cm?: boolean },
  w: Window,
  signal?: AbortSignal,
): void {
  // gen-scripts specializes this literal for stationary load/entrance pages.
  // Direct imports, including the editor's abortable host, always get full support.
  const interactive = true,
    abortable = true
  type Realm = Window & typeof globalThis
  const RO = (w as Realm).ResizeObserver,
    IO = (w as Realm).IntersectionObserver,
    MO = (w as Realm).MutationObserver
  if (
    doc._cm ||
    (abortable && signal && signal.aborted) ||
    !w.matchMedia ||
    !IO ||
    !(doc._cm = 1 as unknown as boolean)
  )
    return
  const abort = (s: AbortSignal | undefined, f: () => void) =>
    s && s.addEventListener('abort', f)
  const disc = (o?: { disconnect(): void }): undefined => {
    if (o) o.disconnect()
  }
  const hidden = (el: Element) =>
    el.getClientRects ? !el.getClientRects().length : !area(rect(el))
  const clock = (k: string) =>
    (w as Realm).CSS.supports('animation-timeline:' + k + '()')
  const attr = 'data-culm-motion',
    pending = new Set<() => void>(),
    layouts = new Set<() => void>()
  let frame = 0,
    unwatchFlow: () => void
  const drive = () =>
    doc.hidden || !pending.size
      ? (frame && w.cancelAnimationFrame(frame), (frame = 0))
      : frame ||
        (frame = w.requestAnimationFrame(
          () => (pending.forEach(r => r()), pending.clear(), (frame = 0)),
        ))
  const schedule = (r: () => void) => (pending.add(r), drive())
  const cancel = (r: () => void) => pending.delete(r) && drive()

  doc.querySelectorAll('[' + attr + ']').forEach(owner => {
    const s: Scene = JSON.parse(owner.getAttribute(attr)!)
    if (interactive && s.native && clock('view')) return
    const tr = s.trigger,
      parts = s.parts,
      pin = s.pin,
      layout = s.layout,
      fonts = parts && doc.fonts
    const state = interactive && Array.isArray(tr),
      pointer = interactive && tr === 'pointer-x',
      scrub = interactive && (pointer || tr === 'scroll')
    const locate = (id?: number, anc?: boolean, r: Element = owner) =>
      id || anc ? r[anc ? 'closest' : 'querySelector']('.cm-e' + id) : r
    const child = interactive ? locate(s.child) : owner
    if (!owner.animate || !owner.getBoundingClientRect || !child) return
    let entered: true | undefined
    const mount = (scope: AbortSignal) => {
      const on = (
        el: EventTarget,
        k: string,
        f: EventListener,
        capture?: boolean,
      ) =>
        k
          .split(' ')
          .forEach(n => el.addEventListener(n, f, { signal: scope, capture }))
      let visible: boolean | undefined,
        x: number | undefined,
        duration = s.duration,
        restore: (() => void) | void,
        sizes: ResizeObserver | undefined
      let resume = entered ? Infinity : -1
      const animations: Animation[] = [],
        owned = new Map<number[] | Animation, Animation>(),
        shifts: KeyframeEffect[] = []
      const seek = (t: number) =>
        animations.forEach(a =>
          t < Infinity ? (a.currentTime = t) : a.finish(),
        )
      const keep = (a: Animation, k?: false | number[]) => (
        a.persist && a.persist(),
        owned.set(k || a, a),
        animations.push(a)
      )
      const marked = (v: boolean) => owner.toggleAttribute('data-cm-on', v)
      const watchSize = (r: () => void, els: Element[] = [owner]) => {
        sizes = new RO(r)
        els.forEach(e => sizes!.observe(e))
      }
      const re = () => restore && schedule(rebuild)
      const stop = (retime?: number) => {
        owned.forEach((a, k) =>
          retime === 1 && k !== a
            ? ((a.effect as KeyframeEffect).target = null)
            : (a.cancel(), owned.delete(k)),
        )
        if (retime !== 1) resume = -1
        animations.length = shifts.length = 0
        sizes = disc(sizes)
        restore = restore && restore()
        cancel(rebuild)
        marked(false)
      }
      const start = () => {
        marked(true)
        const origin = doc.timeline.currentTime
        const apply = (
          tracks: PackedTrack[] | undefined,
          off: number,
          member?: Element,
        ) =>
          tracks &&
          tracks.forEach(([refs, frames, timing, reveal]) => {
            const keys = reveal && clock('scroll') ? reveal : frames
            refs.forEach(ref => {
              const id = ref[0],
                el = (member || locate(id)) as
                  (Element & Partial<SVGGeometryElement>) | null
              if (!el) return
              timing.delay = ref[1] + off
              if (interactive && keys[0].strokeDashoffset != null) {
                const len =
                  el.getTotalLength &&
                  (el.pathLength!.baseVal || el.getTotalLength())
                if (!len) return
                keys.forEach(f => (f['--cm-length'] = len + 'px'))
              }
              const saved = owned.get(ref),
                a = saved || el.animate(keys, timing),
                fx = a.effect as KeyframeEffect
              if (saved) {
                fx.target = el
                fx.setKeyframes(keys)
                fx.updateTiming(timing)
              }
              if (interactive && !id && timing.id) shifts.push(fx)
              if (origin != null) a.startTime = origin
              if (scrub || !visible) a.pause()
              keep(a, parts && !member && ref)
            })
          })
        if (parts) {
          let groups: ReturnType<typeof measureLayers>[0]
          ;[groups, restore] = measureLayers(owner as HTMLElement, s.text!)
          const words = groups('words'),
            ok = marked(!!words.size)
          let w0 = owner.clientWidth
          watchSize(() => {
            if (w0 !== owner.clientWidth) re()
            w0 = -1
          }, [owner, owner.parentElement!, ...words.keys()])
          if (!ok) return
          duration = 0
          parts.forEach(p => {
            const o = (duration += p.delay)
            apply(p.clip, o)
            if (p.unit)
              groups(p.unit).forEach((i, e) =>
                apply(p.tracks, (duration = o + i * p.stagger!), e),
              )
            else apply(p.tracks, o)
            duration += p.duration
          })
          s.tracks.forEach(t => (t[2].duration = duration))
        }
        apply(s.tracks, 0)
        if (resume >= 0) seek(resume)
        return true
      }
      const play = () => {
        if (animations.length || restore) return
        if (pin || parts ? !area(rect(child)) : hidden(child)) {
          if (interactive && state && RO && !sizes)
            watchSize(() => active && play())
          return
        }
        sizes = disc(sizes)
        if (interactive && pin) {
          const bal: [HTMLElement, number][] = [],
            hold = (e: Element, f: Keyframe) =>
              keep(e.animate([f, f], { fill: 'both' })),
            name = '--p' + s.child
          let prev = Infinity,
            vec!: Keyframe
          try {
            ;[[0, s.basis!], ...s.flow!].forEach(([id, pr]) => {
              const el = locate(id, !!id) as HTMLElement
              const m = pr
                ? (
                    locate(
                      pr,
                      false,
                      id ? el.parentElement! : el,
                    ) as SVGSVGElement
                  )
                    .getScreenCTM()!
                    .inverse()
                : { c: 0, d: id ? 1 : NaN }
              const y = pin * m.d
              rejectMeasurement(y - y != 0)
              if (!id)
                vec = {
                  [name]: pin * m.c + 'px ' + y + 'px',
                  [name + 'y']: y + 'px',
                }
              if (abs(prev - y) > 1e-6) bal.push([el, el.offsetHeight + y])
              prev = y
            })
            hold(owner, vec)
          } catch {
            return
          }
          if (start())
            bal.forEach(([e, ext], ex) => {
              const d = ext - e.offsetHeight
              if (ex || d > 0)
                hold(
                  e,
                  ex
                    ? { marginBottom: d + 'px', composite: 'add' }
                    : { minHeight: ext + 'px' },
                )
            })
        } else start()
      }
      abort(scope, stop as () => void)
      const rebuild = () =>
        restore &&
        (animations.length &&
          (resume = animations.every(a => a.playState === 'finished')
            ? Infinity
            : max(0, ...animations.map(a => +(a.currentTime as number)))),
        stop(1),
        start(),
        scrub && syncView())
      if (parts && !RO) return
      if (fonts) on(fonts, 'loadingdone', re)
      if (entered)
        return (parts && on(doc, 'visibilitychange', drive), void play())
      let intersecting: boolean | undefined,
        active = tr === 'enter-view' || tr === 'load',
        wake: ((e: Event) => boolean) | undefined
      function syncView(ev?: IntersectionObserverEntry[] | Event) {
        if (scope.aborted) return
        if (ev)
          void ((ev as IntersectionObserverEntry[]).pop
            ? (intersecting = (ev as IntersectionObserverEntry[]).pop()!
                .isIntersecting)
            : cancel(syncView))
        visible = intersecting && !doc.hidden
        if (interactive && (scrub || layout) && !doc.hidden) {
          const setT = (t: Element | null) =>
            shifts.forEach(f => (f.target = t))
          setT(null)
          const r = rect(owner),
            h = w.innerHeight
          setT(owner)
          const pass = (dy: number) => unit((h - r.top + dy) / (h + r.height)),
            prog = pass(0)
          if (layout) {
            const sy = w.scrollY,
              sx = w.scrollX
            wake = e =>
              (e.target instanceof (w as Realm).Element &&
                e.target.contains(owner)) ||
              sx !== w.scrollX ||
              pass(w.scrollY - sy) !== prog
          }
          if (shifts.length) {
            let l = max(0, r.left),
              t = max(0, r.top),
              R = min(w.innerWidth, r.right),
              B = min(h, r.bottom)
            for (
              let n = owner.parentElement;
              n && l <= R && t <= B;
              n = n.parentElement
            ) {
              const cs = w.getComputedStyle(n),
                ox = cs.overflowX !== 'visible',
                oy = cs.overflowY !== 'visible'
              if (ox || oy) {
                const c = rect(n)
                if (ox) {
                  l = max(l, c.left)
                  R = min(R, c.right)
                }
                if (oy) {
                  t = max(t, c.top)
                  B = min(B, c.bottom)
                }
              }
            }
            visible = l <= R && t <= B
          }
          if (scrub) {
            if (!area(r) || (pin && hidden(child!))) stop()
            else if (!pointer || x != null) {
              play()
              seek(
                duration *
                  unit(
                    pointer
                      ? (x! - r.left) / r.width
                      : pin
                        ? -r.top / pin
                        : prog,
                  ),
              )
            }
          }
        }
        if (scrub) return
        if (visible && active) {
          play()
          if (tr === 'enter-view' && animations.length) entered = true
        }
        animations.forEach(
          a =>
            a.playState === (visible ? 'paused' : 'running') &&
            a[visible ? 'play' : 'pause'](),
        )
      }
      on(doc, 'visibilitychange', syncView)
      const io = new IO(syncView)
      io.observe(owner)
      abort(scope, () => {
        disc(io)
        if (interactive && layouts.delete(syncView) && !layouts.size)
          unwatchFlow()
        cancel(syncView)
      })
      if (tr === 'load') play()
      if (interactive) {
        if (layout) {
          if (!layouts.size) {
            const reflow = () => layouts.forEach(schedule),
              ro = RO && new RO(reflow),
              mo = MO && new MO(reflow),
              W2 = 'data-cm-watch'
            if (ro)
              doc
                .querySelectorAll('.cm-flow>*')
                .forEach(e => ro.observe(e, { box: 'border-box' }))
            if (mo)
              doc.querySelectorAll('[' + W2 + ']').forEach(e =>
                mo.observe(e, {
                  attributeFilter: e.getAttribute(W2)!.split(' '),
                }),
              )
            unwatchFlow = () => (disc(ro), disc(mo))
          }
          layouts.add(syncView)
        }
        if (scrub || layout)
          on(
            w,
            'scroll resize',
            e => {
              const rs = e.type[0] === 'r'
              if (pin && rs) stop()
              if (
                visible ||
                intersecting ||
                (rs && (layout || pin)) ||
                (wake && wake(e))
              )
                schedule(syncView)
            },
            true,
          )
        if (scrub) {
          if (pointer)
            on(
              owner,
              'pointermove',
              e =>
                (e as PointerEvent).pointerType != 'touch' &&
                ((x = (e as PointerEvent).clientX),
                visible && schedule(syncView)),
            )
          syncView()
        } else if (tr === 'hover') {
          const sync = () =>
            owner.matches(':hover,:focus-visible') ? play() : stop()
          on(owner, 'mouseenter mouseleave focus blur', sync)
          sync()
        } else if (tr === 'press') {
          type Input = KeyboardEvent & PointerEvent
          const held = new Set<string | number>(),
            id = (e: Input) => e.code || e.key || e.pointerId
          const up = (e: Event) => {
            if (
              e.type[0] === 'b'
                ? e.currentTarget === w ||
                  !owner.contains(
                    (e as FocusEvent).relatedTarget as Node | null,
                  )
                : held.delete(id(e as Input)) && !held.size
            ) {
              held.clear()
              stop()
            }
          }
          on(owner, 'pointerdown keydown', ((k: Input) => {
            if (
              (k.key ? !k.repeat && /^(Enter| )$/.test(k.key) : !k.button) &&
              held.add(id(k))
            )
              play()
          }) as EventListener)
          on(owner, 'keyup blur', up, true)
          on(w, 'pointerup pointercancel blur', up)
        } else if (state && MO) {
          const [id, at, val] = tr,
            h = locate(id, true)
          if (!h) return
          const sync = () =>
              (active = h.getAttribute(at) === val) ? play() : stop(),
            mo = new MO(sync)
          mo.observe(h, { attributeFilter: [at] })
          abort(scope, () => disc(mo))
          sync()
        }
      }
    }
    const media = w.matchMedia(
      '(prefers-reduced-motion:no-preference)' +
        (pointer ? ' and (pointer:fine)' : ''),
    )
    let run: AbortController | undefined
    const clear = () => run && run.abort()
    const cfg = () => {
      clear()
      if (media.matches) {
        const sc = (run = new (w as Realm).AbortController()).signal
        return fonts
          ? (rect(owner), fonts.ready.then(() => !sc.aborted && mount(sc)))
          : mount(sc)
      }
    }
    media.addEventListener('change', cfg, abortable ? { signal } : undefined)
    if (abortable) abort(signal, clear)
    cfg()
  })
  if (abortable) abort(signal, () => delete doc._cm)
}
