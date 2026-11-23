import { type BlockDef, type Node } from '@culmjs/core'
import { colour, heading, section, solidButton, stack, step } from '../parts.ts'

const tree = (band: boolean): Node => {
  const title = heading('heading', 'h2', 'Ready when you are')
  const words = band
    ? {
        ...title,
        style: { base: { color: 'bg' as const, balance: true } },
      }
    : title
  const inner = stack(
    'panel',
    'column',
    [words, solidButton('button', 'Get in touch', band)],
    band
      ? { align: 'center', textAlign: 'center' }
      : {
          align: 'center',
          textAlign: 'center',
          padding: [step('xl'), step('l'), step('xl'), step('l')],
          border: { width: 1, style: 'solid', color: colour('line') },
          radius: 6,
        },
  )
  return section([inner], band ? 'brand' : undefined)
}

export const callToAction: BlockDef = {
  id: 'call-to-action',
  version: 1,
  name: 'Call to action',
  category: 'content',
  guide:
    'One line that asks the visitor to do one thing, and a button. Use it once, near the end of a page. "band" is a full-width block in the brand colour; "card" is a quiet bordered box.',
  looks: [
    { id: 'band', name: 'Band', tree: tree(true) },
    { id: 'card', name: 'Card', tree: tree(false) },
  ],
  settings: [
    {
      key: 'heading',
      label: 'Heading',
      type: 'text',
      actions: [{ do: 'set', path: 'heading.props.runs' }],
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
