import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkStyle,
  declCss,
  declsOf,
  escapeCss,
} from '../../src/style/decl.ts'

const ctx = {
  fileUrl: (id: string) => (id === 'a1' ? '/files/a b.png' : undefined),
  fontFamily: () => '"Inter", system-ui, sans-serif',
}

test('values are clamped, enums checked, colours named', () => {
  assert.equal(
    declCss({ padding: 16, gap: 8, color: 'brand', radius: 4 }, ctx),
    'padding:16px;gap:8px;color:var(--s-brand);border-radius:4px',
  )
  assert.equal(
    declCss({ justify: 'between', sticky: 'top', hidden: true }, ctx),
    'justify-content:space-between;position:sticky;top:0;display:none',
  )
  assert.equal(
    declCss({ width: 'fill', maxWidth: { n: 60, unit: 'ch' } }, ctx),
    'width:100%;max-width:60ch',
  )
  assert.equal(
    declCss({ shadow: 'soft' }, ctx),
    'box-shadow:0 2px 8px rgb(0 0 0 / 0.12)',
  )
})

test('bad values are refused with a reason, never written', () => {
  const r = checkStyle('text', {
    base: { padding: -4, color: 'red', weight: 450, bogus: 1 },
  })
  assert.equal(r.style, undefined)
  assert.equal(r.problems.length, 4)
  assert.ok(
    checkStyle('divider', { base: { font: 'cat:inter' } }).problems[0].includes(
      'font',
    ),
  )
})

test('no free text reaches CSS', () => {
  const r = checkStyle('box', {
    base: { bgImage: 'x);}</style><script>alert(1)</script>' },
  })
  assert.equal(r.style, undefined)
  assert.equal(
    declCss({ bgImage: 'a1' }, ctx),
    'background-image:url("/files/a%20b.png");background-size:cover',
  )
  assert.equal(escapeCss('a</style>b'), 'a\\3c /style>b')
})

test('inherited keys are not units, enums or properties', () => {
  for (const unit of ['toString', 'constructor', 'valueOf']) {
    const r = checkStyle('box', { base: { width: { n: 1, unit } } })
    assert.equal(r.style, undefined)
    assert.equal(r.problems.length, 1)
  }
  assert.equal(
    checkStyle('box', { base: { shadow: 'toString', radius: 'constructor' } })
      .problems.length,
    2,
  )
  assert.equal(checkStyle('box', { base: { toString: 1 } }).problems.length, 1)
})

test('underline:false switches the underline off', () => {
  assert.equal(declCss({ underline: false }, ctx), 'text-decoration:none')
  assert.equal(declCss({ underline: true }, ctx), 'text-decoration:underline')
})

test('place writes the three auto-margin forms and comes after margin', () => {
  assert.equal(declCss({ place: 'start' }, ctx), 'margin-inline-end:auto')
  assert.equal(declCss({ place: 'center' }, ctx), 'margin-inline:auto')
  assert.equal(declCss({ place: 'end' }, ctx), 'margin-inline-start:auto')
  assert.equal(
    declCss({ place: 'center', margin: 8 }, ctx),
    'margin:8px;margin-inline:auto',
  )
})

test('place accepts start, center, end and refuses the rest', () => {
  assert.deepEqual(
    checkStyle('box', { base: { place: 'center' } }).problems,
    [],
  )
  assert.equal(
    checkStyle('box', { base: { place: 'stretch' } }).problems.length,
    1,
  )
  assert.equal(
    checkStyle('box', { base: { place: 'toString' } }).problems.length,
    1,
  )
})

const bad = (kind: 'box' | 'text', d: Record<string, unknown>) =>
  checkStyle(kind, { base: d }).problems.length
const good = (kind: 'box' | 'text', d: Record<string, unknown>) => {
  const r = checkStyle(kind, { base: d })
  assert.deepEqual(r.problems, [])
  return declCss(r.style!.base!, ctx)
}

