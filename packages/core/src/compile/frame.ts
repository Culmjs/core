import {
  emptySite,
  type FontRef,
  type Look,
  type Node,
  type Problem,
  type SiteDocument,
  type SiteStyles,
} from '../document/index.ts'
import {
  darkOf,
  lineOf,
  luminance,
  mutedOf,
  siteColors,
} from '../style/colors.ts'
import { dropShadowText } from '../style/decl.ts'
import { lookVars, onAccent } from '../style/look.ts'
import { stylesOf } from '../style/siteStyles.ts'
import { compilePage, type CompileOptions } from './page.ts'

export type FrameInput = {
  node: Node
  width: number
  height: number
  look?: Look
  fonts?: FontRef[]
  styles?: SiteStyles
  transparent?: boolean
  dark?: boolean
  format?: 'html' | 'svg'
}

export type CompiledFrame =
  | {
      ok: true
      format: 'html' | 'svg'
      width: number
      height: number
      html?: string
      svg?: string
      doc: SiteDocument
      problems: Problem[]
    }
  | { ok: false; problems: Problem[] }

const DEFAULT_LOOK: Look = {
  id: 'frame',
  name: 'Frame',
  family: 'Minimal',
  brand: '#b45309',
  ink: '#1c1917',
  bg: '#fafaf9',
  headingFont: 'sys:sans',
  bodyFont: 'sys:sans',
  corners: 8,
  dark: 'light',
}

function tokenMap(
  look: Look,
  styles: SiteStyles | undefined,
  dark: boolean,
): Record<string, string> {
  const { light, dark: darkPalette } = siteColors(look)
  const pal = dark ? darkPalette : light
  const deep =
    luminance(pal.ink) < luminance(pal.bg)
      ? [pal.ink, pal.bg]
      : [pal.bg, pal.ink]
  const vars: Record<string, string> = {
    ...lookVars(look),
    '--s-brand': pal.brand,
    '--s-ink': pal.ink,
    '--s-bg': pal.bg,
    '--s-muted': mutedOf(pal),
    '--s-line': lineOf(pal),
    '--s-deep': deep[0]!,
    '--s-on-deep': deep[1]!,
  }
  if (look.accent) {
    vars['--s-accent'] = look.accent
    vars['--s-on-accent'] = onAccent(look)
  }
  const resolved = stylesOf({ styles, look })
  for (const c of resolved.colors)
    vars[`--s-c-${c.id}`] = dark ? darkOf(look, c.value) : c.value
  for (const sh of resolved.shadows)
    vars[`--s-shd-${sh.id}`] = dropShadowText(sh.value)
  return vars
}

function resolveVars(text: string, vars: Record<string, string>): string {
  let out = text
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(
      /var\((--s-[a-z0-9-]+)(?:,([^()]+))?\)/g,
      (full, name: string, fallback?: string) =>
        Object.hasOwn(vars, name)
          ? vars[name]!
          : fallback !== undefined
            ? fallback.trim()
            : full,
    )
    if (next === out) break
    out = next
  }
  return out
}

/** Compile any single node or shape into a fixed-size HTML frame or a self-contained SVG string. */
export function compileFrame(
  input: FrameInput,
  options: CompileOptions,
): CompiledFrame {
  const w = Math.round(input.width)
  const h = Math.round(input.height)
  if (
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w < 16 ||
    h < 16 ||
    w > 4096 ||
    h > 4096
  )
    return {
      ok: false,
      problems: [
        {
          code: 'INVALID_DOCUMENT',
          message: 'Frame width and height must be integers from 16 to 4096.',
        },
      ],
    }

  const format = input.format ?? 'html'
  if (format === 'svg' && input.node.kind !== 'shape')
    return {
      ok: false,
      problems: [
        {
          code: 'INVALID_DOCUMENT',
          message:
            'SVG export requires a shape root node; use png or webp for layout frames.',
          nodeId: input.node.id,
        },
      ],
    }

  const dark = input.dark === true
  const baseLook: Look = {
    ...(input.look ?? DEFAULT_LOOK),
    dark: dark ? 'dark' : 'light',
  }
  const doc = emptySite('Frame', baseLook)
  if (input.styles) doc.styles = input.styles
  const fonts = new Set<FontRef>([
    ...doc.fonts,
    ...(input.fonts ?? []),
    ...(baseLook.labelFont ? [baseLook.labelFont] : []),
  ])
  doc.fonts = [...fonts]
  doc.header = {
    ...doc.header,
    hide: { desktop: true, tablet: true, phone: true },
  }
  doc.footer = {
    ...doc.footer,
    hide: { desktop: true, tablet: true, phone: true },
  }

  const child: Node =
    input.node.kind === 'shape' && format === 'svg'
      ? {
          ...input.node,
          style: {
            ...input.node.style,
            base: {
              ...input.node.style?.base,
              width: { n: w, unit: 'px' },
              height: { n: h, unit: 'px' },
            },
          },
        }
      : input.node

  doc.pages[0]!.root = {
    id: 'homeroot',
    kind: 'column',
    name: 'Frame',
    slot: {},
    style: {
      base: {
        width: { n: w, unit: 'px' },
        height: { n: h, unit: 'px' },
        overflow: 'clip',
        ...(input.transparent ? {} : { bg: 'bg' }),
      },
    },
    children: [child],
  }

  const compiled = compilePage(doc, 'home', options)
  if (!compiled.ok) return { ok: false, problems: compiled.problems }

  if (format === 'svg') {
    const m = /<svg\b[^>]*>[\s\S]*<\/svg>/i.exec(compiled.html)
    if (!m)
      return {
        ok: false,
        problems: [
          {
            code: 'INVALID_DOCUMENT',
            message: 'Could not extract SVG markup from compiled frame.',
          },
        ],
      }
    const vars = tokenMap(baseLook, input.styles, dark)
    const rawSvg = resolveVars(m[0], vars).replace(
      /<svg\b([^>]*)>/i,
      (_tag, attrs: string) => {
        const cleaned = attrs
          .replace(/\s+class="[^"]*"/gi, '')
          .replace(/\s+data-id="[^"]*"/gi, '')
          .replace(/\s+xmlns="[^"]*"/gi, '')
          .replace(/\s+width="[^"]*"/gi, '')
          .replace(/\s+height="[^"]*"/gi, '')
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"${cleaned}>`
      },
    )
    return {
      ok: true,
      format: 'svg',
      width: w,
      height: h,
      svg: rawSvg,
      doc,
      problems: compiled.problems,
    }
  }

  const frameReset = `html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden${input.transparent ? ';background:transparent!important' : ''}}.s-site,.s-site main{min-height:0!important${input.transparent ? ';background:transparent!important' : ''}}`
  const html = compiled.html.replace('</style>', `${frameReset}</style>`)
  return {
    ok: true,
    format: 'html',
    width: w,
    height: h,
    html,
    doc,
    problems: compiled.problems,
  }
}
