export type PartPaint = 'own' | 'bare' | 'cut'

/** Nested SVG paint: a mask cutter overrides everything; only a layer gives
 * an ordinary child its own paint inside a group which paints itself. */
export function partPaint(
  combine: unknown,
  index: number,
  outer: PartPaint,
): PartPaint {
  if (combine === 'subtract' && index > 0) return 'cut'
  return outer === 'own' && (combine === 'union' || combine === 'subtract')
    ? 'bare'
    : outer
}
