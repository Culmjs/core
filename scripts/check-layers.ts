import { readFileSync, readdirSync, statSync } from 'node:fs'
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
    for (const m of source.matchAll(FROM)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (!spec.startsWith('.')) continue
      const layer = posix.join(posix.dirname(path), spec).split('/')[0]
      const target = LAYERS.indexOf(layer)
      if (target < 0 || target > own)
        out.push(`${path} imports ${layer} (${spec})`)
    }
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = 'packages/core/src'
  const files = readFiles(root)
  const lines = layerViolations(files)
  for (const l of lines) console.log(l)
  process.exit(lines.length ? 1 : 0)
}
