import type { Problem, SiteDocument } from '../document/index.ts'
import { byteLength, type PageStats } from './budgets.ts'
import { scriptPolicy, withPolicy } from './gpuPolicy.ts'
import {
  build,
  failed,
  checkedInput,
  type CompiledPage,
  type CompileOptions,
} from './page.ts'

export type Manifest = {
  schemaVersion: 1
  /** The files, by page. */
  pages: { id: string; path: string }[]
  /** Each script by name: its size (the largest of the pages that carry it) and the pages that carry it. */
  scripts: { name: string; bytes: number; pages: string[] }[]
  /** Each page's inline style, named by the page. */
  styles: { name: string; bytes: number; pages: string[] }[]
  /** Inert definition bytes delivered in each page that uses them, never JS prices. */
  gpuData?: ({ page: string } & NonNullable<PageStats['gpuData']>)[]
  /** The build identity; the caller that writes a bundle sets it. `compileSite` leaves it unset. */
  build?: string
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
  // All pages use the same checked factory results.
  let invalid: Problem[]
  let effects: ReturnType<typeof checkedInput>['effects']
  try {
    const checked = checkedInput(doc, options)
    doc = checked.doc
    effects = checked.effects
    invalid = checked.problems
  } catch (e) {
    invalid = failed('site', e)
  }
  if (invalid.length) return { files, manifest, problems: invalid }
  const problems: Problem[] = []
  const live = { ...options, mode: 'live' as const }
  const hashes = new Set<string>()
  let worker = false
  const assets = new Map<string, string>()
  function price(name: string, bytes: number, page: string) {
    const known = manifest.scripts.find(s => s.name === name)
    if (known) {
      known.bytes = Math.max(known.bytes, bytes)
      known.pages.push(page)
    } else manifest.scripts.push({ name, bytes, pages: [page] })
  }
  for (const page of doc.pages) {
    if (!page.on) continue
    let r: CompiledPage
    try {
      r = build(doc, page, live, effects, hashes)
    } catch (e) {
      r = { ok: false, problems: failed(page.id, e) }
    }
    const at = (p: Problem): Problem => ({
      ...p,
      path:
        p.path === undefined
          ? `pages.${page.id}`
          : `pages.${page.id}.${p.path}`,
    })
    problems.push(...r.problems.map(at))
    if (!r.ok) continue
    worker ||= r.scripts.some(s => s.worker)
    // a slug is a validated site path, so distinct slugs are distinct files
    const path =
      page.slug === '/' ? 'index.html' : `${page.slug.slice(1)}/index.html`
    files.push({ path, content: r.html })
    manifest.pages.push({ id: page.id, path })
    if (r.stats.gpuData)
      (manifest.gpuData ??= []).push({ page: page.id, ...r.stats.gpuData })
    manifest.styles.push({
      name: page.id,
      bytes: r.stats.styleBytes,
      pages: [page.id],
    })
    for (const s of r.scripts) price(s.name, byteLength(s.code), page.id)
    for (const asset of r.assets ?? []) {
      assets.set(asset.path, asset.content)
      price('gpuHost', byteLength(asset.content), page.id)
    }
  }
  if (files.length) {
    const policy = scriptPolicy(hashes, worker)
    for (const page of files) page.content = withPolicy(page.content, policy)
    for (const [path, content] of assets) files.push({ path, content })
    files.push({
      path: '_headers',
      content: `/*\n  Content-Security-Policy: ${policy}\n`,
    })
  }
  if (!doc.pages.some(p => p.on && p.slug === '/'))
    problems.push({
      code: 'INVALID_DOCUMENT',
      path: 'pages',
      message: 'No page that is on has the slug "/".',
    })
  return { files, manifest, problems }
}
