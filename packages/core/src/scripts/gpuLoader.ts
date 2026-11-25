/** Generation binds the path and integrity to the shipped host, never to document data. */
export function loadGpu(
  doc: Document,
  win: Window & typeof globalThis,
  path: string,
  integrity: string,
) {
  const allowed = () =>
    !win.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !(win.navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData
  if (!win.IntersectionObserver || !allowed()) return
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
      const script = doc.createElement('script')
      script.src = path
      script.integrity = integrity
      doc.head.append(script)
    },
    { rootMargin: '200px' },
  )
  doc.querySelectorAll('[data-culm-gpu]').forEach(el => observer.observe(el))
}
