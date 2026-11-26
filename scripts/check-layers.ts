import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { posix } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LAYERS = [
  'scripts',
  'document',
  'style',
  'layout',
  'registry',
  'validate',
  'data',
  'compile',
  'ops',
  'measure',
]

type File = { path: string; source: string }

// Four ways to name a module: `import|export ... from 'x'`, `import 'x'`, `import('x')` (also `import('x').T` as a type).
const FROM =
  /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
const REF = /\/\/\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/g

/** Strip JS/TS comments while preserving string literals so semicolons in comments never break FROM matching. */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch
      out += ch
      i++
      while (i < src.length) {
        const c = src[i]
        out += c
        i++
        if (c === '\\' && i < src.length) {
          out += src[i]
          i++
        } else if (c === q) break
      }
    } else if (ch === '/' && next === '/') {
      i += 2
      while (i < src.length && src[i] !== '\n') i++
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i++
      }
      i += 2
      out += ' '
    } else {
      out += ch
      i++
    }
  }
  return out
}

/** Every file under `root`, whatever its extension, with its path relative to `root`. */
export function readFiles(root: string): File[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter(f => statSync(`${root}/${f}`).isFile())
    .map(path => ({ path, source: readFileSync(`${root}/${path}`, 'utf8') }))
}

/** `path` is relative to packages/core/src. */
export function layerViolations(files: File[]): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    if (path === 'index.ts') continue
    const own = LAYERS.indexOf(path.split('/')[0])
    if (own < 0) {
      out.push(`${path} is not in a known layer`)
      continue
    }
    const checkSpec = (spec: string) => {
      if (!spec.startsWith('.')) return
      const layer = posix.join(posix.dirname(path), spec).split('/')[0]
      const target = LAYERS.indexOf(layer)
      if (target < 0 || target > own)
        out.push(`${path} imports ${layer} (${spec})`)
    }
    for (const m of source.matchAll(REF)) checkSpec(m[1])
    for (const m of stripComments(source).matchAll(FROM))
      checkSpec(m[1] ?? m[2] ?? m[3])
  }
  return out
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = 'packages/core/src'
  if (!existsSync(root)) {
    console.error(
      'packages/core/src not found: run check:layers from the repository root.',
    )
    process.exit(1)
  }
  const files = readFiles(root)
  const lines = layerViolations(files)
  for (const l of lines) console.log(l)
  process.exit(lines.length ? 1 : 0)
}
