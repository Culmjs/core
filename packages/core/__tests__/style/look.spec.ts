import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Look, SiteStyles } from '../../src/document/index.ts'
import {
  checkLook,
  checkSiteStyles,
  defaultSiteStyles,
  LOOK_FAMILIES,
} from '../../src/style/index.ts'
import {
  badTokens,
  LOOK_VOCAB,
  lookCss,
  lookTexture,
  lookVars,
  onAccent,
} from '../../src/style/look.ts'
import { contrast } from '../../src/style/colors.ts'

const plain: Look = {
  id: 'look',
  name: 'Look',
  family: 'Minimal',
  brand: '#2244aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'sys:serif',
  bodyFont: 'sys:sans',
  corners: 6,
  dark: 'auto',
}

// Recorded from the build before the tokens existed.
const PLAIN_CSS =
  '.s-site{--s-brand-l:#2244aa;--s-ink-l:#111111;--s-bg-l:#ffffff;--s-brand-d:#8598d0;--s-ink-d:#ecebf0;--s-bg-d:#16151b;--s-head:Georgia, "Times New Roman", serif;--s-body:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;--s-radius:6px}'

test("a look with no tokens keeps exactly today's nine variables", () => {
  assert.deepEqual(Object.keys(lookVars(plain)).sort(), [
    '--s-bg-d',
    '--s-bg-l',
    '--s-body',
    '--s-brand-d',
    '--s-brand-l',
    '--s-head',
    '--s-ink-d',
    '--s-ink-l',
    '--s-radius',
  ])
})

test("a look with no tokens compiles to today's CSS", () => {
  assert.equal(lookCss(plain), PLAIN_CSS)
})

test('accent adds only --s-accent and --s-on-accent, a literal colour that dark does not swap', () => {
  const base = Object.keys(lookVars(plain))
  const vars = lookVars({ ...plain, accent: '#ffcc00' })
  assert.deepEqual(
    Object.keys(vars).filter(k => !base.includes(k)),
    ['--s-accent', '--s-on-accent'],
  )
  assert.equal(vars['--s-on-accent'], '#111111')
  assert.equal('--s-on-accent' in lookVars(plain), false)
})

test('each token sets its own variable', () => {
  assert.equal(
    lookVars({ ...plain, buttonShape: 'pill' })['--s-btn-radius'],
    '999px',
  )
  assert.equal(lookVars({ ...plain, edge: { width: 2 } })['--s-edge-w'], '2px')
  assert.equal(
    '--s-edge-c' in lookVars({ ...plain, edge: { width: 2 } }),
    false,
  )
  assert.equal(
    lookVars({ ...plain, edge: { width: 1, color: '#ff0000' } })['--s-edge-c'],
    '#ff0000',
  )
  assert.equal(
    lookVars({ ...plain, labelCase: 'caps' })['--s-label-case'],
    'uppercase',
  )
  assert.equal(lookVars({ ...plain, typeScale: 'poster' })['--s-scale'], '1.3')
  assert.match(
    lookVars({ ...plain, shadow: 'hard' })['--s-shadow'],
    /^4px 4px 0/,
  )
  assert.match(
    lookVars({ ...plain, labelFont: 'sys:mono' })['--s-label'],
    /monospace/,
  )
})