test('text styles write their CSS, in an order where underline comes first', () => {
  assert.equal(good('text', { baseline: 'super' }), 'vertical-align:super')
  assert.equal(
    good('text', { smallCaps: true }),
    'font-variant-caps:small-caps',
  )
  assert.equal(
    good('text', { strike: true }),
    'text-decoration-line:line-through',
  )
  assert.equal(
    good('text', { strike: true, underline: true }),
    'text-decoration:underline;text-decoration-line:underline line-through',
  )
  assert.equal(
    good('text', {
      underlineOffset: 4,
      underlineColor: 'brand',
      underline: true,
    }),
    'text-decoration:underline;text-decoration-color:var(--s-brand);text-underline-offset:4px',
  )
  assert.equal(
    good('text', { textShadow: { x: 1, y: -2, blur: 3, color: '#000000' } }),
    'text-shadow:1px -2px 3px #000000',
  )
  assert.equal(good('text', { textAlign: 'justify' }), 'text-align:justify')
})

test('text styles refuse out-of-range values and wrong types', () => {
  for (const d of [
    { baseline: 'middle' },
    { baseline: 'toString' },
    { strike: 'yes' },
    { smallCaps: 1 },
    { underlineOffset: 21 },
    { underlineOffset: -1 },
    { underlineOffset: '4' },
    { underlineColor: 'red' },
    { underlineColor: 'url(x)' },
    { textAlign: 'left' },
    { textShadow: { x: 51, y: 0, blur: 0, color: 'ink' } },
    { textShadow: { x: 0, y: -51, blur: 0, color: 'ink' } },
    { textShadow: { x: 0, y: 0, blur: 101, color: 'ink' } },
    { textShadow: { x: 0, y: 0, blur: -1, color: 'ink' } },
    { textShadow: { x: 0, y: 0, blur: 0, color: 'red;}' } },
    { textShadow: { x: 0, y: 0, blur: 0 } },
    { textShadow: { x: 0, y: 0, blur: 0, color: 'ink', extra: 1 } },
    { textShadow: '1px 1px red' },
    { textShadow: [1, 2, 3] },
    { textShadow: NaN },
  ])
    assert.equal(bad('text', d), 1, JSON.stringify(d))
})

test('per-side borders, more line styles, custom shadows, % radius', () => {
  const b = { width: 2, style: 'dotted', color: 'line' }
  assert.equal(good('box', { border: b }), 'border:2px dotted var(--s-line)')
  assert.equal(
    good('box', { border: { ...b, style: 'double' } }),
    'border:2px double var(--s-line)',
  )
  assert.equal(
    good('box', { border: { ...b, sides: ['left', 'top'] } }),
    'border-top:2px dotted var(--s-line);border-left:2px dotted var(--s-line)',
  )
  assert.equal(
    good('box', {
      shadow: { x: 1, y: 2, blur: 3, spread: -4, color: '#112233' },
    }),
    'box-shadow:1px 2px 3px -4px #112233',
  )
  assert.equal(
    good('box', { shadow: 'soft' }),
    'box-shadow:0 2px 8px rgb(0 0 0 / 0.12)',
  )
  assert.equal(
    good('box', { radius: { n: 50, unit: '%' } }),
    'border-radius:50%',
  )
  assert.equal(good('box', { radius: 4 }), 'border-radius:4px')
})

