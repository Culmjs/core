import {
  contrast,
  darkOf,
  luminance,
  mutedOf,
  mutedPercent,
  siteColors,
  type Colors,
} from './colors.ts'
import type { FontRef, Look, SiteStyles } from '../document/index.ts'
import { fontFamily, isFontRef, SYSTEM_STACKS } from './fonts.ts'
import { stylesOf } from './siteStyles.ts'
import { dropShadowText, escapeCss, shadowText } from './decl.ts'

const MIN = 4.5

/** The text colour on the look's accent: the authored ink when it reads (4.5:1), else black or white, whichever reads better (one always does). */
export function onAccent(look: Look): string {
  const accent = look.accent!
  if (contrast(look.ink, accent) >= MIN) return look.ink
  return contrast('#000000', accent) >= contrast('#ffffff', accent)
    ? '#000000'
    : '#ffffff'
}

/** Sky clouds, the bevel and the gloss need a light and a shade colour. They are variables so the dark scheme can swap them (a fixed white cloud would sit under light text). */
function lightLook(look: Look): {
  light: Record<string, string>
  dark: string[]
} {
  if (
    look.texture !== 'sky' &&
    look.shadow !== 'bevel' &&
    look.shadow !== 'gloss'
  )
    return { light: {}, dark: [] }
  return {
    light: { '--s-hi': '#fff', '--s-lo': '#808080' },
    dark: [
      '--s-hi:color-mix(in srgb,var(--s-ink) 30%,var(--s-bg))',
      '--s-lo:color-mix(in srgb,#000 50%,var(--s-bg))',
    ],
  }
}

export function lookVars(
  look: Look,
  family: (f: FontRef) => string | undefined = fontFamily,
): Record<string, string> {
  const font = (f: FontRef) => family(f) ?? SYSTEM_STACKS.sans
  // Every token is guarded where it is written: a colour only as hex, a number only as a finite number, so a look nobody validated cannot put CSS in the page.
  const hex = (v: string) => (HEX.test(v) ? v : '#000000')
  const num = (v: unknown) => (Number.isFinite(v) ? Number(v) : 0)
  const { light, dark } = siteColors(look)
  const vars: Record<string, string> = {
    '--s-brand-l': hex(light.brand),
    '--s-ink-l': hex(light.ink),
    '--s-bg-l': hex(light.bg),
    '--s-brand-d': hex(dark.brand),
    '--s-ink-d': hex(dark.ink),
    '--s-bg-d': hex(dark.bg),
    '--s-head': font(look.headingFont),
    '--s-body': font(look.bodyFont),
    '--s-radius': `${num(look.corners)}px`,
  }
  const muted = Math.max(mutedPercent(light), mutedPercent(dark))
  if (muted > 66) vars['--s-muted-ink'] = `${muted}%`
  // Optional tokens add a variable only when set, so a look without them keeps today's nine.
  if (look.accent && HEX.test(look.accent)) {
    vars['--s-accent'] = look.accent
    // A literal, so the dark scheme (which swaps --s-ink) cannot change it.
    vars['--s-on-accent'] = hex(onAccent(look))
  }
  if (look.labelFont) vars['--s-label'] = font(look.labelFont)
  if (look.edge) {
    vars['--s-edge-w'] = `${num(look.edge.width)}px`
    if (look.edge.color && HEX.test(look.edge.color))
      vars['--s-edge-c'] = look.edge.color
  }
  if (look.shadow && Object.hasOwn(SHADOWS, look.shadow))
    vars['--s-shadow'] = SHADOWS[look.shadow]
  if (look.labelCase) {
    vars['--s-label-case'] = 'uppercase'
    vars['--s-label-track'] = '0.06em'
  }
  if (look.typeScale && Object.hasOwn(SCALES, look.typeScale))
    vars['--s-scale'] = SCALES[look.typeScale]
  if (look.buttonShape) vars['--s-btn-radius'] = '999px'
  Object.assign(vars, lightLook(look).light)
  if (look.headingCase) vars['--s-head-case'] = 'uppercase'
  if (look.headingWeight) vars['--s-head-w'] = String(num(look.headingWeight))
  if (look.headingTracking !== undefined)
    vars['--s-head-track'] = `${num(look.headingTracking)}em`
  return vars
}

const ids = (css: string, re: RegExp) =>
  new Set([...css.matchAll(re)].map(m => m[1]))

/**
 * The site styles a page uses, as light and dark variables. Only styles that `body` (the page's compiled CSS) points at are written,
 * so a site with no styles, or styles nobody uses, costs nothing. A site without `styles` still answers spacing steps from the defaults.
 */
