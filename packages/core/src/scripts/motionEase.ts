// A leaf helper: both the compiler and the future standalone timeline bundle
// can use these curves without importing document/registry code into a script.
type Ease = 'linear' | 'ease-out' | 'expo-out' | undefined

/** Normalized [0,1] progress. */
export function easeAt(ease: Ease, t: number): number {
  if (ease === 'ease-out') return t * (2 - t)
  if (ease === 'expo-out') return t === 1 ? 1 : 1 - 2 ** (-10 * t)
  return t
}

export function cssEase(ease: Ease): string {
  // Degree elevation of quadratic-out: x=t; y=1-(1-t)^2. CSS's keyword is a different curve.
  if (ease === 'ease-out')
    return 'cubic-bezier(.33333333,.66666667,.66666667,1)'
  if (ease === 'expo-out')
    return `linear(${Array.from({ length: 33 }, (_, i) => +easeAt(ease, i / 32).toFixed(6)).join(',')})`
  return 'linear'
}
