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
  const allowed = () => !motion.matches && !nav.connection?.saveData
  let loaded = false
  const observer = new win.IntersectionObserver(
    entries => {
      if (
        !allowed() ||
        !entries.some(
          e =>
            e.isIntersecting &&
            e.boundingClientRect.width > 0 &&
            e.boundingClientRect.height > 0,
        )
      )
        return
      observer.disconnect()
      size?.disconnect()
      loaded = true
      motion.removeEventListener('change', observe)
      connection?.removeEventListener?.('change', observe)
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
    observer.disconnect()
    size?.disconnect()
    if (!loaded && allowed())
      doc.querySelectorAll('[data-culm-gpu]').forEach(el => {
        observer.observe(el)
        size?.observe(el)
      })
  }
  motion.addEventListener('change', observe)
  connection?.addEventListener?.('change', observe)
  observe()
}
