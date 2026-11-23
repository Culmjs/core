import { type BlockDef, type Node } from '@culmjs/core'
import { colour, heading, section, step } from '../parts.ts'

const tree = (boxed: boolean): Node => {
  // One text node: its run carries the words of `name` and, when the row has a `link`, the link; a row with no link stays plain words.
  const link: Node = {
    id: 'link',
    kind: 'text',
    name: 'Link',
    slot: {},
    props: {
      level: 'p',
      textStyle: 'body',
      runs: [
        {
          text: '',
          bind: { from: 'item', field: 'name' },
          bindHref: { from: 'item', field: 'link' },
          style: { weight: 600, color: colour('brand'), underline: true },
        },
      ],
    },
    style: {
      base: boxed
        ? {
            width: 'fill',
            padding: [step('m'), step('m'), step('m'), step('m')],
            border: { width: 1, style: 'solid', color: colour('line') },
            radius: 6,
          }
        : {},
    },
  }
  const list: Node = {
    id: 'list',
    kind: 'list',
    name: 'Links',
    slot: {},
    repeat: { source: 'links', max: 50 },
    props: { marker: 'none' },
    style: { base: { direction: 'column', gap: step(boxed ? 's' : 'm') } },
    children: [
      {
        id: 'item',
        kind: 'column',
        name: 'Item',
        slot: {},
        showIf: { from: 'item', field: 'name' },
        children: [link],
      },
    ],
  }
  return section([heading('heading', 'h2', 'Useful links'), list], undefined, {
    maxWidth: { n: 720, unit: 'px' },
  })
}

export const linkList: BlockDef = {
  id: 'link-list',
  version: 1,
  name: 'Link list',
  category: 'lists',
  guide:
    'A heading and one link per row of a data source (default "links"; it needs the fields name and link). A row without a name is left out; a row without a link shows its name as plain words. Use it for resources or downloads. "plain" is underlined text; "boxed" gives each link a box. With no rows it shows the heading alone.',
  looks: [
    { id: 'plain', name: 'Plain', tree: tree(false) },
    { id: 'boxed', name: 'Boxed', tree: tree(true) },
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
  ],
}