test('border, shadow and radius refuse bad values', () => {
  const b = { width: 2, style: 'solid', color: 'line' }
  for (const d of [
    { border: { ...b, style: 'groove' } },
    { border: { ...b, style: 'toString' } },
    { border: { ...b, sides: [] } },
    { border: { ...b, sides: ['top', 'top'] } },
    { border: { ...b, sides: ['middle'] } },
    { border: { ...b, sides: 'top' } },
    { border: { ...b, sides: ['toString'] } },
    { border: { ...b, extra: 1 } },
    { shadow: { x: 101, y: 0, blur: 0, spread: 0, color: 'ink' } },
    { shadow: { x: 0, y: 0, blur: 201, spread: 0, color: 'ink' } },
    { shadow: { x: 0, y: 0, blur: -1, spread: 0, color: 'ink' } },
    { shadow: { x: 0, y: 0, blur: 0, spread: 101, color: 'ink' } },
    { shadow: { x: 0, y: 0, blur: 0, spread: 0, color: 'red' } },
    { shadow: { x: 0, y: 0, blur: 0, spread: 0 } },
    { shadow: 'huge' },
    { shadow: 3 },
    { radius: { n: 101, unit: '%' } },
    { radius: { n: -1, unit: '%' } },
    { radius: { n: 5, unit: 'px' } },
    { radius: { n: 5, unit: '%', extra: 1 } },
  ])
    assert.equal(bad('box', d), 1, JSON.stringify(d))
})

test('gradient and backdrop blur', () => {
  assert.equal(
    good('box', {
      gradient: {
        angle: 90,
        stops: [
          { color: 'brand', at: 0 },
          { color: '#ffffff', at: 100 },
        ],
      },
    }),
    'background-image:linear-gradient(90deg,var(--s-brand) 0%,#ffffff 100%)',
  )
  assert.equal(
    good('box', { blur: 8 }),
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)',
  )
  const s = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ color: 'ink', at: i * 10 }))
  for (const d of [
    { gradient: { angle: 361, stops: s(2) } },
    { gradient: { angle: -1, stops: s(2) } },
    { gradient: { angle: 0, stops: s(1) } },
    { gradient: { angle: 0, stops: s(5) } },
    {
      gradient: {
        angle: 0,
        stops: [
          { color: 'ink', at: 101 },
          { color: 'ink', at: 0 },
        ],
      },
    },
    {
      gradient: {
        angle: 0,
        stops: [
          { color: 'red);}', at: 0 },
          { color: 'ink', at: 1 },
        ],
      },
    },
    { gradient: { angle: 0, stops: 'ink' } },
    { gradient: { angle: 0, stops: [1, 2] } },
    { gradient: { angle: 0, stops: s(2), extra: 1 } },
    { gradient: 'red' },
    { blur: 41 },
    { blur: -1 },
    { blur: '8' },
  ])
    assert.equal(bad('box', d), 1, JSON.stringify(d))
})

test('margin allows negatives, padding goes to 400, vh and vw sizes, pin', () => {
  assert.equal(
    good('box', { margin: [-400, 0, 400, -8] }),
    'margin:-400px 0px 400px -8px',
  )
  assert.equal(good('box', { padding: 400 }), 'padding:400px')
  assert.equal(
    good('box', {
      height: { n: 100, unit: 'vh' },
      width: { n: 50, unit: 'vw' },
    }),
    'width:50vw;height:100vh',
  )
  assert.equal(
    good('box', { pin: 'top' }),
    'position:fixed;inset:auto;top:0;left:0;right:0;margin:0;width:auto;max-width:none;z-index:50',
  )
  assert.equal(
    good('box', { pin: 'bottom' }),
    'position:fixed;inset:auto;bottom:0;left:0;right:0;margin:0;width:auto;max-width:none;z-index:50',
  )
  for (const d of [
    { margin: -401 },
    { margin: 401 },
    { margin: [0, 0, 0, -401] },
    { padding: 401 },
    { padding: -1 },
    { height: { n: 101, unit: 'vh' } },
    { width: { n: -1, unit: 'vw' } },
    { pin: 'left' },
    { pin: 'toString' },
    { pin: true },
  ])
    assert.equal(bad('box', d), 1, JSON.stringify(d))
})

