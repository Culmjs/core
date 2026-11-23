import { type BlockDef, type Node } from '@culmjs/core'
import { accentBar, colour, heading, section, stack, step } from '../parts.ts'

const item = (id: string): Ref => ({ from: 'item', field: id })
type Ref = { from: 'item'; field: string }

const bound = (
  id: string,
  field: string,
  textStyle: string,
  more: Partial<Node> = {},
): Node => ({
  id,
  kind: 'text',
  name: id,
  slot: {},
  showIf: item(field),
  props: {
    level: 'p',
    textStyle,
    runs: [{ text: '', bind: item(field) }],
  },
  ...more,
})
const picture = (more: Node['style'] = {}): Node => ({
  id: 'photo',
  kind: 'image',
  name: 'Photo',
  slot: {},
  showIf: item('image'),
  bind: { src: item('image'), alt: item('name') },
  props: { alt: '' },
  style: more,
})
const details = (): Node[] => [
  bound('name', 'name', 'h3'),
  bound('text', 'text', 'body'),
  bound('price', 'price', 'body', {
    style: { base: { color: colour('brand'), weight: 600 } },
  }),
]

const tree = (rows: boolean): Node => {
  const card = rows
    ? stack(
        'item',
        'row',
        [
          picture({
            base: {
              width: { n: 120, unit: 'px' },
              aspect: 1,
              fit: 'cover',
              radius: 6,
            },
            phone: { width: 'fill' },
          }),
          stack('details', 'column', details(), { gap: step('xs') }),
        ],
        {
          // Columns still writes the width so it reads back; the minimum keeps a row full width.
          width: { n: 31, unit: '%' },
          minWidth: { n: 100, unit: '%' },
          align: 'center',
          gap: step('m'),
          padding: [step('m'), 0, step('m'), 0],
          border: {
            width: 1,
            style: 'solid',
            color: colour('line'),
            sides: ['bottom'],
          },
        },
        { direction: 'column', align: 'start', width: { n: 100, unit: '%' } },
        { showIf: item('name') },
      )
    : stack(
        'item',
        'column',
        [
          picture({
            base: { width: 'fill', aspect: 1.5, fit: 'cover', radius: 6 },
          }),
          ...details(),
        ],
        {
          width: { n: 31, unit: '%' },
          gap: step('s'),
          padding: [step('m'), step('m'), step('m'), step('m')],
          border: { width: 1, style: 'solid', color: colour('line') },
          radius: 6,
        },
        { width: { n: 100, unit: '%' } },
        { showIf: item('name') },
      )
  const list: Node = {
    id: 'list',
    kind: 'list',
    name: 'Items',
    slot: {},
    repeat: { source: 'menu', max: 6 },
    props: { marker: 'none' },
    children: [card],
    style: {
      base: { direction: 'row', wrap: true, gap: step('m'), justify: 'start' },
    },
  }
  return section([accentBar(), heading('heading', 'h2', 'Our products'), list])
}

const widths = (n: number) => ({
  write: { 'item.style.base.width': { n, unit: '%' } },
})

export const cardGrid: BlockDef = {
  id: 'card-grid',
  version: 2,
  name: 'Card grid',
  category: 'lists',
  guide:
    'A heading and one card per row of a data source (default "menu"; it needs the fields name, text, price and image, and a row may leave any of them out). Use it for products, services or a team. "cards" are boxed tiles; "rows" are a picture and text on a line, always full width. Columns applies to "cards" only. With no rows it shows the heading alone. On a phone it is one column.',
  looks: [
    { id: 'cards', name: 'Cards', tree: tree(false) },
    { id: 'rows', name: 'Rows', tree: tree(true) },
  ],
  settings: [
    {
      key: 'heading',
      label: 'Heading',
      type: 'text',
      actions: [{ do: 'set', path: 'heading.props.runs' }],
    },
    {
      key: 'source',
      label: 'Data source',
      type: 'text',
      actions: [{ do: 'set', path: 'list.repeat.source' }],
    },
    {
      key: 'limit',
      label: 'How many',
      type: 'number',
      min: 1,
      max: 200,
      actions: [{ do: 'set', path: 'list.repeat.max' }],
    },
    {
      key: 'columns',
      label: 'Columns',
      type: 'select',
      options: [
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' },
      ],
      actions: [
        {
          do: 'choose',
          default: '3',
          options: {
            '1': widths(100),
            '2': widths(48),
            '3': widths(31),
            '4': widths(23),
          },
        },
      ],
    },
  ],
}