test('texture is a background-image and only appears when set', () => {
  assert.equal(lookTexture(plain), undefined)
  assert.ok(
    lookTexture({ ...plain, texture: 'dots' })!.startsWith('radial-gradient('),
  )
  for (const texture of [
    'dots',
    'grain',
    'ruled',
    'scanlines',
    'wash',
    'chrome',
  ] as const) {
    assert.match(
      lookCss({ ...plain, texture }),
      /\.s-site,\.s-site main\{background-image:/,
    )
  }
  assert.doesNotMatch(lookCss(plain), /background-image|main/)
})

const count = (css: string, part: string) => css.split(part).length - 1
const NEW_TEXTURES = [
  'linen',
  'halftone',
  'grid',
  'graph',
  'margin',
  'stars',
  'waves',
  'horizon',
  'sky',
  'aurora',
  'spotlight',
  'stripes',
] as const
const NEW_SHADOWS = ['pixel', 'bevel', 'press', 'gloss', 'glitch'] as const

test('the six old textures and four old shadows compile exactly as they did', () => {
  assert.equal(
    lookCss({ ...plain, texture: 'dots' }),
    PLAIN_CSS +
      '.s-site,.s-site main{background-image:radial-gradient(color-mix(in srgb,var(--s-ink) 14%,transparent) 1px,transparent 1.5px);background-size:16px 16px}',
  )
  assert.equal(
    lookCss({ ...plain, texture: 'wash' }),
    PLAIN_CSS +
      '.s-site,.s-site main{background-image:linear-gradient(160deg,color-mix(in srgb,var(--s-brand) 10%,transparent),transparent 60%)}',
  )
  assert.equal(
    lookVars({ ...plain, shadow: 'glow' })['--s-shadow'],
    '0 0 24px color-mix(in srgb,var(--s-brand) 45%,transparent)',
  )
})

test('each new texture is one background-image rule, written once', () => {
  for (const texture of NEW_TEXTURES) {
    const css = lookCss({ ...plain, texture })
    assert.equal(count(css, 'background-image:'), 1, texture)
    assert.equal(count(css, 'background-image:'), 1, texture)
    // a band is painted once, on the page; main turns transparent so it does not paint it again
    const band = ['horizon', 'sky', 'aurora', 'spotlight', 'stripes'].includes(
      texture,
    )
    assert.equal(count(css, '.s-site{background-image:'), band ? 1 : 0, texture)
    assert.equal(
      count(css, '.s-site main{background-color:transparent}'),
      band ? 1 : 0,
      texture,
    )
    assert.equal(
      count(css, '.s-site,.s-site main{background-image:'),
      band ? 0 : 1,
      texture,
    )
    assert.ok(css.includes(lookTexture({ ...plain, texture })!), texture)
    assert.doesNotMatch(css, /url\(/, 'CSS only, no image files')
  }
  assert.equal(
    lookTexture({ ...plain, texture: 'stars' })!.split('radial-gradient(')
      .length - 1,
    7,
  )
})

test('a band texture is a fixed-height band at the page edge, not stretched over the page', () => {
  for (const [texture, at] of [
    ['horizon', 'left bottom'],
    ['sky', 'top'],
    ['aurora', 'top'],
    ['spotlight', 'top'],
    ['stripes', 'top'],
  ] as const) {
    const css = lookCss({ ...plain, texture })
    assert.match(css, /background-size:(100% \d+(px),?)+/, texture)
    assert.ok(css.includes(`background-position:${at}`), texture)
    assert.match(css, /background-repeat:no-repeat/, texture)
  }
})

test('textureStrength sets the strength of the marks, and only that', () => {
  assert.match(lookTexture({ ...plain, texture: 'halftone' })!, /ink\) 10%/)
  assert.match(
    lookTexture({ ...plain, texture: 'halftone', textureStrength: 22 })!,
    /ink\) 22%/,
  )
  assert.match(
    lookTexture({ ...plain, texture: 'dots', textureStrength: 3 })!,
    /ink\) 3%/,
  )
  assert.equal(
    lookTexture({ ...plain, texture: 'stripes', textureStrength: 3 }),
    lookTexture({ ...plain, texture: 'stripes' }),
  )
  assert.equal(
    lookCss({ ...plain, textureStrength: 20 }),
    PLAIN_CSS,
    'no texture, nothing to strengthen',
  )
})

test('the horizon, aurora, stripes and glitch use the accent, else the brand', () => {
  for (const t of ['horizon', 'aurora', 'stripes'] as const)
    assert.match(
      lookTexture({ ...plain, texture: t })!,
      /var\(--s-accent,var\(--s-brand\)\)/,
      t,
    )
  assert.match(
    lookVars({ ...plain, shadow: 'glitch' })['--s-shadow'],
    /^3px 3px 0 var\(--s-accent,var\(--s-brand\)\),-2px -2px 0 var\(--s-brand\)$/,
  )
})