test('the new keys apply only to the kinds whose groups hold them', () => {
  assert.equal(bad('box', { strike: true }), 0)
  assert.equal(
    checkStyle('divider', { base: { strike: true } }).problems.length,
    1,
  )
  assert.equal(
    checkStyle('image', { base: { strike: true, blur: 4 } }).problems.length,
    1,
    'image has PAINT, not TYPE',
  )
})

test('non-finite and wrong-typed numbers are refused, and so are inherited keys', () => {
  const stop = (at: unknown) => ({
    gradient: {
      angle: 0,
      stops: [
        { color: 'ink', at },
        { color: 'ink', at: 1 },
      ],
    },
  })
  for (const v of [NaN, Infinity, -Infinity, '4', null, {}]) {
    assert.equal(bad('box', { blur: v }), 1, `blur ${String(v)}`)
    assert.equal(bad('text', { underlineOffset: v }), 1, `offset ${String(v)}`)
    assert.equal(
      bad('text', { textShadow: { x: v, y: 0, blur: 0, color: 'ink' } }),
      1,
      `shadow ${String(v)}`,
    )
    assert.equal(bad('box', stop(v)), 1, `stop ${String(v)}`)
  }
  for (const k of ['__proto__', 'toString']) {
    const o = JSON.parse(`{"${k}":1,"color":"ink","at":1}`)
    assert.equal(
      bad('box', {
        gradient: { angle: 0, stops: [o, { color: 'ink', at: 1 }] },
      }),
      1,
      `stop ${k}`,
    )
  }
})

test('pin writes z-index above free slots', () => {
  assert.match(declCss({ pin: 'top' }, ctx), /z-index:50/)
})

