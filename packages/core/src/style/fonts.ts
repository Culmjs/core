import type { FontRef } from '../document/index.ts'

export const SYSTEM_STACKS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

export type FontEntry = {
  family: string
  kind: 'serif' | 'sans' | 'mono' | 'display'
  fallback: FontRef
  files: {
    weight: number | [number, number]
    style: 'normal' | 'italic'
    file: string
    bytes: number
  }[]
}

// Files and sizes come from scripts/build-fonts.sh (Latin subset, woff2). Variable families have one upright file.
export const FONTS: Record<string, FontEntry> = {
  roboto: {
    family: 'Roboto',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'roboto.woff2',
        bytes: 52252,
      },
    ],
  },
  inter: {
    family: 'Inter',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'inter.woff2',
        bytes: 68504,
      },
    ],
  },
  'open-sans': {
    family: 'Open Sans',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [300, 800],
        style: 'normal',
        file: 'open-sans.woff2',
        bytes: 53628,
      },
    ],
  },
  lato: {
    family: 'Lato',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      { weight: 400, style: 'normal', file: 'lato-400.woff2', bytes: 42228 },
      { weight: 400, style: 'italic', file: 'lato-400i.woff2', bytes: 43712 },
      { weight: 700, style: 'normal', file: 'lato-700.woff2', bytes: 41768 },
    ],
  },
  montserrat: {
    family: 'Montserrat',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'montserrat.woff2',
        bytes: 58832,
      },
    ],
  },
  'source-sans-3': {
    family: 'Source Sans 3',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [200, 900],
        style: 'normal',
        file: 'source-sans-3.woff2',
        bytes: 50528,
      },
    ],
  },
  'ibm-plex-sans': {
    family: 'IBM Plex Sans',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 700],
        style: 'normal',
        file: 'ibm-plex-sans.woff2',
        bytes: 47448,
      },
    ],
  },
  'jetbrains-mono': {
    family: 'JetBrains Mono',
    kind: 'mono',
    fallback: 'sys:mono',
    files: [
      {
        weight: [100, 800],
        style: 'normal',
        file: 'jetbrains-mono.woff2',
        bytes: 40460,
      },
    ],
  },
  raleway: {
    family: 'Raleway',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'raleway.woff2',
        bytes: 62016,
      },
    ],
  },
  merriweather: {
    family: 'Merriweather',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [300, 900],
        style: 'normal',
        file: 'merriweather.woff2',
        bytes: 206068,
      },
    ],
  },
  'noto-sans': {
    family: 'Noto Sans',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'noto-sans.woff2',
        bytes: 56656,
      },
    ],
  },
  lora: {
    family: 'Lora',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      { weight: [400, 700], style: 'normal', file: 'lora.woff2', bytes: 37208 },
    ],
  },
  'source-serif-4': {
    family: 'Source Serif 4',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [200, 900],
        style: 'normal',
        file: 'source-serif-4.woff2',
        bytes: 85592,
      },
    ],
  },
  poppins: {
    family: 'Poppins',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      { weight: 400, style: 'normal', file: 'poppins-400.woff2', bytes: 8732 },
      { weight: 400, style: 'italic', file: 'poppins-400i.woff2', bytes: 9544 },
      { weight: 700, style: 'normal', file: 'poppins-700.woff2', bytes: 8636 },
    ],
  },
  'ibm-plex-mono': {
    family: 'IBM Plex Mono',
    kind: 'mono',
    fallback: 'sys:mono',
    files: [
      {
        weight: 400,
        style: 'normal',
        file: 'ibm-plex-mono-400.woff2',
        bytes: 15388,
      },
      {
        weight: 400,
        style: 'italic',
        file: 'ibm-plex-mono-400i.woff2',
        bytes: 17460,
      },
      {
        weight: 700,
        style: 'normal',
        file: 'ibm-plex-mono-700.woff2',
        bytes: 15796,
      },
    ],
  },
  oswald: {
    family: 'Oswald',
    kind: 'display',
    fallback: 'sys:sans',
    files: [
      {
        weight: [200, 700],
        style: 'normal',
        file: 'oswald.woff2',
        bytes: 28204,
      },
    ],
  },
  'playfair-display': {
    family: 'Playfair Display',
    kind: 'display',
    fallback: 'sys:sans',
    files: [
      {
        weight: [400, 900],
        style: 'normal',
        file: 'playfair-display.woff2',
        bytes: 52564,
      },
    ],
  },
  'roboto-slab': {
    family: 'Roboto Slab',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'roboto-slab.woff2',
        bytes: 48180,
      },
    ],
  },
  'space-grotesk': {
    family: 'Space Grotesk',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [300, 700],
        style: 'normal',
        file: 'space-grotesk.woff2',
        bytes: 26468,
      },
    ],
  },
  newsreader: {
    family: 'Newsreader',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [200, 800],
        style: 'normal',
        file: 'newsreader.woff2',
        bytes: 61632,
      },
    ],
  },
  'dm-sans': {
    family: 'DM Sans',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [100, 1000],
        style: 'normal',
        file: 'dm-sans.woff2',
        bytes: 41220,
      },
    ],
  },
  barlow: {
    family: 'Barlow',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      { weight: 400, style: 'normal', file: 'barlow-400.woff2', bytes: 23836 },
      { weight: 400, style: 'italic', file: 'barlow-400i.woff2', bytes: 26948 },
      { weight: 700, style: 'normal', file: 'barlow-700.woff2', bytes: 24588 },
    ],
  },
  'pt-serif': {
    family: 'PT Serif',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: 400,
        style: 'normal',
        file: 'pt-serif-400.woff2',
        bytes: 32888,
      },
      {
        weight: 400,
        style: 'italic',
        file: 'pt-serif-400i.woff2',
        bytes: 34720,
      },
      {
        weight: 700,
        style: 'normal',
        file: 'pt-serif-700.woff2',
        bytes: 29348,
      },
    ],
  },
  'pt-sans': {
    family: 'PT Sans',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      { weight: 400, style: 'normal', file: 'pt-sans-400.woff2', bytes: 45864 },
      {
        weight: 400,
        style: 'italic',
        file: 'pt-sans-400i.woff2',
        bytes: 43092,
      },
      { weight: 700, style: 'normal', file: 'pt-sans-700.woff2', bytes: 47628 },
    ],
  },
  literata: {
    family: 'Literata',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [200, 900],
        style: 'normal',
        file: 'literata.woff2',
        bytes: 76268,
      },
    ],
  },
  bitter: {
    family: 'Bitter',
    kind: 'serif',
    fallback: 'sys:serif',
    files: [
      {
        weight: [100, 900],
        style: 'normal',
        file: 'bitter.woff2',
        bytes: 43676,
      },
    ],
  },
  'atkinson-hyperlegible': {
    family: 'Atkinson Hyperlegible',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: 400,
        style: 'normal',
        file: 'atkinson-hyperlegible-400.woff2',
        bytes: 16884,
      },
      {
        weight: 400,
        style: 'italic',
        file: 'atkinson-hyperlegible-400i.woff2',
        bytes: 18052,
      },
      {
        weight: 700,
        style: 'normal',
        file: 'atkinson-hyperlegible-700.woff2',
        bytes: 17292,
      },
    ],
  },
  'fira-code': {
    family: 'Fira Code',
    kind: 'mono',
    fallback: 'sys:mono',
    files: [
      {
        weight: [300, 700],
        style: 'normal',
        file: 'fira-code.woff2',
        bytes: 38788,
      },
    ],
  },
  'titillium-web': {
    family: 'Titillium Web',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: 400,
        style: 'normal',
        file: 'titillium-web-400.woff2',
        bytes: 12616,
      },
      {
        weight: 400,
        style: 'italic',
        file: 'titillium-web-400i.woff2',
        bytes: 14180,
      },
      {
        weight: 700,
        style: 'normal',
        file: 'titillium-web-700.woff2',
        bytes: 12032,
      },
    ],
  },
  rubik: {
    family: 'Rubik',
    kind: 'sans',
    fallback: 'sys:sans',
    files: [
      {
        weight: [300, 900],
        style: 'normal',
        file: 'rubik.woff2',
        bytes: 37632,
      },
    ],
  },
}

