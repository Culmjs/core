import { type Node } from '@culmjs/core'
import { STYLES } from './tokens.ts'

const leaf = (id: string, kind: 'text' | 'button' | 'image', name: string) => ({
  id,
  kind,
  name,
  slot: {},
})

export function heading(
  id: string,
  level: 'h1' | 'h2' | 'h3',
  words: string,
): Node {
  return {
    ...leaf(id, 'text', 'Heading'),
    required: true,
    props: { level, textStyle: level, runs: [{ text: words }] },
    // balance: a heading never ends on one word
    style: { base: { balance: true } },
  }
}

export function paragraph(
  id: string,
  words: string,
  style: 'body' | 'lead' = 'body',
): Node {
  return {
    ...leaf(id, 'text', 'Paragraph'),
    props: { level: 'p', textStyle: style, runs: [{ text: words }] },
  }
}

export function button(id: string, label: string): Node {
  return { ...leaf(id, 'button', 'Button'), props: { label } }
}

export function imageSlot(id: string, alt: string): Node {
  return { ...leaf(id, 'image', 'Image'), props: { alt } }
}

/** The size of the `body` text style: buttons and menus have no text style of their own, so they take its number. */
export const BODY = STYLES.text.find(t => t.id === 'body')!.decl.size!

const S = (step: 'xs' | 's' | 'm' | 'l' | 'xl' | '2xl') => ({ step })
const C = (id: 'ink' | 'canvas' | 'brand' | 'muted' | 'line') => ({ style: id })
export { C as colour, S as step }

/** A short brand bar above a section heading: the one touch of the brand colour a plain section needs. */
export function accentBar(): Node {
  return {
    ...leaf('accent', 'shape' as never, 'Accent'),
    props: { geometry: { type: 'rect', radius: 9999 }, fill: C('brand') },
    style: {
      base: { width: { n: 56, unit: 'px' }, height: { n: 5, unit: 'px' } },
    },
  }
}

/** A column or row of the blocks: named spacing and colours only; `phone` is its single-column layer. */
export function stack(
  id: string,
  kind: 'column' | 'row',
  children: Node[],
  base: NonNullable<Node['style']>['base'] = {},
  phone?: NonNullable<Node['style']>['phone'],
  more: Partial<Node> = {},
): Node {
  return {
    id,
    kind,
    name: id[0]!.toUpperCase() + id.slice(1),
    slot: {},
    ...more,
    children,
    style: {
      base: {
        gap: S('m'),
        minWidth: { n: 0, unit: 'px' },
        maxWidth: { n: 100, unit: '%' },
        ...base,
      },
      ...(phone ? { phone } : {}),
    },
  }
}

/** The outer section of a block: full width, with a centred inner column that holds `children`. `overflow: clip` cuts both axes, so positioned children and negative margins must stay inside the section. */
export function section(
  children: Node[],
  bg?: Parameters<typeof C>[0],
  inner: NonNullable<Node['style']>['base'] = {},
): Node {
  return {
    id: 'root',
    kind: 'column',
    name: 'Section',
    slot: {},
    props: { as: 'section' },
    style: {
      base: {
        width: 'fill',
        overflow: 'clip',
        align: 'center',
        padding: [S('xl'), S('m'), S('xl'), S('m')],
        ...(bg ? { bg: C(bg) } : {}),
      },
      phone: { padding: [S('l'), S('m'), S('l'), S('m')] },
    },
    children: [
      stack('inner', 'column', children, {
        width: 'fill',
        maxWidth: { n: 1100, unit: 'px' },
        gap: S('l'),
        ...inner,
      }),
    ],
  }
}

/**
 * A filled button in the brand colour (or the page colour on a brand band). The text takes the look's own `bg` and `ink`, which the dark scheme
 * swaps with the brand: the site colours `canvas` and `ink` are only lightened there, which left the text unreadable on the brand.
 * Ten pixels above and below keep the tap target at 44 px.
 */
export function solidButton(id: string, label: string, onBrand = false): Node {
  return {
    ...button(id, label),
    style: {
      base: {
        bg: onBrand ? 'bg' : C('brand'),
        color: onBrand ? 'ink' : 'bg',
        font: 'sys:sans',
        size: BODY,
        weight: 600,
        padding: [10, S('l'), 10, S('l')],
        radius: 6,
      },
    },
  }
}
