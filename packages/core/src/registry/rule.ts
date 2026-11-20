import type { Problem, SiteDocument } from '../document/index.ts'

export type Rule = { name: string; check(doc: SiteDocument): Problem[] }
