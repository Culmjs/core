import { PROPS, SPACE_STEPS, STYLE_ID_RE } from './decl.ts'
import { type Decl, type Look, type SiteStyles } from '../document/index.ts'
import { isObj } from '../document/rules.ts'

/** The paragraph text styles the Studio offered before site styles; Lead, Body, Eyebrow and Muted keep these values. */
export const PARAGRAPH_PRESETS: Record<string, Decl> = {
  Body: {
    size: 16,
    weight: 400,
    lineHeight: 1.6,
    upper: false,
    letterSpacing: 0,
    color: 'ink',
  },
  Lead: {
    size: 20,
    weight: 400,
    lineHeight: 1.6,
    upper: false,
    letterSpacing: 0,
    color: 'ink',
  },
  Eyebrow: {
    size: 11,
    weight: 400,
    lineHeight: 1.6,
    upper: true,
    letterSpacing: 0.12,
    color: 'muted',
  },
  Muted: {
    size: 16,
    weight: 400,
    lineHeight: 1.6,
    upper: false,
    letterSpacing: 0,
    color: 'muted',
  },
}

/** What a site without its own styles uses: the spacing scale, the text styles and the two shadows. */
export function defaultSiteStyles(look: Look): SiteStyles {
  const p = PARAGRAPH_PRESETS
  return {
    colors: [],
    text: [
      {
        id: 'title',
        name: 'Title',
        decl: { font: look.headingFont, size: 40 },
      },
      {
        id: 'heading',
        name: 'Heading',
        decl: { font: look.headingFont, size: 28 },
      },
      ...(['Lead', 'Body', 'Eyebrow', 'Muted'] as const).map(name => ({
        id: name.toLowerCase(),
        name,
        decl: p[name] as SiteStyles['text'][number]['decl'],
      })),
    ],
    space: { xs: 4, s: 8, m: 12, l: 20, xl: 32, '2xl': 48 },
    shadows: [
      { id: 'soft', name: 'Soft', value: 'soft' },
      { id: 'strong', name: 'Strong', value: 'strong' },
    ],
  }
}

const TEXT_KEYS = [
  'font',
  'size',
  'weight',
  'lineHeight',
  'letterSpacing',
  'upper',
  'color',
] as const
const MAX_EACH = 32

/** Save check for a site's own styles: ids match the safe grammar and are unique, and every value passes the same checks a style field does. */
export function checkSiteStyles(v: unknown): {
  styles?: SiteStyles
  problems: string[]
} {
  const problems: string[] = []
  if (
    !isObj(v) ||
    Object.keys(v).some(
      k =>
        !['colors', 'text', 'space', 'shadows', 'motion', 'textRange'].includes(
          k,
        ),
    )
  )
    return {
      problems: [
        'styles must hold colors, text, space and shadows, and may hold motion',
      ],
    }
  if (v.motion !== undefined && v.motion !== 'off')
    problems.push('styles.motion must be off, or left out for smooth')
  const r = v.textRange
  const range =
    r === undefined
      ? undefined
      : isObj(r) &&
          Object.keys(r).length === 2 &&
          Number.isInteger(r.min) &&
          Number.isInteger(r.max) &&
          (r.min as number) >= 1 &&
          (r.max as number) <= 400 &&
          (r.min as number) <= (r.max as number)
        ? { min: r.min as number, max: r.max as number }
        : (problems.push(
            'styles.textRange needs a whole min and max, from 1 to 400, with min not above max',
          ),
          undefined)
  const list = (key: 'colors' | 'text' | 'shadows') => {
    const items = v[key]
    if (!Array.isArray(items) || items.length > MAX_EACH) {
      problems.push(`styles.${key} must be a list of at most ${MAX_EACH}`)
      return []
    }
    const seen = new Set<string>()
    return items.flatMap(
      (
        x: unknown,
        i,
      ): ({ id: string; name: string } & Record<string, unknown>)[] => {
        const at = `styles.${key}[${i}]`
        if (!isObj(x) || typeof x.id !== 'string' || !STYLE_ID_RE.test(x.id)) {
          problems.push(
            `${at} needs an id of 1 to 32 lowercase letters, digits or hyphens`,
          )
          return []
        }
        if (seen.has(x.id)) {
          problems.push(`${at} repeats the id "${x.id}"`)
          return []
        }
        seen.add(x.id)
        if (
          typeof x.name !== 'string' ||
          !x.name.trim() ||
          x.name.length > 40
        ) {
          problems.push(`${at} needs a name of up to 40 characters`)
          return []
        }
        return [{ ...x, id: x.id, name: x.name }]
      },
    )
  }
  const colors = list('colors').flatMap(c => {
    if (
      typeof c.value === 'string' &&
      /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c.value)
    )
      return [{ id: c.id, name: c.name, value: c.value as `#${string}` }]
    problems.push(`styles.colors "${c.id}" must be #rrggbb or #rrggbbaa`)
    return []
  })
  const have = new Set(colors.map(c => c.id))
  const shadows = list('shadows').flatMap(s => {
    const ok = PROPS.shadow.check(s.value)
    if (ok !== undefined && !(isObj(ok) && 'style' in ok)) {
      // A site shadow may use a site colour, never another shadow.
      const bad =
        isObj(ok) &&
        isObj(ok.color) &&
        !have.has((ok.color as { style: string }).style)
      if (!bad)
        return [
          {
            id: s.id,
            name: s.name,
            value: ok as SiteStyles['shadows'][number]['value'],
          },
        ]
    }
    problems.push(`styles.shadows "${s.id}" has a value that is not allowed`)
    return []
  })
  const text = list('text').flatMap(t => {
    const decl: Record<string, unknown> = {}
    if (
      !isObj(t.decl) ||
      Object.keys(t.decl).some(
        k => !(TEXT_KEYS as readonly string[]).includes(k),
      )
    ) {
      problems.push(
        `styles.text "${t.id}" can set only ${TEXT_KEYS.join(', ')}`,
      )
      return []
    }
    for (const [k, x] of Object.entries(t.decl)) {
      const ok = PROPS[k as keyof Decl].check(x)
      if (
        ok === undefined ||
        (isObj(ok) && 'style' in ok && !have.has(ok.style as string))
      ) {
        problems.push(
          `styles.text "${t.id}".${k} has a value that is not allowed`,
        )
        return []
      }
      decl[k] = ok
    }
    return [
      {
        id: t.id,
        name: t.name,
        decl: decl as SiteStyles['text'][number]['decl'],
      },
    ]
  })
  const sp = v.space
  const space =
    isObj(sp) &&
    Object.keys(sp).length === SPACE_STEPS.length &&
    SPACE_STEPS.every(
      k =>
        typeof sp[k] === 'number' &&
        Number.isFinite(sp[k]) &&
        (sp[k] as number) >= 0 &&
        (sp[k] as number) <= 200,
    )
      ? (sp as SiteStyles['space'])
      : (problems.push(
          'styles.space needs xs, s, m, l, xl and 2xl, each from 0 to 200',
        ),
        undefined)
  return problems.length || !space
    ? { problems }
    : {
        styles: {
          colors,
          text,
          space,
          shadows,
          ...(v.motion === 'off' ? { motion: 'off' as const } : {}),
          ...(range ? { textRange: range } : {}),
        },
        problems,
      }
}

/** The styles a site renders and saves against: its own, or the defaults. */
export const stylesOf = (doc: {
  styles?: SiteStyles
  look: Look
}): SiteStyles => doc.styles ?? defaultSiteStyles(doc.look)
