import { type BlockDef, type Node } from '@culmjs/core'
import {
  accentBar,
  heading,
  imageSlot,
  paragraph,
  section,
  stack,
  step,
} from '../parts.ts'

const tree = (imageFirst: boolean): Node => {
  const text: Node = {
    ...stack(
      'copy',
      'column',
      [
        accentBar(),
        heading('heading', 'h2', 'A section heading'),
        paragraph('body', 'Write a few sentences here.'),
      ],
      { gap: step('m') },
    ),
    slot: { grow: 1, basis: { n: 50, unit: '%' } },
  }
  const image: Node = {
    ...imageSlot('image', 'A picture for this section'),
    slot: { grow: 1, basis: { n: 50, unit: '%' } },
    style: { base: { width: 'fill', aspect: 1.5, fit: 'cover', radius: 6 } },
  }
  return section([
    stack(
      'split',
      'row',
      imageFirst ? [image, text] : [text, image],
      { align: 'center', gap: step('xl') },
      { direction: 'column' },
    ),
  ])
}

export const imageText: BlockDef = {
  id: 'image-text',
  version: 2,
  name: 'Image and text',
  category: 'content',
  guide:
    'A picture beside a heading and a paragraph. Use it to tell one thing with a photo. "image-left" puts the picture first; "image-right" puts it second. On a phone the two stack in one column, the picture in the same order.',
  looks: [
    { id: 'image-left', name: 'Image left', tree: tree(true) },
    { id: 'image-right', name: 'Image right', tree: tree(false) },
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
    {
      key: 'image',
      label: 'Image',
      type: 'asset',
      actions: [{ do: 'set', path: 'image.props.assetId' }],
    },
  ],
}
