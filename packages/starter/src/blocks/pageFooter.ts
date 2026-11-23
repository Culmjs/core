import { type BlockDef, type Node } from '@culmjs/core'
import { BODY, colour, paragraph, stack, step } from '../parts.ts'

const note = (): Node => ({
  ...paragraph('note', 'A short note about this site.'),
  style: { base: { color: colour('muted') } },
})
const nav = (): Node => ({
  id: 'nav',
  kind: 'menu',
  name: 'Footer links',
  slot: {},
  props: { which: 'footer' },
  style: { base: { gap: step('m'), wrap: true, size: BODY } },
})
/** The bar sits in a centred column of the sections' width, like `section()` holds its inner column. */
const COLUMN = { width: 'fill', maxWidth: { n: 1100, unit: 'px' } } as const
const tree = (columns: boolean): Node => ({
  id: 'root',
  kind: 'column',
  name: 'Footer',
  slot: {},
  props: { as: 'section' },
  style: {
    base: {
      width: 'fill',
      align: 'center',
      padding: [step('xl'), step('m'), step('xl'), step('m')],
      border: {
        width: 1,
        style: 'solid',
        color: colour('line'),
        sides: ['top'],
      },
    },
    phone: { padding: [step('l'), step('m'), step('l'), step('m')] },
  },
  children: [
    columns
      ? stack(
          'bar',
          'row',
          [note(), nav()],
          { ...COLUMN, justify: 'between', wrap: true, gap: step('l') },
          { direction: 'column' },
        )
      : stack('bar', 'column', [nav(), note()], { ...COLUMN, gap: step('s') }),
  ],
})

export const pageFooter: BlockDef = {
  id: 'page-footer',
  version: 2,
  name: 'Page footer',
  category: 'navigation',
  guide:
    'The bottom of a page: a short note and the footer links. Use it once per page, last. "simple" stacks the links above the note; "columns" puts the note and the links side by side on wide screens.',
  looks: [
    { id: 'simple', name: 'Simple', tree: tree(false) },
    { id: 'columns', name: 'Columns', tree: tree(true) },
  ],
  settings: [
    {
      key: 'note',
      label: 'Note',
      type: 'text',
      actions: [{ do: 'set', path: 'note.props.runs' }],
    },
    {
      key: 'showMenu',
      label: 'Show the links',
      type: 'switch',
      invert: true,
      actions: [{ do: 'set', path: 'nav.style.base.hidden' }],
    },
  ],
}
