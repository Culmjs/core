/** The part of the page the interaction script reads: the editor passes a stand-in limited to the canvas. */
type Elements = { forEach(f: (e: Element) => void): void; length: number }
export type StatesDoc = {
  querySelectorAll(s: string): Elements
  getElementById(id: string): Element | null
  /** Set by a run without a signal, so a second run on the page does nothing. */
  _r?: 1
}
export type StatesWin = {
  matchMedia?(q: string): { matches: boolean }
  location: { href: string }
  IntersectionObserver?: new (
    cb: (es: { target: Element; isIntersecting: boolean }[]) => void,
  ) => { observe(e: Element): void; unobserve(e: Element): void }
}

/**
 * The shared script for declared states and triggers. It ships as `(hostStates)(document, window)` minified by `npm run gen:scripts`;
 * a test calls it with a stand-in document and an AbortSignal: every listener is added with `{ signal }`, so aborting removes them all.
 * Reads `data-s-on="<event>:<verb>:<arg>[:<value>]"` (entries split by spaces) and sets `data-s-<name>` on the nearest holder.
 * Verbs are a fixed list; nothing is evaluated or written as HTML. goTo re-checks the scheme (http, https, mailto) before navigating.
 * Without a signal (the page) a second run does nothing: it marks the document. Keep it plain: the minified text must stay within the 6,193 byte budget.
 */
export function hostStates(
  d: StatesDoc,
  w: StatesWin,
  signal?: AbortSignal,
): void {
  if (!signal) {
    if (d._r) return
    d._r = 1
  }
  const rm =
      w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches,
    m = new Map<Element, [string, () => unknown][]>(),
    o = { signal }
  type Held = Element & { _s?: boolean }
  type Media = Element & {
    play(): Promise<void> | void
    pause(): void
    scrollIntoView(o: { behavior: string }): void
  }
  const q = (s: string) => d.querySelectorAll(s),
    ga = (e: Element, k: string) => e.getAttribute(k),
    sa = (e: Element, k: string, v: string) => e.setAttribute(k, v)
  const on = (e: Element, t: string, f: (e: Event) => unknown) =>
    e.addEventListener(t, f, o)
  const act = (
    el: Element,
    v: string,
    a: string,
    x: string,
  ): (() => void) | undefined => {
    if (v == 'set' || v == 'toggle' || v == 'step') {
      const k = 'data-s-' + a,
        h = el.closest('[' + k + ']')
      if (!h) return
      // A step is "<by>.<value>.<value>...": the next or the previous value of the state's list, wrapping round.
      const l = x ? x.split('.') : [],
        old = ga(h, k) as string,
        i = l.indexOf(old, 1),
        n =
          v == 'set'
            ? x
            : v == 'step'
              ? l[1 + ((i - 1 + +l[0] + l.length - 1) % (l.length - 1))]
              : old == 'on'
                ? 'off'
                : 'on'
      // Tabs that set this state say which one is chosen. Arrow-key roving is left out for the script budget; every tab stays a Tab stop.
      const z = ' click:set:' + a + ':',
        put = (s: string) => {
          sa(h, k, s)
          h.querySelectorAll('[role=tab]').forEach(t => {
            const e = ' ' + ga(t, 'data-s-on') + ' '
            if (e.includes(z))
              sa(t, 'aria-selected', '' + e.includes(z + s + ' '))
          })
        }
      put(n)
      // A button that switches a state tells assistive technology whether it is open.
      if (v == 'toggle') sa(el, 'aria-expanded', '' + (n == 'on'))
      return () => {
        if (ga(h, k) == n) put(old)
      }
    }
    if (v == 'goTo') {
      let p: URL
      try {
        p = new URL(decodeURIComponent(a), w.location.href)
      } catch {
        return
      }
      if (/^(https?|mailto):$/.test(p.protocol)) w.location.href = p.href
      return
    }
    const t = d.getElementById(a) as Media | null
    if (!t) return
    if (v == 'scrollTo') t.scrollIntoView({ behavior: rm ? 'auto' : 'smooth' })
    else if (v == 'play' || v == 'pause') {
      const r = t[v]()
      if (r && r.catch) r.catch(() => {})
    }
  }
  q('[data-s-on]').forEach(el => {
    ;(ga(el, 'data-s-on') as string).split(' ').forEach(s => {
      const p = s.split(':'),
        ev = p[0]
      let u: (() => void) | undefined | 0
      const f = () => act(el, p[1], p[2], p[3])
      // A switch that opens something starts as open or closed, closes on Escape and gives the focus back to its button.
      const k = 'data-s-' + p[2],
        h = p[1] == 'toggle' && ev == 'click' ? el.closest('[' + k + ']') : null
      if (h) {
        sa(el, 'aria-expanded', '' + (ga(h, k) == 'on'))
        on(h, 'keydown', e => {
          if ((e as KeyboardEvent).key == 'Escape' && ga(h, k) == 'on') {
            f()
            ;(el as HTMLElement).focus()
          }
        })
      }
      if (ev == 'click' || ev == 'submit') on(el, ev, f)
      else if (ev == 'hover') {
        const i = () => {
            if (!u) u = f()
          },
          out = () => {
            if (u) u()
            u = 0
          }
        on(el, 'mouseenter', i)
        on(el, 'focusin', i)
        on(el, 'mouseleave', out)
        on(el, 'focusout', out)
      } else if (ev == 'enter-view' || ev == 'leave-view')
        m.set(el, (m.get(el) || []).concat([[ev, f]]))
    })
  })
  if (!m.size || !w.IntersectionObserver) return
  const io = new w.IntersectionObserver(es => {
    es.forEach(e => {
      const t = e.target as Held,
        i = e.isIntersecting
      if (i || t._s) {
        ;(m.get(t) || []).forEach(h => {
          if (h[0] == (i ? 'enter-view' : 'leave-view')) h[1]()
        })
        t._s = i
      }
    })
  })
  m.forEach((_, e) => {
    io.observe(e)
  })
}
