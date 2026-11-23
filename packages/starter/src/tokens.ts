import { type Look, type SiteStyles } from '@culmjs/core'

export const LOOK: Look = {
  id: 'starter',
  name: 'Starter',
  family: 'Minimal',
  brand: '#b45309',
  ink: '#1c1917',
  bg: '#fafaf9',
  headingFont: 'sys:sans',
  bodyFont: 'sys:sans',
  corners: 6,
  dark: 'auto',
}

const font = 'sys:sans' as const
const text = (
  id: string,
  size: number,
  more: Partial<SiteStyles['text'][number]['decl']> = {},
) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  decl: { font, size, color: 'ink' as const, ...more },
})

export const STYLES: SiteStyles = {
  colors: [
    { id: 'ink', name: 'Ink', value: '#1c1917' },
    { id: 'canvas', name: 'Canvas', value: '#fafaf9' },
    { id: 'brand', name: 'Brand', value: '#b45309' },
    { id: 'muted', name: 'Muted', value: '#57534e' },
    { id: 'line', name: 'Line', value: '#e7e5e4' },
  ],
  text: [
    text('eyebrow', 11, {
      weight: 600,
      upper: true,
      letterSpacing: 0.12,
      color: 'muted',
    }),
    text('body', 17, { weight: 400, lineHeight: 1.6 }),
    text('lead', 20, { weight: 400, lineHeight: 1.5, color: 'muted' }),
    text('h3', 24, { weight: 600, lineHeight: 1.25 }),
    text('h2', 32, { weight: 700, lineHeight: 1.2 }),
    text('h1', 48, { weight: 700, lineHeight: 1.1 }),
  ],
  space: { xs: 4, s: 8, m: 16, l: 24, xl: 40, '2xl': 64 },
  shadows: [{ id: 'card', name: 'Card', value: 'soft' }],
  textRange: { min: 11, max: 96, displayMax: 240 },
}