test('colours take an optional alpha byte; nothing longer', () => {
  assert.equal(
    checkStyle('box', { base: { bg: '#00000080' } }).problems.length,
    0,
  )
  assert.match(declCss({ bg: '#00000080' }, ctx), /#00000080/)
  assert.ok(checkStyle('box', { base: { bg: '#0000008' } }).problems.length > 0)
  assert.ok(
    checkStyle('box', { base: { bg: '#000000800' } }).problems.length > 0,
  )
})

test('checkStyle accepts tablet and pressed on a button', () => {
  const r = checkStyle('button', {
    tablet: { padding: 8 },
    pressed: { opacity: 0.8 },
  })
  assert.deepEqual(r.problems, [])
})

test('checkStyle refuses checked on a text block', () => {
  assert.match(
    checkStyle('text', { checked: { color: 'brand' } }).problems[0],
    /style.checked does not apply to text/,
  )
})

const px = (n: number) => ({ n, unit: 'px' as const })
const accepts = (
  kind: Parameters<typeof checkStyle>[0],
  k: string,
  v: unknown,
) => checkStyle(kind, { base: { [k]: v } }).problems.length === 0

test('new properties: each is accepted at its edge and refused just past it', () => {
  // [kind, key, accepted, refused]
  const cases: [Parameters<typeof checkStyle>[0], string, unknown, unknown][] =
    [
      ['box', 'z', 100, 101],
      ['box', 'z', -10, -11],
      ['box', 'z', 0, NaN],
      ['box', 'z', 1, 1.5],
      ['box', 'position', 'sticky', 'static'],
      [
        'box',
        'inset',
        { top: px(0), left: { n: -100, unit: '%' } },
        { top: 'fit' },
      ],
      ['box', 'inset', { bottom: px(2000) }, { bottom: px(2001) }],
      ['box', 'inset', { left: px(1) }, { start: px(1) }],
      ['box', 'rotate', 360, 361],
      ['box', 'rotate', -360, -361],
      ['box', 'rotate', 0, Infinity],
      ['box', 'scale', 3, 3.1],
      ['box', 'scale', 0.1, 0.09],
      ['box', 'skew', { x: 45, y: -45 }, { x: 46, y: 0 }],
      ['box', 'move', { x: px(2000), y: px(-2000) }, { x: px(2001), y: px(0) }],
      ['box', 'origin', 'bottom-right', 'middle'],
      [
        'grid',
        'columns',
        [
          { fr: 1 },
          'fit',
          px(120),
          { n: 50, unit: '%' },
          { min: px(10), max: { n: 50, unit: '%' } },
        ],
        [{ n: 5, unit: 'ch' }],
      ],
      ['grid', 'columns', [{ fr: 12 }], [{ fr: Infinity }]],
      ['grid', 'columns', Array(12).fill({ fr: 1 }), Array(13).fill({ fr: 1 })],
      ['grid', 'rows', [{ fr: 1 }], []],
      [
        'grid',
        'areas',
        [
          ['a-1', 'b'],
          ['a-1', '.'],
        ],
        [['A', 'b']],
      ],
      ['grid', 'areas', [['a234567890123456']], [['a2345678901234567']]],
      [
        'grid',
        'areas',
        [
          ['a', 'b'],
          ['c', 'd'],
        ],
        [['a', 'b'], ['c']],
      ],
      [
        'image',
        'filter',
        { brightness: 2, hue: -180, grayscale: 1 },
        { brightness: 2.1 },
      ],
      ['image', 'filter', { saturate: 3 }, { hue: 181 }],
      ['image', 'filter', { contrast: 0 }, { sepia: 1 }],
      ['box', 'backdropBlur', 40, 41],
      ['box', 'blend', 'color-burn', 'hue'],
      ['box', 'clip', 'arch', 'star'],
      ['box', 'fade', 'left', 'middle'],
      ['text', 'fluidSize', { min: 16, max: 24 }, { min: 24, max: 16 }],
      ['text', 'fluidSize', { min: 8, max: 240 }, { min: 7, max: 240 }],
      ['text', 'fluidSize', { min: 240, max: 240 }, { min: 8, max: 241 }],
      ['text', 'size', 240, 241],
      ['text', 'size', 8, 7],
      ['text', 'lineHeight', 4, 4.1],
      ['text', 'lineHeight', 0.8, 0.79],
      ['text', 'textColumns', 4, 5],
      ['text', 'clampLines', 10, 11],
      ['text', 'balance', true, 'yes'],
      [
        'box',
        'transition',
        { what: 'all', ms: 2000, ease: 'spring', delay: 2000 },
        { what: 'all', ms: 2001, ease: 'out' },
      ],
      [
        'box',
        'transition',
        { what: 'colour', ms: 0, ease: 'linear' },
        { what: 'colour', ms: 100, ease: 'bounce' },
      ],
      [
        'box',
        'transition',
        { what: 'size', ms: 100, ease: 'out', delay: 0 },
        { what: 'width', ms: 100, ease: 'out' },
      ],
      ['image', 'fit', 'contain', 'fill'],
      ['image', 'focus', { x: 0, y: 100 }, { x: 101, y: 0 }],
      ['box', 'cursor', 'pointer', 'url(x)'],
    ]
  for (const [kind, k, good, bad] of cases) {
    assert.ok(
      accepts(kind, k, good),
      `${kind}.${k} accepts ${JSON.stringify(good)}`,
    )
    assert.ok(
      !accepts(kind, k, bad),
      `${kind}.${k} refuses ${String(JSON.stringify(bad))}`,
    )
  }
})

test('new properties apply only to the kinds the design lists', () => {
  const where = (k: string, v: unknown) =>
    (
      [
        'free',
        'box',
        'row',
        'column',
        'grid',
        'list',
        'table',
        'table-row',
        'table-cell',
        'text',
        'image',
        'icon',
        'button',
        'divider',
        'video',
        'menu',
        'form',
        'field',
        'details',
        'embed',
      ] as const
    ).filter(kind => accepts(kind, k, v))
  const fx = [
    'box',
    'row',
    'column',
    'list',
    'table',
    'text',
    'image',
    'icon',
    'button',
    'divider',
    'video',
    'menu',
    'form',
    'field',
    'details',
    'embed',
  ]
  assert.deepEqual(where('rotate', 4), fx)
  assert.deepEqual(where('position', 'relative'), [
    'box',
    'row',
    'column',
    'grid',
    ...fx.slice(3),
  ])
  assert.deepEqual(where('blend', 'screen'), [
    'free',
    'box',
    'row',
    'column',
    'grid',
    ...fx.slice(3),
  ])
  assert.deepEqual(where('transition', { what: 'all', ms: 1, ease: 'out' }), [
    'free',
    'box',
    'row',
    'column',
    'grid',
    ...fx.slice(3),
  ])
  assert.deepEqual(where('columns', [{ fr: 1 }]), ['grid'])
  assert.deepEqual(where('fit', 'cover'), ['image', 'video'])
  assert.deepEqual(where('focus', { x: 1, y: 1 }), ['image', 'video'])
  assert.ok(where('cursor', 'grab').length === 20)
  assert.deepEqual(where('balance', true), [
    'box',
    'row',
    'column',
    'list',
    'table',
    'table-cell',
    'text',
    'button',
    'menu',
    'form',
    'field',
    'details',
  ])
})

test('transform parts write one transform in a fixed order', () => {
  assert.equal(
    declCss({ rotate: 4, scale: 1.1 }, ctx),
    'transform:rotate(4deg) scale(1.1)',
  )
  assert.equal(
    declCss(
      {
        skew: { x: 5, y: 0 },
        scale: 2,
        rotate: -3,
        move: { x: px(4), y: { n: -10, unit: '%' } },
        origin: 'top-left',
      },
      ctx,
    ),
    'transform:translate(4px,-10%) rotate(-3deg) scale(2) skew(5deg,0deg);transform-origin:0% 0%',
  )
})

test('fluid size compiles to a clamp between the 390px and 1280px widths', () => {
  assert.equal(
    declCss({ fluidSize: { min: 16, max: 24 } }, ctx),
    'font-size:clamp(16px, calc(16px + (24 - 16) * ((100vw - 390px) / 890)), 24px)',
  )
})

test('effects, motion and grid write fixed CSS', () => {
  assert.equal(declCss({ clip: 'circle' }, ctx), 'clip-path:circle(50%)')
  assert.equal(
    declCss({ clip: 'pill' }, ctx),
    'border-radius:9999px;overflow:hidden',
  )
  assert.equal(
    declCss({ clip: 'arch' }, ctx),
    'border-radius:9999px 9999px 0 0;overflow:hidden',
  )
  assert.match(declCss({ clip: 'blob' }, ctx), /^clip-path:ellipse\(/)
  assert.match(
    declCss({ fade: 'bottom' }, ctx),
    /^-webkit-mask-image:linear-gradient\(to top, transparent, #000 45%\);mask-image:/,
  )
  assert.equal(
    declCss({ filter: { hue: 20, brightness: 1.2 } }, ctx),
    'filter:brightness(1.2) hue-rotate(20deg)',
  )
  assert.equal(
    declCss({ blend: 'color-dodge', backdropBlur: 8 }, ctx),
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);mix-blend-mode:color-dodge',
  )
  assert.equal(
    declCss(
      { transition: { what: 'colour', ms: 200, ease: 'spring', delay: 50 } },
      ctx,
    ),
    'transition-property:color,background-color,border-color;transition-duration:200ms;transition-timing-function:cubic-bezier(0.34,1.56,0.64,1);transition-delay:50ms',
  )
  assert.match(
    declCss({ transition: { what: 'size', ms: 1, ease: 'linear' } }, ctx),
    /^transition-property:width,height;.*timing-function:linear;transition-delay:0ms$/,
  )
  assert.equal(
    declCss(
      {
        columns: [{ fr: 1 }, 'fit', { min: px(100), max: 'fit' }],
        rows: [px(40)],
      },
      ctx,
    ),
    'grid-template-columns:1fr max-content minmax(100px,max-content);grid-template-rows:40px',
  )
  assert.equal(
    declCss(
      {
        areas: [
          ['head', 'head'],
          ['nav', 'main'],
        ],
      },
      ctx,
    ),
    'grid-template-areas:"head head" "nav main"',
  )
  assert.equal(
    declCss(
      {
        position: 'absolute',
        inset: { top: px(0), left: { n: -5, unit: '%' } },
        z: 3,
      },
      ctx,
    ),
    'position:absolute;top:0px;left:-5%;z-index:3',
  )
  assert.equal(
    declCss(
      {
        clampLines: 3,
        textColumns: 2,
        balance: true,
        fit: 'contain',
        focus: { x: 30, y: 70 },
        cursor: 'pointer',
      },
      ctx,
    ),
    'column-count:2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;text-wrap:balance;object-fit:contain;object-position:30% 70%;cursor:pointer',
  )
})

test('new properties work in every style layer', () => {
  assert.deepEqual(
    checkStyle('button', {
      tablet: { rotate: 2 },
      phone: { z: 3 },
      hover: { scale: 1.1 },
      focus: { cursor: 'pointer' },
    }).problems,
    [],
  )
})

test('site style references: safe ids only, steps are a closed set, missing ones are named when styles are given', () => {
  assert.equal(
    declCss(
      {
        color: { style: 'accent' },
        shadow: { style: 'soft' },
        gap: { step: '2xl' },
        margin: [{ step: 's' }, 0, 0, 0],
      },
      ctx,
    ),
    'margin:var(--s-space-s) 0px 0px 0px;gap:var(--s-space-2xl);color:var(--s-c-accent);box-shadow:var(--s-sh-soft)',
  )
  for (const bad of [
    { style: 'A' },
    { style: 'a b' },
    { style: 'a);}' },
    { style: 'x'.repeat(33) },
    { style: 'a', extra: 1 },
  ])
    assert.equal(checkStyle('box', { base: { bg: bad } }).problems.length, 1)
  assert.equal(
    checkStyle('box', { base: { gap: { step: 'huge' } } }).problems.length,
    1,
  )
  assert.equal(
    checkStyle('box', { base: { bg: { style: 'gone' } } }).problems.length,
    0,
  )
  const have = {
    colors: [{ id: 'a', name: 'A', value: '#ffffff' as const }],
    shadows: [],
  }
  assert.equal(
    checkStyle('box', { base: { bg: { style: 'a' } } }, have).problems.length,
    0,
  )
  assert.match(
    checkStyle('box', { base: { bg: { style: 'gone' } } }, have).problems[0],
    /colour style "gone"/,
  )
  assert.match(
    checkStyle('box', { base: { shadow: { style: 'a' } } }, have).problems[0],
    /shadow style "a"/,
  )
})

test('checkStyle takes when layers for the kind and refuses a name outside the grammar', () => {
  const ok = checkStyle('text', {
    when: [
      { state: 'tab', is: 'a', decl: { color: 'brand', font: 'sys:serif' } },
    ],
  })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.style?.when?.[0].decl.color, 'brand')
  assert.ok(
    checkStyle('text', { when: [{ state: 'a"b', is: 'a', decl: {} }] }).problems
      .length > 0,
  )
  assert.ok(
    checkStyle('divider', {
      when: [{ state: 'tab', is: 'a', decl: { font: 'cat:inter' } }],
    }).problems.some(p => p.includes('does not apply')),
    'held to the kind like any layer',
  )
  assert.ok(
    checkStyle('text', {
      when: [{ state: 'tab', is: 'a', decl: {}, extra: 1 }],
    }).problems.length > 0,
  )
  assert.ok(checkStyle('text', { when: 'x' }).problems.length > 0)
})

test('declsOf lists layers and when layers alike', () => {
  const decls = declsOf({
    base: { font: 'sys:sans' },
    when: [{ state: 'a', is: 'b', decl: { font: 'sys:serif' } }],
  })
  assert.deepEqual(
    decls.map(d => d.font),
    ['sys:sans', 'sys:serif'],
  )
  assert.deepEqual(declsOf(undefined), [])
})

// Look-token hooks (Task 4.0b).
test('accent and on-accent fall back to brand and the page background', () => {
  assert.equal(
    declCss({ bg: 'accent', color: 'on-accent' }, ctx),
    'background-color:var(--s-accent,var(--s-brand));color:var(--s-on-accent,var(--s-bg))',
  )
  assert.equal(
    declCss({ border: { width: 1, style: 'solid', color: 'accent' } }, ctx),
    'border:1px solid var(--s-accent,var(--s-brand))',
  )
  assert.deepEqual(
    checkStyle('text', { base: { color: 'accent', bg: 'on-accent' } }).problems,
    [],
  )
})

test('accentSoft is a light mix of the accent over the background, from tokens only', () => {
  assert.deepEqual(
    checkStyle('box', { base: { bg: 'accentSoft' } }).problems,
    [],
  )
  const css = declCss({ bg: 'accentSoft' }, ctx)
  assert.equal(
    css,
    'background-color:color-mix(in srgb,var(--s-accent,var(--s-brand)) 12%,var(--s-bg))',
  )
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i)
})