function siteVars(
  look: Look,
  styles: SiteStyles | undefined,
  body: string,
): { light: string[]; dark: string[] } {
  const s = stylesOf({ styles, look })
  const light: string[] = [],
    dark: string[] = []
  const steps = ids(body, /var\(--s-space-([a-z0-9]+)\)/g)
  for (const k of Object.keys(s.space) as (keyof SiteStyles['space'])[])
    if (steps.has(k)) light.push(`--s-space-${k}:${s.space[k]}px`)
  const shadowIds = ids(body, /var\(--s-sh-([a-z0-9-]+)\)/g)
  const shadows = s.shadows.filter(x => shadowIds.has(x.id))
  for (const x of shadows) light.push(`--s-sh-${x.id}:${shadowText(x.value)}`)
  // a shape's filter points at `--s-shd-<id>`: the same shadow with no spread
  const dropIds = ids(body, /var\(--s-shd-([a-z0-9-]+)\)/g)
  const drops = s.shadows.filter(x => dropIds.has(x.id))
  for (const x of drops)
    light.push(`--s-shd-${x.id}:${dropShadowText(x.value)}`)
  const colorIds = ids(
    body + [...shadows, ...drops].map(x => shadowText(x.value)).join(''),
    /var\(--s-c-([a-z0-9-]+)\)/g,
  )
  for (const c of s.colors.filter(
    x => colorIds.has(x.id) && SITE_HEX.test(x.value),
  )) {
    light.push(`--s-c-${c.id}:${c.value}`)
    const d = darkOf(look, c.value)
    if (d !== c.value.toLowerCase()) dark.push(`--s-c-${c.id}:${d}`)
  }
  // deep and on-deep (a dark panel): written only when the page uses them, in light and dark like the site colours
  if (/--s-(on-)?deep/.test(body)) {
    const deep = (c: Colors) =>
      luminance(c.ink) < luminance(c.bg) ? [c.ink, c.bg] : [c.bg, c.ink]
    const l = deep(siteColors(look).light),
      d = deep(siteColors(look).dark)
    const ok = (x: string[]) => x.every(c => HEX.test(c))
    if (ok(l)) light.push(`--s-deep:${l[0]}`, `--s-on-deep:${l[1]}`)
    if (ok(d) && d[0] !== l[0])
      dark.push(`--s-deep:${d[0]}`, `--s-on-deep:${d[1]}`)
  }
  return { light, dark }
}

const tint = (c: string, n: number) =>
  `color-mix(in srgb,${c} ${n}%,transparent)`
const ink = (n: number) => tint('var(--s-ink)', n)
const brand = (n: number) => tint('var(--s-brand)', n)
/** The accent, or the brand when the look has none (the same fallback the Color "accent" uses). */
const ACCENT = 'var(--s-accent,var(--s-brand))'
const SHADOWS = {
  soft: `0 2px 12px ${ink(14)}`,
  hard: '4px 4px 0 var(--s-ink)',
  inflated: `0 8px 0 ${ink(18)},0 12px 24px ${ink(14)}`,
  glow: '0 0 24px color-mix(in srgb,var(--s-brand) 45%,transparent)',
  // Drawn as the Looks boards draw them: stepped square edge, Windows-style bevel, pressed ledge, glossy highlight, offset ghost.
  pixel:
    '4px 0 0 var(--s-ink),-4px 0 0 var(--s-ink),0 4px 0 var(--s-ink),0 -4px 0 var(--s-ink)',
  bevel: 'inset 2px 2px 0 var(--s-hi),inset -2px -2px 0 var(--s-lo)',
  press: '0 4px 0 var(--s-line)',
  gloss: `inset 0 1px 0 ${tint('var(--s-hi)', 90)},0 6px 16px ${brand(22)}`,
  glitch: `3px 3px 0 ${ACCENT},-2px -2px 0 var(--s-brand)`,
} as const
const SCALES = { compact: '0.93', large: '1.12', poster: '1.3' } as const

// Faint tints; they do not guarantee 4.5:1 on their own. Each texture is a default strength (percent) and a function from strength to layers.
// A layer is [background-image, background-size, background-position, background-repeat]. A band that sits at the top or bottom of a page
// (horizon, sky, aurora, spotlight, stripes) has a fixed height, so a long page gets one band, not a stretched one. No animation anywhere.
type Layer = [image: string, size?: string, position?: string, repeat?: string]
const band = (
  images: string[],
  height: string,
  at: 'top' | 'left bottom',
): Layer[] => images.map(i => [i, `100% ${height}`, at, 'no-repeat'])
// The notebook's red margin rule, a fixed colour like the board's.
const MARGIN =
  'linear-gradient(90deg,transparent 9px,#e89a9a 9px 10px,transparent 10px)'
