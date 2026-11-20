import type { Look } from '../document/index.ts'

export function luminance(hex: string) {
  const n = hex.replace('#', '')
  const full =
    n.length === 3
      ? n
          .split('')
          .map(c => c + c)
          .join('')
      : n
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const mix = (a: string, b: string, t: number) =>
  '#' +
  [1, 3, 5]
    .map(i =>
      Math.round(
        parseInt(a.slice(i, i + 2), 16) * (1 - t) +
          parseInt(b.slice(i, i + 2), 16) * t,
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** The look's Muted and Line, as the page computes them in CSS (66% and 14% ink over the background). */
export const mutedOf = (look: Pick<Look, 'ink' | 'bg'>) =>
  mix(look.ink, look.bg, 0.34)
export const lineOf = (look: Pick<Look, 'ink' | 'bg'>) =>
  mix(look.ink, look.bg, 0.86)

/** A site colour in dark: lightened the way the brand is, or unchanged when the look's background is already dark. */
export function darkOf(look: Look, hex: string): string {
  return luminance(look.bg) < 0.2
    ? hex
    : mix(hex.slice(0, 7), '#ffffff', 0.45) + hex.slice(7)
}

export type Colors = Pick<Look, 'brand' | 'ink' | 'bg'>

/** The site's colours in light and in dark; a look whose background is already dark keeps its colours in both. */
export function siteColors(look: Look): { light: Colors; dark: Colors } {
  const light = { brand: look.brand, ink: look.ink, bg: look.bg }
  const dark =
    luminance(look.bg) < 0.2
      ? light
      : {
          brand: mix(look.brand, '#ffffff', 0.45),
          ink: '#ecebf0',
          bg: '#16151b',
        }
  return { light, dark }
}
