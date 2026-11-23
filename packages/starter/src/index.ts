import { type Plugin } from '@culmjs/core'
import { callToAction } from './blocks/callToAction.ts'
import { cardGrid } from './blocks/cardGrid.ts'
import { hero } from './blocks/hero.ts'
import { imageText } from './blocks/imageText.ts'
import { linkList } from './blocks/linkList.ts'
import { pageFooter } from './blocks/pageFooter.ts'
import { pageHeader } from './blocks/pageHeader.ts'
import { textSection } from './blocks/textSection.ts'

export { LOOK, STYLES } from './tokens.ts'

const starter: Plugin = {
  name: 'starter',
  version: 1,
  api: [1],
  runs: ['build'],
  trust: 'declarative',
  blocks: [
    pageHeader,
    pageFooter,
    hero,
    textSection,
    imageText,
    cardGrid,
    linkList,
    callToAction,
  ],
}
export default starter
