import { type BlockDef, type Node } from '@culmjs/core'
import {
  colour,
  heading,
  imageSlot,
  paragraph,
  section,
  solidButton,
  stack,
  step,
} from '../parts.ts'

const copy = (): Node =>
  stack(
    'copy',
    'column',
    [
      {
        ...heading('title', 'h1', 'A headline that says what this is'),
        // The starter accepts long editorial titles as well as short wordmarks.
        style: {
          base: { balance: true },
          phone: { size: 32, letterSpacing: 0 },
        },
      },
      paragraph('lead', 'One or two lines that say more.', 'lead'),
      solidButton('button', 'Learn more'),
    ],
    { align: 'start', textAlign: 'start', gap: step('m') },
  )

const picture = (): Node => ({
  ...imageSlot('image', 'A picture for this section'),
  style: {
    base: {
      width: 'fill',
      aspect: 1.5,
      fit: 'cover',
      radius: 6,
    },
  },
})

/** The plain look's own picture: a brand blob that shrinks away on a phone. */
const art = (): Node => ({
  id: 'art',
  kind: 'shape',
  name: 'Art',
  slot: { grow: 1, basis: { n: 50, unit: '%' } },
  props: {
    geometry: { type: 'blob', seed: 7, smooth: 0.9, points: 7 },
    fill: { from: colour('brand'), to: colour('ink'), angle: 135 },
    opacity: 0.9,
  },
  style: {
    base: { width: 'fill', height: { n: 320, unit: 'px' } },
    phone: { hidden: true },
  },
})

const tree = (withImage: boolean): Node =>
  section(
    withImage
      ? [
          stack(
            'split',
            'row',
            [
              { ...copy(), slot: { grow: 1, basis: { n: 50, unit: '%' } } },
              { ...picture(), slot: { grow: 1, basis: { n: 50, unit: '%' } } },
            ],
            { align: 'center', gap: step('xl') },
            { direction: 'column' },
          ),
        ]
      : [
          stack(
            'split',
            'row',
            [
              { ...copy(), slot: { grow: 1, basis: { n: 50, unit: '%' } } },
              art(),
            ],
            { align: 'center', gap: step('xl') },
            { direction: 'column' },
          ),
        ],
  )

export const hero: BlockDef = {
  id: 'hero',
  version: 2,
  name: 'Hero',
  category: 'content',
  guide:
    'The opening of a page: the page headline, a lead line and one button. Use it once, first after the header. "plain" sets a brand shape beside the text (gone on a phone); "image" sets a picture beside the text on wide screens and below it on a phone.',
  looks: [
    { id: 'plain', name: 'Plain', tree: tree(false) },
    { id: 'image', name: 'With image', tree: tree(true) },
  ],
  settings: [
    {
      key: 'title',
      label: 'Headline',
      type: 'text',
      actions: [{ do: 'set', path: 'title.props.runs' }],
    },
    {
      key: 'lead',
      label: 'Lead',
      type: 'textarea',
      actions: [{ do: 'set', path: 'lead.props.runs' }],
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
    {
      key: 'image',
      label: 'Image',
      type: 'asset',
      actions: [{ do: 'set', path: 'image.props.assetId' }],
    },
    {
      key: 'align',
      label: 'Alignment',
      type: 'select',
      options: [
        { label: 'Start', value: 'left' },
        { label: 'Centre', value: 'center' },
      ],
      actions: [
        {
          do: 'choose',
          default: 'left',
          options: {
            left: {
              write: {
                'copy.style.base.align': 'start',
                'copy.style.base.textAlign': 'start',
              },
            },
            center: {
              write: {
                'copy.style.base.align': 'center',
                'copy.style.base.textAlign': 'center',
              },
            },
          },
        },
      ],
    },
  ],
}
