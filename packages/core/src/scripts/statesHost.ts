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
  if (!signal && (d._r || !(d._r = 1))) return
  type Held = Element & { _s?: boolean; _h?: [string, () => unknown][] }
  type Media = Element & {
    play(): Promise<void> | void
    pause(): void
    scrollIntoView: (o: { behavior: string }) => void
  }
  let io: { observe(e: Element): void; unobserve(e: Element): void } | undefined
  let r: Promise<void> | void | undefined
  const o = { signal },
    O = 'data-s-',
    A = O + 'on',
    IO = w.IntersectionObserver
  const ga = (e: Element, k: string) => e.getAttribute(k),
    sa = (e: Element, k: string, v: string | boolean) =>
      e.setAttribute(k, '' + v)
  const on = (e: Element, t: string, f: (e: Event) => unknown) =>
    t.split(' ').forEach(n => e.addEventListener(n, f, o))
  d.querySelectorAll('[' + A + ']').forEach(el =>
    ga(el, A)!
      .split(' ')
      .forEach(s => {
        const [ev, v, a, x] = s.split(':'),
          k = O + a,
          h = el.closest('[' + k + ']')
        let u: (() => void) | undefined | 0
        const f = (): (() => void) | undefined => {
          if (v == 'set' || v == 'toggle' || v == 'step') {
            if (!h) return
            const [by, ...l] = (x || '').split('.'),
              old = ga(h, k)!,
              n =
                v == 'set'
                  ? x
                  : v == 'toggle'
                    ? old == 'on'
                      ? 'off'
                      : 'on'
                    : l[(l.indexOf(old) + +by + l.length) % l.length],
              z = ' click:set:' + a + ':',
              put = (val: string) => {
                sa(h, k, val)
                h.querySelectorAll('[role=tab]').forEach(t => {
                  const e = ' ' + ga(t, A) + ' '
                  if (e.includes(z))
                    sa(t, 'aria-selected', e.includes(z + val + ' '))
                })
              }
            put(n)
            if (v == 'toggle') sa(el, 'aria-expanded', n == 'on')
            return () => ga(h, k) == n && put(old)
          }
          if (v == 'goTo')
            try {
              const L = w.location,
                p = new URL(decodeURIComponent(a), L.href)
              if (/^(https?|file|mailto):$/.test(p.protocol)) L.href = p.href
            } catch {
              /* invalid URL */
            }
          else {
            const t = d.getElementById(a) as Media | null
            if (t)
              void (v == 'scrollTo'
                ? t.scrollIntoView({
                    behavior:
                      w.matchMedia &&
                      w.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth',
                  })
                : /^p(lay|ause)$/.test(v) &&
                  (r = t[v as 'play' | 'pause']()) &&
                  r.catch &&
                  r.catch(() => {}))
          }
        }
        if (h && v == 'toggle' && ev == 'click') {
          sa(el, 'aria-expanded', ga(h, k) == 'on')
          on(
            h,
            'keydown',
            e =>
              (e as KeyboardEvent).key == 'Escape' &&
              ga(h, k) == 'on' &&
              (f(), (el as HTMLElement).focus()),
          )
        }
        if (ev == 'click') on(el, ev, f)
        else if (ev == 'submit')
          on(el, ev, e => (e && e.preventDefault && e.preventDefault(), f()))
        else if (ev == 'hover') {
          on(el, 'mouseenter focusin', () => {
            if (!u) u = f()
          })
          on(el, 'mouseleave focusout', () => {
            if (u) u()
            u = 0
          })
        } else if (
          ev.endsWith('-view') &&
          IO &&
          ((el as Held)._h || ((el as Held)._h = [])).push([ev, f]) < 2
        )
          (
            io ||
            (io = new IO(es =>
              es.forEach(e => {
                const t = e.target as Held,
                  i = e.isIntersecting
                if (i || t._s) {
                  t._h!.forEach(h => h[0][0] == (i ? 'e' : 'l') && h[1]())
                  t._s = i
                }
              }),
            ))
          ).observe(el)
      }),
  )
}
