import { pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'
import { BUDGETS, byteLength } from '../packages/core/src/compile/budgets.ts'
import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
} from '../packages/core/src/scripts/scriptsMin.ts'

/** The mixed page has three nonempty scripts. Base already includes its two appendices. */
export function measureScripts(base: string, states: string, host: string) {
  const parts = [base, states, host]
  const separator = ';'
  const total = byteLength(parts.join(separator))
  return {
    baseMax: byteLength(base),
    states: byteLength(states),
    joins: (parts.length - 1) * byteLength(separator),
    timelinePrototype: byteLength(host),
    total,
    headroom: BUDGETS.sharedScripts - total,
  }
}

// Fixture: two block marks and a short plain-text heading on a scrollable page.
// Keep the source independent of the Node/tsx runtime: only these host bytes ship in the estimate.
const prototypeSource = `export function hostTimeline(doc, win) {
  const heading = doc.querySelector('[data-spike-heading]')
  if (!heading) return
  const text = heading.textContent
  const tracks = []
  const marks = Array.from(doc.querySelectorAll('[data-spike-mark]'))
  const original = marks.map(mark => mark.style.transform)
  marks.forEach((mark, i) => tracks.push([mark, 0, 500, i * 200, 'px']))
  heading.textContent = ''
  Array.from(text).forEach((char, i) => {
    const mask = doc.createElement('span'), glyph = doc.createElement('span')
    mask.style.display = glyph.style.display = 'inline-block'
    mask.style.overflow = 'hidden'
    glyph.textContent = char
    mask.append(glyph)
    heading.append(mask)
    tracks.push([glyph, 105, 0, i * 42, '%'])
  })
  const duration = tracks.reduce((end, t) => Math.max(end, t[3] + 1000), 0)
  const clamp = p => Math.max(0, Math.min(1, p))
  function seek() {
    const range = Math.max(1, doc.documentElement.scrollHeight - win.innerHeight)
    const time = clamp(win.scrollY / range) * duration
    for (const [el, from, to, delay, unit] of tracks) {
      const x = from + (to - from) * clamp((time - delay) / 1000)
      el.style.transform = 'translateX(' + x + unit + ')'
    }
  }
  function stop() {
    win.removeEventListener('scroll', seek)
    win.removeEventListener('resize', seek)
    win.removeEventListener('pagehide', stop)
    heading.textContent = text
    marks.forEach((mark, i) => mark.style.transform = original[i])
  }
  win.addEventListener('scroll', seek, { passive: true })
  win.addEventListener('resize', seek)
  win.addEventListener('pagehide', stop)
  seek()
}`

/** Same loader, target, minification and page invocation as gen-scripts.ts:shipHost. */
export function renderPrototype(): string {
  const fn = transformSync(prototypeSource, {
    loader: 'ts',
    minify: true,
    target: 'es2017',
  })
    .code.trim()
    .replace(/^export function hostTimeline/, 'function')
  return `(${fn})(document,window)`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(
    JSON.stringify(
      measureScripts(
        BASE_SCRIPT + OPEN_SCRIPT + EMAIL_SCRIPT,
        STATES_SCRIPT,
        renderPrototype(),
      ),
    ),
  )