const STARS: [number, number, number][] = [
  [1.5, 12, 22],
  [1, 38, 12],
  [1.5, 66, 30],
  [1, 88, 14],
  [1, 24, 70],
  [1.5, 78, 64],
  [1, 52, 88],
]
const gridLines = (n: number, px: number): Layer[] =>
  [
    `linear-gradient(${ink(n)} 1px,transparent 1px)`,
    `linear-gradient(90deg,${ink(n)} 1px,transparent 1px)`,
  ].map(i => [i, `${px}px ${px}px`])
const TEXTURES: Record<
  NonNullable<Look['texture']>,
  [strength: number, layers: (n: number) => Layer[]]
> = {
  dots: [
    14,
    n => [[`radial-gradient(${ink(n)} 1px,transparent 1.5px)`, '16px 16px']],
  ],
  grain: [
    5,
    n => [
      [
        `repeating-conic-gradient(${ink(n)} 0 25%,transparent 0 50%)`,
        '3px 3px',
      ],
    ],
  ],
  ruled: [
    10,
    n => [
      [`repeating-linear-gradient(transparent 0 27px,${ink(n)} 27px 28px)`],
    ],
  ],
  scanlines: [
    6,
    n => [[`repeating-linear-gradient(transparent 0 2px,${ink(n)} 2px 3px)`]],
  ],
  wash: [10, n => [[`linear-gradient(160deg,${brand(n)},transparent 60%)`]]],
  chrome: [
    8,
    n => [
      [
        `linear-gradient(180deg,${ink(n)},transparent 40%,${ink(Math.round(n / 2))})`,
      ],
    ],
  ],
  linen: [
    8,
    n =>
      [45, -45].map((a): Layer => [
        `repeating-linear-gradient(${a}deg,${ink(n)} 0 1px,transparent 1px 5px)`,
      ]),
  ],
  halftone: [
    10,
    n => [[`radial-gradient(${ink(n)} 1.6px,transparent 2px)`, '8px 8px']],
  ],
  grid: [10, n => gridLines(n, 20)],
  graph: [9, n => [[MARGIN], ...gridLines(n, 14)]],
  margin: [
    9,
    n => [
      [MARGIN],
      [`repeating-linear-gradient(0deg,${ink(n)} 0 1px,transparent 1px 22px)`],
    ],
  ],
  stars: [
    18,
    n =>
      STARS.map(([r, x, y]): Layer => [
        `radial-gradient(${r}px ${r}px at ${x}% ${y}%,${ink(n)},transparent)`,
        '100% 400px',
      ]),
  ],
  waves: [
    10,
    n => [
      [
        `repeating-radial-gradient(circle at 50% 130%,transparent 0 18px,${brand(n)} 18px 19px)`,
        '100% 260px',
      ],
    ],
  ],
  horizon: [
    16,
    n =>
      band(
        [
          `repeating-linear-gradient(0deg,${tint(ACCENT, n)} 0 1px,transparent 1px 12px)`,
          `repeating-linear-gradient(90deg,${tint(ACCENT, n)} 0 1px,transparent 1px 26px)`,
        ],
        '120px',
        'left bottom',
      ),
  ],
  sky: [
    8,
    n =>
      band(
        [
          `radial-gradient(150px 50px at 78% 16%,${tint('var(--s-hi)', 85)},transparent 70%)`,
          `radial-gradient(110px 40px at 30% 8%,${tint('var(--s-hi)', 70)},transparent 70%)`,
          `linear-gradient(180deg,color-mix(in srgb,var(--s-brand) ${n}%,var(--s-bg)),var(--s-bg) 75%)`,
        ],
        '420px',
        'top',
      ),
  ],
  aurora: [
    10,
    n =>
      band(
        [
          `radial-gradient(240px 150px at 85% 0%,${tint(ACCENT, 24)},transparent 70%)`,
          `radial-gradient(220px 160px at 15% 10%,${brand(n)},transparent 70%)`,
        ],
        '360px',
        'top',
      ),
  ],
  spotlight: [
    22,
    n =>
      band(
        [
          `radial-gradient(300px 160px at 50% -10%,${brand(n)},transparent 70%)`,
        ],
        '320px',
        'top',
      ),
  ],
  stripes: [
    0,
    () =>
      band(
        [
          `repeating-linear-gradient(-45deg,${ACCENT} 0 10px,var(--s-ink) 10px 20px)`,
        ],
        '7px',
        'top',
      ),
  ],
}
const BANDS: readonly string[] = [
  'horizon',
  'sky',
  'aurora',
  'spotlight',
  'stripes',
]
const layersOf = (look: Look): Layer[] | undefined => {
  if (!look.texture) return undefined
  const [strength, layers] = TEXTURES[look.texture]
  return layers(look.textureStrength ?? strength)
}