test('each new shadow sets --s-shadow once and nothing else', () => {
  const base = Object.keys(lookVars(plain))
  for (const shadow of NEW_SHADOWS) {
    const vars = lookVars({ ...plain, shadow })
    const extra =
      shadow === 'bevel'
        ? ['--s-hi', '--s-lo']
        : shadow === 'gloss'
          ? ['--s-hi', '--s-lo']
          : []
    assert.deepEqual(
      Object.keys(vars)
        .filter(k => !base.includes(k))
        .sort(),
      ['--s-shadow', ...extra].sort(),
      shadow,
    )
    assert.equal(count(lookCss({ ...plain, shadow }), '--s-shadow:'), 1, shadow)
  }
  assert.match(
    lookVars({ ...plain, shadow: 'pixel' })['--s-shadow'],
    /^4px 0 0 var\(--s-ink\),-4px 0 0 var\(--s-ink\),0 4px 0 var\(--s-ink\),0 -4px 0 var\(--s-ink\)$/,
  )
  assert.equal(
    lookVars({ ...plain, shadow: 'bevel' })['--s-shadow'],
    'inset 2px 2px 0 var(--s-hi),inset -2px -2px 0 var(--s-lo)',
  )
  assert.equal(
    lookVars({ ...plain, shadow: 'press' })['--s-shadow'],
    '0 4px 0 var(--s-line)',
  )
})

