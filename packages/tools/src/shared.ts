import type { Look } from '@culmjs/core'

/** A plain JSON object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// core's id rule, not exported by core
export const ID_RE = /^[a-z0-9]{1,20}$/

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
