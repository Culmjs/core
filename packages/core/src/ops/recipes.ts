import type { Op } from './types.ts'

/** A ready batch: its first operation targets the first page and is moved by `catalogue` to the site's own (see `target`). */
export type Recipe = { id: string; name: string; guide: string; ops: Op[] }

const T = { page: 'home' }
const ROOT = 'homeroot'
const px = (n: number) => ({ n, unit: 'px' as const })
const pct = (n: number) => ({ n, unit: '%' as const })
const behind = (x = 0, y = 0) => ({ mode: 'behind' as const, x, y })
const text = (level: string, words: string, style: object = {}) => ({
  kind: 'text',
  props: { level, runs: [{ text: words }] },
  style: { base: style },
})
/** A rounded button of site colours: a plain brand bg (what contrast reads), a gradient pill and a soft sheen behind the label. */
const pill = (label: string, link: object) => ({
  kind: 'button',
  props: { label, link },
  style: {
    base: {
      bg: 'brand',
      color: 'bg',
      radius: 999,
      padding: [14, 32, 14, 32],
      minHeight: px(48),
      size: 17,
      weight: 700,
      shadow: 'soft',
    },
  },
  children: [
    {
      kind: 'shape',
      placement: behind(),
      props: {
        geometry: { type: 'rect', radius: 9999 },
        fill: { from: 'brand', to: 'ink', angle: 90 },
      },
    },
    {
      kind: 'shape',
      placement: behind(),
      style: { base: { height: pct(50) } },
      props: {
        geometry: { type: 'rect', radius: 9999 },
        fill: { from: 'bg', to: 'brand', angle: 180 },
        opacity: 0.22,
      },
    },
  ],
})
/** A tinted pill in `colour`, which must read on what it sits on (a stroke would be cut at the box edge). */
const ghost = (
  label: string,
  link: object,
  colour = 'brand',
  tint = colour,
  alpha = 0.16,
) => ({
  kind: 'button',
  props: { label, link },
  style: {
    base: {
      color: colour,
      padding: [14, 32, 14, 32],
      minHeight: px(48),
      size: 17,
      weight: 700,
    },
  },
  children: [
    {
      kind: 'shape',
      placement: behind(),
      props: {
        geometry: { type: 'rect', radius: 9999 },
        fill: tint,
        opacity: alpha,
      },
    },
  ],
})
const LINK = { url: 'https://example.com' }
const add = (node: object): Op =>
  ({ op: 'add', tree: T, parent: ROOT, index: 0, node }) as unknown as Op
const wave = (
  d: string,
  fill: object | string,
  opacity: number,
  y: number,
) => ({
  kind: 'shape',
  placement: behind(0, y),
  props: {
    geometry: { type: 'path', d, view: [1440, 120] },
    fit: 'stretch',
    fill,
    opacity,
  },
})

/** The inner column of a section: as wide as the page's column, centred, so a band bleeds and its content does not. */
const COLUMN = { width: 'fill', maxWidth: px(1100) }
const SIDE = [96, 16, 96, 16]
const SIDE_PHONE = [64, 16, 64, 16]
const bar = () => ({
  kind: 'shape',
  style: { base: { width: px(56), height: px(5) } },
  props: { geometry: { type: 'rect', radius: 9999 }, fill: 'brand' },
})
/** A drawing for a hero's end side: a gradient blob, a dashed ring, a star and a dot, in the site colours. */
const art = () => ({
  kind: 'shape',
  name: 'Hero art',
  slot: { grow: 1, basis: pct(40) },
  style: {
    base: { width: 'fill', height: px(420) },
    phone: { height: px(240) },
  },
  props: { geometry: { type: 'group', view: [100, 100] } },
  children: [
    {
      kind: 'shape',
      slot: { x: 8, y: 8, w: 84, h: 84 },
      props: {
        geometry: { type: 'blob', seed: 21, smooth: 0.9, points: 7 },
        fill: { from: 'brand', to: 'bg', angle: 135 },
      },
    },
    {
      kind: 'shape',
      slot: { x: 2, y: 2, w: 96, h: 96 },
      props: {
        geometry: { type: 'ellipse' },
        fill: 'none',
        stroke: { color: 'bg', width: 1.5, dash: [2, 5] },
        opacity: 0.5,
      },
    },
    {
      kind: 'shape',
      slot: { x: 64, y: 6, w: 28, h: 28 },
      props: {
        geometry: { type: 'star', points: 8, inner: 0.55 },
        fill: 'bg',
      },
    },
    {
      kind: 'shape',
      slot: { x: 10, y: 72, w: 16, h: 16 },
      props: { geometry: { type: 'ellipse' }, fill: 'brand' },
    },
  ],
})