/** The look's texture as a CSS `background-image` value, or undefined. */
export const lookTexture = (look: Look): string | undefined =>
  layersOf(look)
    ?.map(l => l[0])
    .join(',')

/** `background-image` and whatever sizing, position and repeat its layers need, as declarations. */
function textureDecl(layers: Layer[]): string {
  const list = (i: 1 | 2 | 3, fallback: string) =>
    layers.some(l => l[i])
      ? `;${['background-size', 'background-position', 'background-repeat'][i - 1]}:${layers.map(l => l[i] ?? fallback).join(',')}`
      : ''
  return `background-image:${layers.map(l => l[0]).join(',')}${list(1, 'auto')}${list(2, '0 0')}${list(3, 'repeat')}`
}

/** The look's variables as one rule, so the page needs no `style` attribute. Site styles ride along (see siteVars). */
export function lookCss(
  look: Look,
  styles?: SiteStyles,
  body = '',
  family?: (f: FontRef) => string | undefined,
): string {
  const { light, dark } = siteVars(look, styles, body)
  dark.push(...lightLook(look).dark)
  let css = `.s-site{${[...Object.entries(lookVars(look, family)).map(([k, v]) => `${k}:${v}`), ...light].join(';')}}`
  const layers = layersOf(look)
  // <main> paints an opaque background, so it needs the texture too (`.s-site main` outweighs the :where() rule).
  // A band sits once, at the page edge, so <main> must not paint it again: it goes on .s-site and main turns transparent (the page colour shows through).
  if (layers)
    css += BANDS.includes(look.texture!)
      ? `.s-site{${textureDecl(layers)}}.s-site main{background-color:transparent}`
      : `.s-site,.s-site main{${textureDecl(layers)}}`
  // Headings take the look's case, weight and tracking unless a layer sets its own (a class outweighs :where).
  if (styles?.textRange?.displayMax !== undefined)
    css +=
      ':where(.s-site h1){line-height:.95;letter-spacing:-.035em}:where(.s-site h2){line-height:1.08;letter-spacing:-.025em}'
  const head = [
    look.headingCase && 'text-transform:var(--s-head-case)',
    look.headingWeight && 'font-weight:var(--s-head-w)',
    look.headingTracking !== undefined && 'letter-spacing:var(--s-head-track)',
  ].filter(Boolean)
  if (head.length)
    css += `:where(.s-site) :where(h1,h2,h3,h4,h5,h6){${head.join(';')}}`
  if (dark.length)
    css += `.s-site.s-scheme-dark{${dark.join(';')}}@media (prefers-color-scheme: dark){.s-site.s-scheme-auto{${dark.join(';')}}}`
  return escapeCss(css)
}

/** The 51 look families: the four built-in ones, then the library's. */
export const LOOK_FAMILIES: readonly string[] = [
  'Minimal',
  'Editorial',
  'Bold',
  'Laboratory',
  'Swiss',
  'Classic',
  'Brutalist',
  'Terminal',
  'Soft',
  'Playful',
  'Dopamine',
  'Cinematic',
  'Big type',
  'Organic',
  'Retro',
  'Bauhaus',
  'Memphis',
  'Art Deco',
  'Broadsheet',
  'Couture',
  'Luxury',
  'Letterpress',
  'Typewriter',
  'Comic',
  'Scrapbook',
  'Museum',
  'Japanese minimal',
  'Blueprint',
  'Notebook',
  'Preprint',
  'Reference',
  'Instrument',
  'Cosmos',
  'Ocean',
  'Botanical',
  'Solarpunk',
  'Dark academia',
  'Light academia',
  'Nordic',
  'Pixel',
  'Desktop',
  'Plain web',
  'Synthwave',
  'Cyberpunk',
  'Aero',
  'Aurora',
  'Pastel',
  'Startup',
  'Athletic',
  'Industrial',
  'Friendly',
]

const SITE_HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
export const HEX = /^#[0-9a-f]{6}$/i

