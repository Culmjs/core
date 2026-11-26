import { type BlockDef, type Node } from '@culmjs/core'
import { BODY, colour, paragraph, solidButton, stack, step } from '../parts.ts'

const name = (): Node => ({
  ...paragraph('name', 'Site name', 'body'),
  props: {
    level: 'p',
    textStyle: 'h3',
    runs: [{ text: 'Site name' }],
  },
})
const nav = (): Node => ({
  id: 'nav',
  kind: 'menu',
  name: 'Navigation',
  slot: {},
  props: { which: 'menu' },
  style: { base: { gap: step('m'), wrap: true, size: BODY } },
})
/** The bar sits in a centred column of the sections' width, like `section()` holds its inner column. */
const COLUMN = { width: 'fill', maxWidth: { n: 1100, unit: 'px' } } as const
const tree = (centered: boolean): Node => {
  const bar = (kids: Node[]) =>
    stack(
      'bar',
      centered ? 'column' : 'row',
      kids,
      centered
        ? { ...COLUMN, align: 'center', gap: step('s') }
        : { ...COLUMN, align: 'center', justify: 'between', wrap: true },
      centered
        ? { direction: 'column', align: 'center' }
        : { direction: 'column', align: 'start' },
    )
  return {
    id: 'root',
    kind: 'column',
    name: 'Header',
    slot: {},
    props: { as: 'section' },
    style: {
      base: {
        width: 'fill',
        align: 'center',
        padding: [step('m'), step('m'), step('m'), step('m')],
        border: {
          width: 1,
          style: 'solid',
          color: colour('line'),
          sides: ['bottom'],
        },
      },
    },
    children: [bar([name(), nav(), solidButton('button', 'Order')])],
  }
}

export const pageHeader: BlockDef = {
  id: 'page-header',
  version: 2,
  name: 'Page header',
  category: 'navigation',
  guide:
    'The top of a page: the site name, the site menu and one optional button. Use it once per page, first in reading order. The menu is always shown, on every screen width. Use "bar" for a name on the left and the menu on the right, "centered" for a stacked, centred header.',
  looks: [
    { id: 'bar', name: 'Bar', tree: tree(false) },
    { id: 'centered', name: 'Centered', tree: tree(true) },
  ],
  settings: [
    {
      key: 'siteName',
      label: 'Site name',
      type: 'text',
      actions: [{ do: 'set', path: 'name.props.runs' }],
    },
    {
      key: 'showButton',
      label: 'Show the button',
      type: 'switch',
      invert: true,
      actions: [{ do: 'set', path: 'button.style.base.hidden' }],
    },
    {
      key: 'buttonLabel',
      label: 'Button label',
      type: 'text',
      actions: [{ do: 'set', path: 'button.props.label' }],
    },
    {
      key: 'buttonLink',
      label: 'Button link',
      type: 'link',
      actions: [{ do: 'set', path: 'button.props.link' }],
    },
  ],
}
