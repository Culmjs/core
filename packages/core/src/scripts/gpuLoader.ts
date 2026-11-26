/** Generation binds the path and integrity to the shipped host, never to document data. */
export function loadGpu(
  doc: Document,
  win: Window & typeof globalThis,
  path: string,
  integrity: string,
) {
  const data = doc.getElementById('culm-gpu') as
    (HTMLElement & { observed?: boolean }) | null
  if (!data || data.observed || !win.IntersectionObserver) return
  data.observed = true
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)')
  const nav = win.navigator as Navigator & {
    connection?: EventTarget & { saveData?: boolean }
  }
  const connection = nav.connection
  const allowed = () =>
    !(motion.matches || (nav.connection && nav.connection.saveData))
  let loaded = false
  const observer = new win.IntersectionObserver(
    entries => {
      if (
        loaded ||
        !allowed() ||
        !entries.some(
          ({ isIntersecting, boundingClientRect: r }) =>
            isIntersecting && r.width > 0 && r.height > 0,
        )
      )
        return
      loaded = true
      disconnect()
      listen('removeEventListener')
      const script = doc.createElement('script')
      script.src = path
      script.integrity = integrity
      doc.head.append(script)
    },
    { rootMargin: '200px' },
  )
  // An edge-intersecting zero-area box can grow without crossing another
  // intersection threshold. Ask for a fresh entry after its layout changes.
  const size =
    win.ResizeObserver &&
    new win.ResizeObserver(entries => {
      if (!loaded && allowed())
        for (const { target } of entries) {
          observer.unobserve(target)
          observer.observe(target)
        }
    })
  function observe() {
    disconnect()
    if (!loaded && allowed()) {
      const runnable = doc.querySelectorAll('[data-gpu-run]')
      const owners = runnable.length
        ? runnable
        : doc.querySelectorAll('[data-culm-gpu]')
      owners.forEach(el => {
        observer.observe(el)
        if (size) size.observe(el)
      })
    }
  }
  function disconnect() {
    observer.disconnect()
    if (size) size.disconnect()
  }
  function listen(action: 'addEventListener' | 'removeEventListener') {
    motion[action]('change', observe)
    if (connection && typeof connection[action] === 'function')
      connection[action]('change', observe)
  }
  listen('addEventListener')
  observe()
}
