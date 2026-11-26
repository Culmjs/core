import { backdrop, cut, type Box } from './gpuBackdrop.ts'
export { bounds } from './gpuBackdrop.ts'

/** False: wait for an observer. Undefined: visible but unsafe; retry slowly.
 * The returned tuple carries the seed from the same eligibility inspection. */
export function gpuRect(
  el: HTMLElement,
  r: Box,
  main: Element,
  forms: Box[],
  w: number,
  h: number,
  bw: number,
  bh: number,
  exact = false,
) {
  const visible = cut(r, [0, 0, w, h])
  if (!visible) return false
  if (forms.some(f => cut(f, visible))) return
  const scale = (v: number, i: number) => (i % 2 ? (v * bh) / h : (v * bw) / w)
  if (exact && visible.map(scale).some(n => n % 1)) return
  const [x, y, right, top] = [r[0], h - r[3], r[2], h - r[1]].map((v, i) =>
    (i < 2 ? Math.ceil : Math.floor)(scale(v, i)),
  )
  if (!cut([x, y, right, top], [0, 0, bw, bh])) return
  const paint = backdrop(el, main, visible)
  if (paint) return Object.assign([x, y, right - x, top - y] as Box, paint)
}