/** The optional tokens a look can carry, in one place for the type's other readers (the save check, the catalog import, the merge of an edited look). */
export const LOOK_TOKENS = [
  'accent',
  'labelFont',
  'edge',
  'shadow',
  'texture',
  'textureStrength',
  'labelCase',
  'typeScale',
  'buttonShape',
  'headingCase',
  'headingWeight',
  'headingTracking',
] as const

/** Whether two looks differ in what a person can change: the three colours, both fonts, corners, dark mode and every optional token. Name, family and id are not compared. */
export function looksDiffer(a: Look, b: Look): boolean {
  const key = (l: Look) =>
    JSON.stringify([
      l.brand.toLowerCase(),
      l.ink.toLowerCase(),
      l.bg.toLowerCase(),
      l.headingFont,
      l.bodyFont,
      l.corners,
      l.dark,
      ...LOOK_TOKENS.map(k =>
        typeof l[k] === 'string' ? String(l[k]).toLowerCase() : (l[k] ?? null),
      ),
    ])
  return key(a) !== key(b)
}
/** Allowed values of the tokens that are a short list. */
export const LOOK_VOCAB: Record<
  | 'shadow'
  | 'texture'
  | 'labelCase'
  | 'typeScale'
  | 'buttonShape'
  | 'headingCase',
  readonly string[]
> = {
  shadow: Object.keys(SHADOWS),
  texture: Object.keys(TEXTURES),
  labelCase: ['caps'],
  typeScale: Object.keys(SCALES),
  buttonShape: ['pill'],
  headingCase: ['caps'],
}
const whole = (v: unknown, lo: number, hi: number, step: number) =>
  typeof v === 'number' && Number.isInteger(v / step) && v >= lo && v <= hi

/** The tokens whose value is outside the vocabulary. The accent is hex-checked by checkLook and the save check; the edge colour here. */
export function badTokens(look: Record<string, unknown>): string[] {
  const edge = look.edge as
    { width?: unknown; color?: unknown } | null | undefined
  return LOOK_TOKENS.filter(k => {
    const v = look[k]
    if (v === undefined) return false
    if (k in LOOK_VOCAB)
      return !LOOK_VOCAB[k as keyof typeof LOOK_VOCAB].includes(v as string)
    if (k === 'labelFont') return !isFontRef(v)
    if (k === 'edge')
      return !(
        typeof edge === 'object' &&
        edge !== null &&
        !Array.isArray(edge) &&
        Object.keys(edge).every(ek => ek === 'width' || ek === 'color') &&
        [1, 2, 3].includes(edge.width as number) &&
        (edge.color === undefined ||
          (typeof edge.color === 'string' && HEX.test(edge.color)))
      )
    if (k === 'textureStrength') return !whole(v, 2, 30, 1)
    if (k === 'headingWeight') return !whole(v, 100, 900, 100)
    if (k === 'headingTracking')
      return !(typeof v === 'number' && v >= -0.1 && v <= 0.3)
    return false
  })
}

/** Problems with a look, in plain words; empty when it passes. Checks contrast in light and dark, and the family name. */
export function checkLook(look: Look): string[] {
  const problems: string[] = []
  const colors = {
    brand: look.brand,
    ink: look.ink,
    bg: look.bg,
    ...(look.accent ? { accent: look.accent } : {}),
  }
  const bad = Object.entries(colors)
    .filter(([, v]) => !HEX.test(v))
    .map(([k]) => k)
  for (const k of bad)
    problems.push(`The ${k} colour is not a six-digit hex colour.`)
  if (!LOOK_FAMILIES.includes(look.family))
    problems.push(
      `The family "${look.family}" is not one of the known families.`,
    )
  for (const k of badTokens(look))
    problems.push(`The ${k} setting is not a value a look can use.`)
  if (bad.length) return problems
  const low = (a: string, b: string) => contrast(a, b) < MIN
  const { light, dark } = siteColors(look)
  // A look whose background is already dark has one palette (siteColors returns the same object), so its problems are reported once.
  // The derived dark palette can fail even when light passes: it lightens the brand by a fixed amount, and a very dark brand stays under 4.5.
  for (const [name, c] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    if (name === 'dark' && dark === light) continue
    if (low(c.ink, c.bg))
      problems.push(
        `In ${name}, the text colour is too faint on the background.`,
      )
    if (low(c.brand, c.bg))
      problems.push(
        `In ${name}, the brand colour is too faint on the background.`,
      )
    if (low(mutedOf(c), c.bg))
      problems.push(
        `In ${name}, the muted text is too faint on the background.`,
      )
    // No separate button-label check: the native button has no brand fill by default, and a fill the user picks is a named pair of brand, ink and bg, so brand-on-bg and ink-on-bg above already cover it.
  }
  return problems
}
