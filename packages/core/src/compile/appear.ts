/** The existing appearAfter animation. Motion preserves it as a separate list entry. */
export const APPEAR_SUPPORT = '(animation-timeline:scroll())'
export const appearRange = (vh: number) => `${vh}vh ${vh + 12}vh`
export const appearFrames = (name: string, opacity = '1') =>
  `@keyframes ${name}{from{opacity:0;visibility:hidden}to{opacity:${opacity};visibility:visible}}`
export const appearTrack = (name = 's-appear') => `${name} linear both`
