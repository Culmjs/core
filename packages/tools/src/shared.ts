import type { CompiledSite, Look } from '@culmjs/core'

/** The deployment header applies to every output path, including navigable media.
 * An invalid site with no output grants no executable sources. */
export const NO_SCRIPTS = "script-src 'none'; worker-src 'none'"
export function deploymentPolicy(site: CompiledSite): string {
  return (
    /^\/\*\n  Content-Security-Policy: ([^\r\n]+)\n$/.exec(
      site.files.find(f => f.path === '_headers')?.content ?? '',
    )?.[1] ?? NO_SCRIPTS
  )
}

/** Media known to this compile, addressed as on the static site. Only add literal
 * spellings that still address the same file (a literal #, e.g., starts a fragment). */
export function mediaAddresses(files: readonly { path: string }[]) {
  const urls = new Set<string>()
  for (const { path } of files)
    if (path.startsWith('assets/')) {
      urls.add('/' + path.split('/').map(encodeURIComponent).join('/'))
      if (!/[%#?\\\u0000-\u001f]/u.test(path)) urls.add('/' + path)
    }
  return urls
}

/** A plain JSON object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// core's id rule, not exported by core
export const ID_RE = /^[a-z0-9]{1,20}$/
export const descriptorPattern = '^effects/[a-z][a-z0-9_-]{0,63}\\.json$'

/** The look a site gets when it declares none. */
export const PLAIN: Look = {
  id: 'plain',
  name: 'Plain',
  family: 'Minimal',
  brand: '#2255aa',
  ink: '#111111',
  bg: '#ffffff',
  headingFont: 'sys:serif',
  bodyFont: 'sys:sans',
  corners: 4,
  dark: 'auto',
}

/** Project sources: the names an output folder may not be, or lie inside. */
export const SOURCES = [
  'assets',
  'fonts',
  'pages',
  'pieces',
  'effects',
  'blocks',
  'data',
  'node_modules',
  '.culm',
  'site.json',
  'culm.json',
]

/** Media types of the files a site serves, by lower-case extension. */
export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}
