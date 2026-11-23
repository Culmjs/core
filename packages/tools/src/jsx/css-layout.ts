// Read only CSS forms that map to checked Culm declarations. Unsupported
// expressions remain with the normalizer, which returns a located warning.
const length = (s: string) => {
  const m = /^(-?(?:\d+|\d*\.\d+))(px|%|vw|vh|ch)?$/i.exec(s)
  return m && (m[2] || +m[1] === 0)
    ? { n: +m[1]!, unit: m[2] ?? 'px' }
    : undefined
}
const track = (s: string) => {
  const m = /^([\d.]+)fr$/.exec(s)
  if (m && +m[1]! >= 0.1 && +m[1]! <= 12) return { fr: +m[1]! }
  if (s === 'max-content') return 'fit'
  const v = length(s)
  return v &&
    ['px', '%'].includes(v.unit) &&
    v.n >= 0 &&
    v.n <= (v.unit === '%' ? 100 : 2000)
    ? v
    : undefined
}

export function layoutDecl(input: Record<string, string>) {
  const d: Record<string, unknown> = { ...input }
  const inset: Record<string, unknown> = {}
  for (const k of ['top', 'right', 'bottom', 'left']) {
    if (!input[k]) continue
    const v = length(input[k])
    if (v) {
      inset[k] = v
      delete d[k]
    }
  }
  if (Object.keys(inset).length && !input.inset) d.inset = inset
  const tracks = input['grid-template-columns']?.trim().split(/\s+/).map(track)
  if (tracks && tracks.length <= 12 && tracks.every(t => t !== undefined)) {
    d.columns = tracks
    delete d['grid-template-columns']
  }
  const rotate = /^rotate\((-?[\d.]+)deg\)$/i.exec(input.transform ?? '')
  if (rotate && Math.abs(+rotate[1]!) <= 360) {
    d.rotate = +rotate[1]!
    delete d.transform
  }
  const shift = /^translate([XY])\(([^)]+)\)$/i.exec(input.transform ?? '')
  const offset = shift && length(shift[2]!)
  if (shift && offset) {
    const zero = { n: 0, unit: 'px' }
    d.move =
      shift[1]!.toLowerCase() === 'x'
        ? { x: offset, y: zero }
        : { x: zero, y: offset }
    delete d.transform
  }
  const bg = input.background ?? input['background-image']
  const grad = /^linear-gradient\(\s*(?:(-?[\d.]+)deg\s*,)?\s*(.+)\)$/i.exec(
    bg ?? '',
  )
  if (grad) {
    const parts = grad[2]!
      .split(',')
      .map(s =>
        /^\s*(#(?:[\da-f]{3}|[\da-f]{6}))(?:\s+(\d+(?:\.\d+)?)%)?\s*$/i.exec(s),
      )
    if (parts.length >= 2 && parts.length <= 4 && parts.every(Boolean)) {
      const stops = parts.map((m, i) => ({
        color: m![1],
        at:
          m![2] === undefined
            ? i === 0
              ? 0
              : i === parts.length - 1
                ? 100
                : undefined
            : +m![2],
      }))
      for (let i = 1; i < stops.length - 1; i++)
        if (stops[i]!.at === undefined) {
          const last = i - 1,
            next = stops.findIndex((s, j) => j > i && s.at !== undefined)
          stops[i]!.at =
            stops[last]!.at! +
            (stops[next]!.at! - stops[last]!.at!) / (next - last)
        }
      if (
        stops.every(
          (s, i) =>
            s.at! >= 0 && s.at! <= 100 && (!i || s.at! >= stops[i - 1]!.at!),
        )
      ) {
        d.gradient = {
          angle: ((Number(grad[1] ?? 180) % 360) + 360) % 360,
          stops,
        }
        delete d[input.background ? 'background' : 'background-image']
      }
    }
  }
  if (input.display === 'none') {
    d.hidden = true
    delete d.display
  }
  if (input['text-transform'] === 'uppercase') {
    d.upper = true
    delete d['text-transform']
  }
  if (input['white-space'] === 'nowrap') {
    d.nowrap = true
    delete d['white-space']
  }
  if (Number.isInteger(Number(input['z-index']))) {
    d.z = Number(input['z-index'])
    delete d['z-index']
  }
  if (input['aspect-ratio']) {
    const m = /^([\d.]+)(?:\s*\/\s*([\d.]+))?$/.exec(input['aspect-ratio'])
    if (m && +m[1]! > 0 && Number(m[2] ?? 1) > 0) {
      d.aspect = +m[1]! / Number(m[2] ?? 1)
      delete d['aspect-ratio']
    }
  }
  return d
}