export const RECIPES: readonly Recipe[] = [
  {
    id: 'hero',
    name: 'Hero section',
    guide: 'Headline and buttons beside a drawing, on a gradient band',
    ops: [
      add({
        kind: 'column',
        name: 'Hero',
        style: {
          base: {
            bg: 'ink',
            color: 'bg',
            overflow: 'clip',
            align: 'center',
            padding: SIDE,
            minHeight: px(560),
          },
          phone: { padding: SIDE_PHONE, minHeight: px(0) },
        },
        children: [
          {
            kind: 'shape',
            placement: behind(),
            props: {
              geometry: { type: 'rect' },
              fill: { from: 'brand', to: 'ink', angle: 135 },
            },
          },
          {
            kind: 'shape',
            placement: behind(0, 0),
            style: { base: { width: pct(60), height: pct(100) } },
            props: {
              geometry: { type: 'blob', seed: 11, smooth: 0.9, points: 7 },
              fill: { from: 'brand', to: 'ink', angle: 45 },
              opacity: 0.3,
            },
          },
          {
            kind: 'row',
            name: 'Hero columns',
            slot: { align: 'center' },
            style: {
              base: { ...COLUMN, align: 'center', gap: 64 },
              phone: { direction: 'column', align: 'start', gap: 32 },
            },
            children: [
              {
                kind: 'column',
                name: 'Hero copy',
                slot: { grow: 1, basis: pct(56) },
                style: { base: { gap: 20, align: 'start' } },
                children: [
                  text('p', 'Your eyebrow', {
                    size: 13,
                    weight: 700,
                    upper: true,
                    letterSpacing: 0.16,
                    color: 'bg',
                  }),
                  text('h1', 'Say the one big thing', {
                    size: 72,
                    weight: 800,
                    lineHeight: 1.02,
                    letterSpacing: -0.02,
                    fluidSize: { min: 38, max: 72 },
                    balance: true,
                    color: 'bg',
                  }),
                  text(
                    'p',
                    'One calm line that says who it is for and why it helps.',
                    {
                      size: 20,
                      lineHeight: 1.5,
                      color: 'bg',
                      maxWidth: { n: 36, unit: 'ch' },
                    },
                  ),
                  {
                    kind: 'row',
                    style: { base: { gap: 16, wrap: true, align: 'center' } },
                    children: [
                      pill('Get started', LINK),
                      ghost('See how', LINK, 'bg', 'ink', 0.4),
                    ],
                  },
                ],
              },
              art(),
            ],
          },
        ],
      }),
    ],
  },
  {
    id: 'split',
    name: 'Two-column section',
    guide: 'Heading and lead at the start, text and a button at the end',
    ops: [
      add({
        kind: 'column',
        name: 'Split',
        style: {
          base: {
            bg: 'bg',
            overflow: 'clip',
            align: 'center',
            padding: SIDE,
          },
          phone: { padding: SIDE_PHONE },
        },
        children: [
          {
            kind: 'row',
            name: 'Split columns',
            slot: { align: 'center' },
            style: {
              base: { ...COLUMN, align: 'start', gap: 64 },
              phone: { direction: 'column', gap: 24 },
            },
            children: [
              {
                kind: 'column',
                name: 'Split heading',
                slot: { grow: 1, basis: pct(45) },
                style: { base: { gap: 16, align: 'start' } },
                children: [
                  bar(),
                  text('h2', 'A heading that names the idea', {
                    size: 44,
                    weight: 800,
                    lineHeight: 1.1,
                    letterSpacing: -0.01,
                    fluidSize: { min: 30, max: 44 },
                    balance: true,
                  }),
                  text('p', 'One line that says why it matters.', {
                    size: 20,
                    lineHeight: 1.5,
                    color: 'muted',
                  }),
                ],
              },
              {
                kind: 'column',
                name: 'Split text',
                slot: { grow: 1, basis: pct(55) },
                style: { base: { gap: 20, align: 'start' } },
                children: [
                  text(
                    'p',
                    'Two or three sentences that explain it plainly, in your own words.',
                    { size: 18, lineHeight: 1.65 },
                  ),
                  { ...pill('Learn more', LINK), slot: { align: 'start' } },
                ],
              },
            ],
          },
        ],
      }),
    ],
  },
  {
    id: 'cta-band',
    name: 'Call-to-action band',
    guide: 'A closing band: headline, line, one button, shapes behind',
    ops: [
      add({
        kind: 'column',
        name: 'Call to action',
        style: {
          base: {
            bg: 'ink',
            color: 'bg',
            overflow: 'clip',
            align: 'center',
            padding: SIDE,
          },
          phone: { padding: SIDE_PHONE },
        },
        children: [
          {
            kind: 'shape',
            placement: behind(),
            props: {
              geometry: { type: 'rect' },
              fill: { from: 'brand', to: 'ink', angle: 120 },
            },
          },
          {
            kind: 'shape',
            placement: behind(),
            style: { base: { width: pct(45), height: pct(100) } },
            props: {
              geometry: { type: 'blob', seed: 3, smooth: 0.9, points: 6 },
              fill: 'bg',
              opacity: 0.06,
            },
          },
          {
            kind: 'column',
            name: 'Call to action column',
            slot: { align: 'center' },
            style: {
              base: {
                ...COLUMN,
                align: 'center',
                textAlign: 'center',
                gap: 20,
              },
            },
            children: [
              text('h2', 'Ready when you are', {
                size: 48,
                weight: 800,
                lineHeight: 1.05,
                fluidSize: { min: 32, max: 56 },
                balance: true,
                color: 'bg',
              }),
              {
                ...text('p', 'One calm line that makes the next step easy.', {
                  size: 20,
                  lineHeight: 1.5,
                  color: 'bg',
                  maxWidth: { n: 36, unit: 'ch' },
                }),
                slot: { align: 'center' },
              },
              {
                kind: 'button',
                slot: { align: 'center' },
                props: { label: 'Get started', link: LINK },
                style: {
                  base: {
                    bg: 'bg',
                    color: 'ink',
                    radius: 999,
                    padding: [14, 32, 14, 32],
                    minHeight: px(48),
                    size: 17,
                    weight: 700,
                  },
                },
              },
            ],
          },
        ],
      }),
    ],
  },
  {
    id: 'buttons',
    name: 'Button pair',
    guide: 'A gradient pill and a tinted pill, shapes behind labels',
    ops: [
      add({
        kind: 'row',
        name: 'Buttons',
        style: { base: { gap: 16, wrap: true, align: 'center' } },
        children: [pill('Book a visit', LINK), ghost('Learn more', LINK)],
      }),
    ],
  },
  {
    id: 'divider',
    name: 'Section divider',
    guide: 'Two layered waves between sections',
    ops: [
      add({
        kind: 'column',
        name: 'Wave',
        style: {
          base: { bg: 'bg', overflow: 'clip', height: px(120) },
        },
        children: [
          wave(
            'M0 60 C240 0 480 120 720 60 S1200 0 1440 60 V120 H0 Z',
            'brand',
            0.4,
            8,
          ),
          wave(
            'M0 80 C260 20 520 130 760 80 S1220 30 1440 90 V120 H0 Z',
            { from: 'brand', to: 'ink', angle: 90 },
            1,
            0,
          ),
        ],
      }),
    ],
  },
  {
    id: 'card',
    name: 'Card with a badge',
    guide: 'A card with a star badge, saved as a component',
    ops: [
      add({
        id: 'badgecard',
        kind: 'column',
        name: 'Badge card',
        style: {
          base: {
            bg: 'bg',
            border: { width: 1, style: 'solid', color: 'line' },
            radius: 24,
            padding: 32,
            gap: 12,
            overflow: 'clip',
            shadow: 'soft',
            maxWidth: px(420),
          },
        },
        children: [
          {
            kind: 'shape',
            placement: behind(),
            style: { base: { width: pct(60), height: pct(60) } },
            props: {
              geometry: { type: 'blob', seed: 5, smooth: 0.9, points: 6 },
              fill: 'brand',
              opacity: 0.1,
            },
          },
          {
            kind: 'shape',
            style: { base: { width: px(72), height: px(72) } },
            props: {
              geometry: { type: 'group', view: [100, 100] },
              label: 'Top rated badge',
            },
            children: [
              {
                kind: 'shape',
                slot: { x: 0, y: 0, w: 100, h: 100 },
                props: {
                  geometry: { type: 'star', points: 12, inner: 0.82 },
                  fill: { from: 'brand', to: 'ink', angle: 135 },
                },
              },
              {
                kind: 'shape',
                slot: { x: 22, y: 22, w: 56, h: 56 },
                props: {
                  geometry: { type: 'ellipse' },
                  fill: 'none',
                  stroke: { color: 'bg', width: 3 },
                },
              },
            ],
          },
          text('h3', 'Top rated', { size: 24, weight: 700 }),
          text('p', 'A short line that earns the badge, in your words.', {
            color: 'muted',
            lineHeight: 1.5,
          }),
        ],
      }),
      {
        op: 'makeComponent',
        tree: T,
        id: 'badgecard',
        component: 'badgecard',
        name: 'Badge card',
      },
    ],
  },
]