test('the sky clouds, bevel and gloss take their light from variables the dark scheme swaps', () => {
  for (const l of [
    { ...plain, texture: 'sky' },
    { ...plain, shadow: 'bevel' },
    { ...plain, shadow: 'gloss' },
  ] as Look[]) {
    const css = lookCss(l)
    assert.doesNotMatch(
      css.replace('--s-hi:#fff;--s-lo:#808080', ''),
      /#fff(?![0-9a-f])|rgb\(255|#808080/,
      JSON.stringify(l),
    )
    assert.equal(lookVars(l)['--s-hi'], '#fff')
    assert.match(
      css,
      /\.s-site\.s-scheme-dark\{--s-hi:color-mix\(in srgb,var\(--s-ink\) 30%,var\(--s-bg\)\);--s-lo:/,
    )
    assert.match(
      css,
      /prefers-color-scheme: dark\)\{\.s-site\.s-scheme-auto\{--s-hi:/,
    )
  }
  assert.doesNotMatch(lookCss(plain), /--s-hi/)
  assert.doesNotMatch(
    lookCss({ ...plain, texture: 'stars', shadow: 'pixel' }),
    /--s-hi/,
  )
})

test('nothing animates, so reduced motion has nothing to stop (glitch and aurora are still)', () => {
  for (const look of [
    { ...plain, shadow: 'glitch' },
    { ...plain, texture: 'aurora' },
    ...NEW_TEXTURES.map(texture => ({ ...plain, texture })),
    ...NEW_SHADOWS.map(shadow => ({ ...plain, shadow })),
  ] as Look[]) {
    assert.doesNotMatch(
      lookCss(look),
      /animation|@keyframes|transition/,
      JSON.stringify(look),
    )
  }
})

test('heading tokens set one variable each and one heading rule that names only the set ones', () => {
  const base = Object.keys(lookVars(plain))
  assert.deepEqual(
    Object.keys(lookVars({ ...plain, headingCase: 'caps' })).filter(
      k => !base.includes(k),
    ),
    ['--s-head-case'],
  )
  assert.equal(
    lookVars({ ...plain, headingCase: 'caps' })['--s-head-case'],
    'uppercase',
  )
  assert.equal(lookVars({ ...plain, headingWeight: 900 })['--s-head-w'], '900')
  assert.equal(
    lookVars({ ...plain, headingTracking: -0.045 })['--s-head-track'],
    '-0.045em',
  )
  assert.equal(
    lookVars({ ...plain, headingTracking: 0 })['--s-head-track'],
    '0em',
    'zero is a value, not absent',
  )
  const all = lookCss({
    ...plain,
    headingCase: 'caps',
    headingWeight: 800,
    headingTracking: 0.06,
  })
  for (const part of [
    '--s-head-case:uppercase',
    '--s-head-w:800',
    '--s-head-track:0.06em',
    ':where(.s-site) :where(h1,h2,h3,h4,h5,h6){',
  ])
    assert.equal(count(all, part), 1, part)
  assert.match(
    all,
    /\{text-transform:var\(--s-head-case\);font-weight:var\(--s-head-w\);letter-spacing:var\(--s-head-track\)\}/,
  )
  const one = lookCss({ ...plain, headingWeight: 300 })
  assert.match(one, /h6\)\{font-weight:var\(--s-head-w\)\}/)
  assert.doesNotMatch(one, /text-transform|letter-spacing/)
  assert.equal(lookCss(plain), PLAIN_CSS)
})

test('checkLook and badTokens reject a bad value of every token', () => {
  const bad: Record<string, unknown[]> = {
    shadow: ['huge', 3],
    texture: ['paper', ''],
    textureStrength: [1, 31, 12.5, '10'],
    labelCase: ['lower'],
    typeScale: ['tiny'],
    buttonShape: ['square'],
    headingCase: ['lower', 'smallcaps'],
    headingWeight: [0, 50, 850, 1000, '700'],
    headingTracking: [-0.2, 0.5, '0.1', Number.NaN],
    edge: [{ width: 4 }, { width: 1.5 }, 'thin', null],
    labelFont: ['Inter'],
  }
  for (const [k, values] of Object.entries(bad))
    for (const v of values) {
      assert.deepEqual(
        badTokens({ ...plain, [k]: v }),
        [k],
        `${k}: ${JSON.stringify(v)}`,
      )
      assert.match(
        checkLook({ ...plain, [k]: v } as Look).join(),
        new RegExp(`The ${k} setting`),
        k,
      )
    }
  const good: Look = {
    ...plain,
    shadow: 'glitch',
    texture: 'stars',
    textureStrength: 30,
    labelCase: 'caps',
    typeScale: 'poster',
    buttonShape: 'pill',
    headingCase: 'caps',
    headingWeight: 900,
    headingTracking: -0.1,
    edge: { width: 3 },
    labelFont: 'sys:mono',
  }
  assert.deepEqual(badTokens(good), [])
  assert.deepEqual(checkLook(good), [])
  assert.equal(Object.values(LOOK_VOCAB).flat().length, 9 + 18 + 1 + 3 + 1 + 1)
})

test('labelCase caps also sets the letter spacing', () => {
  assert.equal(
    lookVars({ ...plain, labelCase: 'caps' })['--s-label-track'],
    '0.06em',
  )
  assert.equal('--s-label-track' in lookVars(plain), false)
})

test('LOOK_FAMILIES holds 51 distinct families', () => {
  assert.equal(LOOK_FAMILIES.length, 51)
  assert.equal(new Set(LOOK_FAMILIES).size, 51)
})

test('checkLook passes a good look and names each problem', () => {
  assert.deepEqual(checkLook(plain), [])
  assert.deepEqual(checkLook({ ...plain, accent: '#ffcc00' }), [])
  const family = checkLook({ ...plain, family: 'Nope' })
  assert.equal(family.length, 1)
  assert.match(family[0], /family/)
  assert.match(
    checkLook({ ...plain, brand: '#ffff00' }).join(),
    /brand colour is too faint/,
  )
  assert.match(
    checkLook({ ...plain, ink: '#bbbbbb' }).join(),
    /text colour is too faint/,
  )
  assert.match(
    checkLook({ ...plain, brand: 'blue' }).join(),
    /brand colour is not a six-digit hex/,
  )
})

test('checkLook reports a dark-palette failure that light does not have', () => {
  // The built-in bold-mono look (brand #111111): its derived dark brand #7c7c7c is 4.35:1 on #16151b. A known weakness of the look, not of the check.
  const boldMono: Look = {
    ...plain,
    id: 'bold-mono',
    family: 'Bold',
    brand: '#111111',
    ink: '#111111',
    bg: '#ffffff',
  }
  assert.deepEqual(checkLook(boldMono), [
    'In dark, the brand colour is too faint on the background.',
  ])
})

test('checkLook checks the light palette and names a look that is already dark once', () => {
  const ink = checkLook({ ...plain, ink: '#8a8a8a' })
  assert.ok(ink.length > 0 && ink.every(p => p.startsWith('In light')))
  const dim = checkLook({
    ...plain,
    bg: '#101010',
    ink: '#f0f0f0',
    brand: '#303030',
  })
  assert.equal(dim.filter(p => /brand colour is too faint/.test(p)).length, 1)
})

test('onAccent keeps the ink when it reads, else picks black or white', () => {
  const cases: [string, string, string][] = [
    ['#111111', '#ffcc00', '#111111'],
    ['#f0f0f0', '#ffcc00', '#000000'],
    ['#f0f0f0', '#3355cc', '#f0f0f0'],
    ['#222222', '#ffffff', '#222222'],
    ['#ffffff', '#000000', '#ffffff'],
    ['#101010', '#00ff99', '#101010'],
  ]
  for (const [ink, accent, want] of cases)
    assert.equal(
      onAccent({ ...plain, ink, accent: accent as `#${string}` }),
      want,
      `${ink} on ${accent}`,
    )
  // Ink that does not read falls back to the better of black and white.
  assert.equal(
    onAccent({ ...plain, ink: '#222222', accent: '#333333' }),
    '#ffffff',
  )
})

test('any valid accent is allowed: the text colour on it always reads', () => {
  for (const look of [
    { ...plain, accent: '#ffcc00' },
    {
      ...plain,
      ink: '#f0f0f0',
      bg: '#101010',
      brand: '#e0e0e0',
      accent: '#ffcc00',
    },
    { ...plain, accent: '#222222' },
  ] as const) {
    assert.deepEqual(checkLook(look), [])
    assert.ok(contrast(onAccent(look), look.accent) >= 4.5)
  }
  assert.match(
    checkLook({ ...plain, accent: '#fc0' as `#${string}` }).join(),
    /accent colour is not a six-digit hex/,
  )
})

// Site styles (main's Studio editor redesign).

const look = {
  id: 'l',
  name: 'L',
  family: 'Minimal',
  brand: '#2244aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'cat:source-serif-4',
  bodyFont: 'cat:inter',
  corners: 6,
  dark: 'auto',
} as Look
const styles = (): SiteStyles => ({
  ...defaultSiteStyles(look),
  colors: [{ id: 'accent', name: 'Accent', value: '#ff8800' }],
})

test("a page without site styles gets today's look CSS, with or without an empty body", () => {
  assert.equal(lookCss(look), lookCss(look, styles(), ''))
})

test('site styles are checked at save: grammar, hex values, unique ids', () => {
  const ok = styles()
  assert.deepEqual(checkSiteStyles(ok).problems, [])
  assert.equal(
    checkSiteStyles({
      ...ok,
      colors: [{ id: 'A b', name: 'x', value: '#ffffff' }],
    }).problems.length,
    1,
  )
  assert.equal(
    checkSiteStyles({ ...ok, colors: [{ id: 'a', name: 'x', value: 'red' }] })
      .problems.length,
    1,
  )
  assert.equal(
    checkSiteStyles({ ...ok, colors: [{ id: 'a', name: 'x', value: '#fff' }] })
      .problems.length,
    1,
    'same hex rule as Color: 6 or 8 digits',
  )
  assert.deepEqual(
    checkSiteStyles({
      ...ok,
      colors: [{ id: 'a', name: 'x', value: '#ff880080' }],
    }).problems,
    [],
  )
  assert.equal(
    checkSiteStyles({
      ...ok,
      colors: [
        { id: 'a', name: 'x', value: '#ffffff' },
        { id: 'a', name: 'y', value: '#000000' },
      ],
    }).problems.length,
    1,
  )
  assert.equal(
    checkSiteStyles({
      ...ok,
      text: [{ id: 't', name: 'T', decl: { color: { style: 'gone' } } }],
    }).problems.length,
    1,
  )
  assert.equal(
    checkSiteStyles({ ...ok, space: { ...ok.space, m: -1 } }).problems.length,
    1,
  )
  // Motion: "off" is kept, absent is Smooth, anything else is refused
  assert.equal(checkSiteStyles({ ...ok, motion: 'off' }).styles?.motion, 'off')
  assert.equal('motion' in checkSiteStyles(ok).styles!, false)
  assert.equal(
    checkSiteStyles({ ...ok, motion: 'smooth' as never }).problems.length,
    1,
  )
})

test('deep and on-deep are the darker and the lighter of ink and bg, written only when the page uses them', () => {
  const body =
    '.x{background:var(--s-deep,var(--s-ink));color:var(--s-on-deep,var(--s-bg))}'
  assert.doesNotMatch(lookCss(plain, undefined, '.x{color:red}'), /--s-deep/)
  // a light look: the panel is the ink; in its dark scheme it is the dark background
  const light = lookCss(plain, undefined, body)
  assert.match(light, /\.s-site\{[^}]*--s-deep:#111111;--s-on-deep:#ffffff/)
  assert.match(light, /\.s-scheme-dark\{--s-deep:#16151b;--s-on-deep:#ecebf0\}/)
  // a dark look (ink is the light colour): the panel is the background, not a pale card; one palette, so no dark override
  const noir = lookCss(
    { ...plain, ink: '#f1ece2', bg: '#0d0d0d' },
    undefined,
    body,
  )
  assert.match(noir, /\.s-site\{[^}]*--s-deep:#0d0d0d;--s-on-deep:#f1ece2/)
  assert.doesNotMatch(noir, /s-scheme-dark/)
})

test('a look value that carries CSS is refused by the check and never written', () => {
  const evil = 'red;}*{background:url(https://evil.example/x)}' as `#${string}`
  const edge = { width: 1 as const, color: evil }
  assert.deepEqual(badTokens({ ...plain, edge }), ['edge'])
  assert.ok(checkLook({ ...plain, edge }).length > 0)
  assert.equal('--s-edge-c' in lookVars({ ...plain, edge }), false)
  // a body that uses --s-deep, so the deep colours are written from ink and bg
  const written = (l: Look) =>
    JSON.stringify([
      lookVars(l),
      lookCss(l, undefined, 'x{color:var(--s-deep)}'),
    ])
  for (const l of [
    { ...plain, shadow: 'constructor' as unknown as 'soft' },
    { ...plain, typeScale: 'constructor' as unknown as 'large' },
    { ...plain, edge },
    { ...plain, accent: evil },
    { ...plain, brand: evil },
    { ...plain, ink: evil },
    { ...plain, bg: evil },
    { ...plain, corners: evil as unknown as number },
    { ...plain, headingTracking: evil as unknown as number },
    { ...plain, headingWeight: evil as unknown as 400 },
  ])
    assert.doesNotMatch(written(l), /evil|native code/)
})

test('a site colour that is not a hex value is never written', () => {
  const evil = 'red;}*{background:url(https://evil.example/x)}'
  const styles = {
    ...defaultSiteStyles(plain),
    colors: [
      { id: 'a', name: 'a', value: evil },
      { id: 'b', name: 'b', value: '#112233' },
    ],
  } as unknown as SiteStyles
  const css = lookCss(plain, styles, 'x{color:var(--s-c-a);fill:var(--s-c-b)}')
  assert.doesNotMatch(css, /evil/)
  assert.match(css, /--s-c-b:#112233/)
})

test('checkSiteStyles copies textRange through', () => {
  const r = checkSiteStyles({ ...styles(), textRange: { min: 11, max: 96 } })
  assert.deepEqual(r.problems, [])
  assert.deepEqual(r.styles?.textRange, { min: 11, max: 96 })
})

for (const bad of [
  { min: 0, max: 96 },
  { min: 11, max: 401 },
  { min: 11.5, max: 96 },
  { min: 97, max: 96 },
])
  test(`textRange ${JSON.stringify(bad)} is refused`, () => {
    assert.equal(
      checkSiteStyles({ ...styles(), textRange: bad }).problems.length,
      1,
    )
  })

test('defaultSiteStyles sets no textRange', () => {
  assert.equal('textRange' in defaultSiteStyles(look), false)
})
