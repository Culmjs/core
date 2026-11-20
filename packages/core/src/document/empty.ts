import { SCHEMA_VERSION } from './migrate.ts'
import type { Look, Node, SiteDocument } from './types.ts'

const column = (id: string, name: string): Node => ({
  id,
  kind: 'column',
  name,
  slot: {},
})

/** A site with one empty page, an empty header and footer, and the given look. */
export const emptySite = (name: string, look: Look): SiteDocument => ({
  schemaVersion: SCHEMA_VERSION,
  name,
  pages: [
    {
      id: 'home',
      title: 'Home',
      slug: '/',
      icon: 'home',
      on: true,
      inMenu: true,
      inFooter: false,
      root: column('homeroot', 'Page'),
    },
  ],
  header: column('header', 'Header'),
  footer: column('footer', 'Footer'),
  components: [],
  fonts: [...new Set([look.headingFont, look.bodyFont])],
  look,
})