export function isFontRef(v: unknown): v is FontRef {
  return (
    typeof v === 'string' && /^(sys:(sans|serif|mono)|cat:.+|up:.+)$/.test(v)
  )
}

/** A font the site's folder holds (`fonts/<slug>/font.json`), read by the tools and handed to the compile. */
export type SiteFont = {
  family: string
  kind: 'serif' | 'sans' | 'mono' | 'display'
  licence: string
  source: string
  files: {
    weight: number | [number, number]
    style: 'normal' | 'italic'
    file: string
  }[]
}
export type SiteFonts = Record<string, SiteFont>

/** The name of a held font: the family in lower case, every run of other characters one dash. */
export const fontSlug = (family: string): string =>
  family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FILE = /^[0-9]{3}(-[0-9]{3})?(-italic)?\.woff2$/
const isW = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1000

/**
 * A held font as the file says it, or undefined. The family goes into CSS and the file name into a URL, so both are held to a plain
 * grammar here; the result is built again from the fields it knows.
 */
export function checkSiteFont(v: unknown): SiteFont | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const { family, kind, licence, source, files } = o
  if (typeof family !== 'string' || !/^[A-Za-z0-9 ]{1,64}$/.test(family))
    return undefined
  if (
    kind !== 'serif' &&
    kind !== 'sans' &&
    kind !== 'mono' &&
    kind !== 'display'
  )
    return undefined
  if (typeof licence !== 'string' || !/^[A-Za-z0-9.+ -]{1,40}$/.test(licence))
    return undefined
  if (
    typeof source !== 'string' ||
    !/^https?:\/\/[^\s"'<>()\\{}`]{1,290}$/.test(source)
  )
    return undefined
  if (!Array.isArray(files) || files.length < 1 || files.length > 18)
    return undefined
  const out: SiteFont['files'] = []
  for (const f of files) {
    if (typeof f !== 'object' || f === null) return undefined
    const { weight, style, file } = f as Record<string, unknown>
    const ok =
      isW(weight) ||
      (Array.isArray(weight) &&
        weight.length === 2 &&
        isW(weight[0]) &&
        isW(weight[1]) &&
        weight[0] <= weight[1])
    if (
      !ok ||
      (style !== 'normal' && style !== 'italic') ||
      typeof file !== 'string' ||
      !FILE.test(file)
    )
      return undefined
    out.push({
      weight: Array.isArray(weight)
        ? [weight[0], weight[1]]
        : (weight as number),
      style,
      file,
    })
  }
  return { family, kind, licence, source, files: out }
}

