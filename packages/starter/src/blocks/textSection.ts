import { type BlockDef, type Node } from '@culmjs/core'
import { accentBar, heading, paragraph, section } from '../parts.ts'

const tree = (width: number): Node =>
  section(
    [
      accentBar(),
      heading('heading', 'h2', 'A section heading'),
      paragraph('body', 'Write a few sentences here.'),
    ],
    undefined,
    { maxWidth: { n: width, unit: 'px' } },
  )

export const textSection: BlockDef = {
  id: 'text-section',
  version: 2,
  name: 'Text section',
  category: 'content',
  guide:
    'A heading and a paragraph or two. Use it for an about text or any plain explanation. "narrow" keeps lines short and easy to read; "wide" fills more of the page.',
  looks: [
    { id: 'narrow', name: 'Narrow', tree: tree(640) },
    { id: 'wide', name: 'Wide', tree: tree(960) },
  ],
  settings: [
    {
      key: 'heading',
      label: 'Heading',
      type: 'text',
      actions: [{ do: 'set', path: 'heading.props.runs' }],
    },
    {
      key: 'body',
      label: 'Text',
      type: 'textarea',
      actions: [{ do: 'set', path: 'body.props.runs' }],
    },
  ],
}
