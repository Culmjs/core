import type { HtmlNode } from './html.ts'
import type { PackedTrack } from '../scripts/motionHost.ts'

/** Split stroke geometry without splitting fill topology. Only the current
 * point is needed: keep the original curve/arc commands and make a relative
 * moveto absolute after starting a fresh SVG path. Arc flags are single digits
 * (e.g. `A5 5 0 0110 20`); all other arguments use SVG number syntax. */
export function subpaths(d: string): string[] | undefined {
  if (!/^\s*[Mm].*[Mm]/s.test(d)) return
  const arity: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
  }
  const number = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iy
  const parts: string[] = []
  let at = 0,
    start = 0,
    prefix = '',
    command = '',
    x = 0,
    y = 0,
    mx = 0,
    my = 0
  const skip = () => {
    while (at < d.length && /[\s,]/.test(d[at])) at++
  }
  const finish = (end: number) => parts.push(prefix + d.slice(start, end))
  while (at < d.length) {
    skip()
    if (at === d.length) break
    const pos = at
    if (/[a-z]/i.test(d[at])) command = d[at++]
    const upper = command.toUpperCase(),
      relative = upper !== command
    if (upper === 'Z') {
      x = mx
      y = my
      command = ''
      continue
    }
    if (!arity[upper]) return
    const args: number[] = []
    for (let i = 0; i < arity[upper]; i++) {
      skip()
      if (upper === 'A' && (i === 3 || i === 4)) {
        if (d[at] !== '0' && d[at] !== '1') return
        args.push(+d[at++])
      } else {
        number.lastIndex = at
        const m = number.exec(d)
        if (!m) return
        args.push(+m[0])
        at = number.lastIndex
      }
    }
    if (upper !== 'V')
      x = (relative ? x : 0) + args[upper === 'H' ? 0 : args.length - 2]
    if (upper !== 'H') y = (relative ? y : 0) + args[args.length - 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (upper === 'M') {
      if (prefix) finish(pos)
      mx = x
      my = y
      command = relative ? 'l' : 'L'
      // Subsequent coordinate pairs on this moveto remain implicit lineto's.
      prefix = `M${x} ${y}`
      start = at
      if (relative) {
        skip()
        if (at < d.length && !/[a-z]/i.test(d[at])) {
          prefix += 'l'
          start = at
        }
      }
    }
  }
  if (prefix) finish(at)
  return parts.length > 1 ? parts : undefined
}

/** Keep the original compound fill (including winding holes) and authored
 * stroke. A draw effect switches on the normalized per-subpath strokes; at
 * other times, including before a delayed step, the original paints normally. */
export function prepareCompound(el: HtmlNode): boolean {
  if (el.tag !== 'path') return false
  const d = String(el.attrs!.d),
    strokes = subpaths(d)
  if (!strokes) return false
  delete el.attrs!.d
  el.tag = 'g'
  el.children = [
    {
      tag: 'path',
      attrs: { d, style: 'stroke-opacity:var(--cm-original,inherit)' },
    },
    {
      tag: 'g',
      attrs: {
        fill: 'none',
        'stroke-dashoffset': 0,
        style: 'opacity:var(--cm-strokes,0);pointer-events:none',
      },
      children: strokes.map(d => ({
        tag: 'path',
        attrs: { d, pathLength: 1 },
      })),
    },
  ]
  return true
}

/** Browser dashes restart at every moveto. One normalized dash per independent
 * stroke paints the requested fraction of their summed lengths at every time.
 * Single geometries instead take their actual SVG length at acquisition. */
export function drawTracks(
  tracks: PackedTrack[],
  compound: ReadonlySet<number>,
): PackedTrack[] {
  return tracks.flatMap(track => {
    const [instances, frames, options] = track
    if (!('strokeDashoffset' in frames[0])) return [track]
    const split = instances.filter(([id]) => compound.has(id))
    const plain = instances.filter(([id]) => !compound.has(id))
    const calibrated: PackedTrack[] = []
    if (split.length)
      calibrated.push([
        split,
        frames.map(({ strokeDashoffset, ...f }) => ({
          ...f,
          strokeDasharray: `${1 - Number(strokeDashoffset)} ${strokeDashoffset}`,
          '--cm-original': '0',
          '--cm-strokes': '1',
        })),
        options,
      ])
    if (plain.length)
      calibrated.push([
        plain,
        frames.map(f => ({
          ...f,
          strokeDasharray: 'var(--cm-length)',
          strokeDashoffset: `calc(var(--cm-length) * ${f.strokeDashoffset})`,
        })),
        options,
      ])
    return calibrated
  })
}