const heldFont = (ref: FontRef, fonts?: SiteFonts) => {
  const slug = ref.slice(3)
  return ref.startsWith('up:') &&
    fonts &&
    SLUG.test(slug) &&
    Object.hasOwn(fonts, slug)
    ? { slug, font: checkSiteFont(fonts[slug]) }
    : undefined
}

const entry = (ref: FontRef) => {
  const id = ref.slice(4)
  return ref.startsWith('cat:') && Object.hasOwn(FONTS, id)
    ? FONTS[id]
    : undefined
}

export function fontFamily(
  ref: FontRef,
  fonts?: SiteFonts,
): string | undefined {
  if (ref.startsWith('sys:'))
    return SYSTEM_STACKS[ref.slice(4) as keyof typeof SYSTEM_STACKS]
  const h = heldFont(ref, fonts)
  if (h) {
    const k = h.font?.kind
    return (
      h.font &&
      `"${h.font.family}", ${SYSTEM_STACKS[k === 'serif' || k === 'mono' ? k : 'sans']}`
    )
  }
  const e = entry(ref)
  return e && `"${e.family}", ${fontFamily(e.fallback)}`
}

export function fontKind(ref: FontRef, fonts?: SiteFonts): 'serif' | 'sans' {
  return ref === 'sys:serif' ||
    entry(ref)?.kind === 'serif' ||
    heldFont(ref, fonts)?.font?.kind === 'serif'
    ? 'serif'
    : 'sans'
}

const face = (family: string, url: string, w: string | number, style: string) =>
  `@font-face{font-family:"${family}";src:url(${url}) format("woff2");font-weight:${w};font-style:${style};font-display:swap}`

export function fontFaceCss(
  refs: FontRef[],
  base: string,
  fonts?: SiteFonts,
): string {
  const seen = new Set<string>()
  let css = ''
  for (const ref of refs) {
    const h = heldFont(ref, fonts)
    if (h?.font) {
      for (const f of h.font.files) {
        const url = `${base}/${h.slug}/${f.file}`
        if (seen.has(url)) continue
        seen.add(url)
        css += face(
          h.font.family,
          url,
          Array.isArray(f.weight) ? f.weight.join(' ') : f.weight,
          f.style,
        )
      }
      continue
    }
    const e = entry(ref)
    if (!e) continue
    for (const f of e.files) {
      if (seen.has(f.file)) continue
      seen.add(f.file)
      css += face(
        e.family,
        `${base}/${f.file}`,
        Array.isArray(f.weight) ? f.weight.join(' ') : f.weight,
        f.style,
      )
    }
  }
  return css
}