test("label writes the look's label font, case and tracking, and explicit type keys win", () => {
  const label =
    'font-family:var(--s-label,inherit);text-transform:var(--s-label-case,none);letter-spacing:var(--s-label-track,normal)'
  assert.equal(declCss({ label: true }, ctx), label)
  assert.equal(
    declCss({ label: true, letterSpacing: 0.2, upper: true }, ctx),
    `${label};letter-spacing:0.2em;text-transform:uppercase`,
  )
})

test("surface card and button read the look's edge, shadow and corners; explicit border, radius and shadow come after", () => {
  const edge =
    'border:var(--s-edge-w,1px) solid var(--s-edge-c,var(--s-line));box-shadow:var(--s-shadow,none)'
  assert.equal(
    declCss({ surface: 'card' }, ctx),
    `${edge};border-radius:var(--s-radius)`,
  )
  assert.equal(
    declCss({ surface: 'button' }, ctx),
    `${edge};border-radius:var(--s-btn-radius,var(--s-radius))`,
  )
  assert.equal(
    declCss(
      {
        surface: 'card',
        border: { width: 3, style: 'dashed', color: 'ink' },
        radius: 0,
        shadow: 'soft',
      },
      ctx,
    ),
    `${edge};border-radius:var(--s-radius);border:3px dashed var(--s-ink);border-radius:0px;box-shadow:0 2px 8px rgb(0 0 0 / 0.12)`,
  )
})

test('look-token hooks refuse other values', () => {
  for (const base of [
    { label: false },
    { label: 'yes' },
    { surface: 'panel' },
    { surface: true },
    { color: 'accent2' },
    { bg: 'var(--x)' },
    { color: 'toString' },
  ]) {
    const r = checkStyle('box', { base })
    assert.equal(r.style, undefined, JSON.stringify(base))
    assert.equal(r.problems.length, 1, JSON.stringify(base))
  }
  assert.ok(
    checkStyle('divider', { base: { surface: 'card' } }).problems[0].includes(
      'does not apply',
    ),
  )
  assert.deepEqual(
    checkStyle('box', {
      base: { label: true, surface: 'card' },
      hover: { surface: 'button' },
    }).problems,
    [],
  )
})

test('escapeCss cannot be closed from inside a style element', () => {
  assert.ok(
    !escapeCss('a</style><script>x</script>').toLowerCase().includes('</style'),
  )
})

test('a kind the core does not hold is reported, never thrown', () => {
  assert.deepEqual(checkStyle('nope', { base: {} }).problems, [
    'nope is not a known kind',
  ])
})
