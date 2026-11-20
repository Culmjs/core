import type { Decl, Style } from './types.ts'

/** Every style layer. Some apply to every kind; the rest need the kind to list them in `states`. */
export const STATES: readonly Exclude<keyof Style, 'when'>[] = [
  'base',
  'tablet',
  'phone',
  'hover',
  'pressed',
  'focus',
  'current',
  'open',
  'checked',
  'invalid',
  'dark',
]

/** Every declaration a style holds: its layers, then the layers that react to a state. */
export const declsOf = (s: Style | undefined): Decl[] =>
  s
    ? [
        ...STATES.flatMap(k => s[k] ?? []),
        ...(Array.isArray(s.when) ? s.when : []).map(x => x.decl),
      ]
    : []
