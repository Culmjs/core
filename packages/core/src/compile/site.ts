import type { Problem, SiteDocument } from '../document/index.ts'
import { byteLength } from './budgets.ts'
import { compilePage, failed, refusals, type CompileOptions } from './page.ts'

export type Manifest = {
  schemaVersion: 1
  /** The files, by page. */
  pages: { id: string; path: string }[]
  /** Each script by name: its size (the largest of the pages that carry it) and the pages that carry it. */
  scripts: { name: string; bytes: number; pages: string[] }[]
  /** Each page's inline style, named by the page. */
  styles: { name: string; bytes: number; pages: string[] }[]
}

export type CompiledSite = {
  files: { path: string; content: string }[]
  manifest: Manifest
  problems: Problem[]
}

/**
 * Every page that is on, as a file: `index.html` for the slug `/`, `<slug>/index.html` for the rest. A page that fails is left out and its problems come back
 * with the page's path in front; so do the ceilings a page that compiled passes. The site is compiled for the live site: `mode` is not an option here.
 */
export function compileSite(
  doc: SiteDocument,
  options: CompileOptions,
): CompiledSite {
  const files: { path: string; content: string }[] = []
  const manifest: Manifest = {
    schemaVersion: 1,
    pages: [],
    scripts: [],
    styles: [],
  }
  // The document, the rows and the options are checked once for the site; the pages then repeat the document check (ponytail: validate once per site if a site of many pages is slow).
  let invalid: Problem[]
  try {
    invalid = refusals(doc, options)
  } catch (e) {
    invalid = failed('site', e)
  }
  if (invalid.length) return { files, manifest, problems: invalid }
  const problems: Problem[] = []
  const live = { ...options, mode: 'live' as const }
  for (const page of doc.pages) {
    if (!page.on) continue
    const r = compilePage(doc, page.id, live)
    const at = (p: Problem): Problem => ({
      ...p,
      path:
        p.path === undefined
          ? `pages.${page.id}`
          : `pages.${page.id}.${p.path}`,
    })
    problems.push(...r.problems.map(at))
    if (!r.ok) continue
    // a slug is a validated site path, so distinct slugs are distinct files
    const path =
      page.slug === '/' ? 'index.html' : `${page.slug.slice(1)}/index.html`
    files.push({ path, content: r.html })
    manifest.pages.push({ id: page.id, path })
    manifest.styles.push({
      name: page.id,
      bytes: r.stats.styleBytes,
      pages: [page.id],
    })
    for (const s of r.scripts) {
      const bytes = byteLength(s.code)
      const known = manifest.scripts.find(x => x.name === s.name)
      if (known) {
        known.bytes = Math.max(known.bytes, bytes)
        known.pages.push(page.id)
      } else manifest.scripts.push({ name: s.name, bytes, pages: [page.id] })
    }
  }
  return { files, manifest, problems }
}
